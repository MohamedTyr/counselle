import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { updateEssay, updateEssayKeepalive } from "@/api/workspace/essays";
import { workspaceKeys } from "@/api/workspace/keys";
import { replaceById } from "@/api/workspace/optimistic";
import type { Essay, EssaySummary, TiptapContent } from "@/api/workspace/types";

const AUTOSAVE_DELAY_MS = 1500;

type Draft = {
  content: TiptapContent;
  key: string;
  wordCount: number;
};

type SavedDraft = {
  content: TiptapContent;
  /**
   * The essay's `updated_at` as last read from the server. Sent back as
   * `expected_updated_at` so a save built against a stale read is rejected
   * instead of silently winning: without it the backend's staleness check is
   * a documented no-op and every autosave is last-write-wins, which is how an
   * in-flight save built before an accepted suggestion could land after it and
   * quietly erase the accepted edit. Omitted only by callers that have no
   * server state to guard (the library's inline drafts) — and by the keepalive
   * save, which must stay last-write-wins for the reason spelled out there.
   */
  updatedAt?: string;
  wordCount: number;
};

type SaveOptions = {
  allowConflictingInFlight?: boolean;
  updateState?: boolean;
};

export type EssaySaveState = "saved" | "saving" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDraftValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeDraftValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "attrs" && isRecord(child)) {
      const attrs = Object.fromEntries(
        Object.entries(child).filter(([, attrValue]) => attrValue !== null),
      );
      if (Object.keys(attrs).length > 0) {
        normalized[key] = normalizeDraftValue(attrs);
      }
      continue;
    }

    normalized[key] = normalizeDraftValue(child);
  }
  return normalized;
}

function draftKey(content: TiptapContent, wordCount: number) {
  return JSON.stringify({ content: normalizeDraftValue(content), wordCount });
}

/* An essay's `updated_at` only ever moves forward, and every value here came
 * from the server, so the newest one we have seen is always the right one to
 * write against. Taking the later of the two means a stale prop arriving after
 * a save response can't walk the version backwards and leave every subsequent
 * save failing its staleness check forever. ISO-8601 UTC sorts lexically. */
function laterVersion(a: string | null, b: string | null) {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/* Omitted rather than sent as null when we have no server version to guard
 * with — an explicit null means exactly what leaving the field out means, and
 * a patch should not carry a field that says nothing. */
function contentPatch(
  content: TiptapContent,
  expectedUpdatedAt: string | null,
) {
  return expectedUpdatedAt === null
    ? { content }
    : { content, expected_updated_at: expectedUpdatedAt };
}

export function useEssayAutosave(essayId: string, savedDraft?: SavedDraft) {
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<EssaySaveState>("saved");
  const savedDraftKey = useMemo(
    () =>
      savedDraft ? draftKey(savedDraft.content, savedDraft.wordCount) : null,
    [savedDraft],
  );
  const pendingDraftRef = useRef<Draft | null>(null);
  const latestSavedEssayRef = useRef<Essay | null>(null);
  /* The version every save is written against — see `SavedDraft.updatedAt`.
   * Null means "we have no server version to guard with", which falls back to
   * the old last-write-wins behaviour rather than blocking the save. */
  const expectedUpdatedAtRef = useRef<string | null>(
    savedDraft?.updatedAt ?? null,
  );
  /* What `flush()` hands back. Every issued request replaces it, so a caller
   * that arrives while a save is already in flight awaits that save rather
   * than an already-resolved placeholder. */
  const inFlightSaveRef = useRef<Promise<void>>(Promise.resolve());
  const latestSavedDraftRef = useRef<Draft | null>(
    savedDraft && savedDraftKey
      ? {
          content: savedDraft.content,
          key: savedDraftKey,
          wordCount: savedDraft.wordCount,
        }
      : null,
  );
  const latestSavedDraftKeyRef = useRef<string | null>(savedDraftKey);
  const inFlightDraftKeysRef = useRef(new Set<string>());
  const directInFlightDraftKeyRef = useRef<string | null>(null);
  const queuedDirectDraftRef = useRef<Draft | null>(null);
  const pendingSavedDraftNeedsSaveRef = useRef(false);
  const timeoutRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const pagehideFlushedRef = useRef(false);

  const hasConflictingInFlight = useCallback((draftKey: string) => {
    for (const inFlightKey of inFlightDraftKeysRef.current) {
      if (inFlightKey !== draftKey) {
        return true;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (savedDraftKey === null || dirty || pendingDraftRef.current) {
      return;
    }

    latestSavedDraftKeyRef.current = savedDraftKey;
    expectedUpdatedAtRef.current = laterVersion(
      savedDraft?.updatedAt ?? null,
      expectedUpdatedAtRef.current,
    );
    latestSavedDraftRef.current = savedDraft
      ? {
          content: savedDraft.content,
          key: savedDraftKey,
          wordCount: savedDraft.wordCount,
        }
      : null;
    const cachedEssay = queryClient.getQueryData<Essay>(
      workspaceKeys.essays.detail(essayId),
    );
    if (
      cachedEssay &&
      draftKey(cachedEssay.content, cachedEssay.word_count) === savedDraftKey
    ) {
      latestSavedEssayRef.current = cachedEssay;
    }
    window.clearTimeout(timeoutRef.current);
    if (mountedRef.current) {
      setDirty(false);
      setSaveState("saved");
    }
  }, [dirty, essayId, queryClient, savedDraft, savedDraftKey]);

  const syncEssayCache = useCallback(
    (essay: Essay) => {
      latestSavedEssayRef.current = essay;
      queryClient.setQueryData<Essay>(
        workspaceKeys.essays.detail(essay.id),
        essay,
      );
      queryClient.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => replaceById(current, essay.id, essay),
      );
    },
    [queryClient],
  );

  const syncDraftCache = useCallback(
    (draft: Draft) => {
      queryClient.setQueryData<Essay>(
        workspaceKeys.essays.detail(essayId),
        (current) =>
          current
            ? {
                ...current,
                content: draft.content,
                word_count: draft.wordCount,
              }
            : current,
      );
      queryClient.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) =>
          current?.map((essay) =>
            essay.id === essayId
              ? { ...essay, word_count: draft.wordCount }
              : essay,
          ),
      );
    },
    [essayId, queryClient],
  );

  const syncLatestSavedCache = useCallback(() => {
    if (latestSavedEssayRef.current) {
      syncEssayCache(latestSavedEssayRef.current);
      return;
    }

    if (latestSavedDraftRef.current) {
      syncDraftCache(latestSavedDraftRef.current);
    }
  }, [syncDraftCache, syncEssayCache]);

  const saveDraftRef = useRef<
    (draft: Draft, options?: SaveOptions) => Promise<void>
  >(() => Promise.resolve());

  const settlePendingSavedDraft = useCallback(() => {
    const pending = pendingDraftRef.current;
    if (
      !pending ||
      pending.key !== latestSavedDraftKeyRef.current ||
      hasConflictingInFlight(pending.key) ||
      inFlightDraftKeysRef.current.has(pending.key)
    ) {
      return;
    }

    if (pendingSavedDraftNeedsSaveRef.current) {
      pendingSavedDraftNeedsSaveRef.current = false;
      void saveDraftRef.current(pending);
      return;
    }

    pendingDraftRef.current = null;
    syncLatestSavedCache();
    if (mountedRef.current) {
      setDirty(false);
      setSaveState("saved");
    }
  }, [hasConflictingInFlight, syncLatestSavedCache]);

  const markSaveFailed = useCallback(() => {
    /* Refetch, then adopt whatever version the server actually holds.
     *
     * A save can now fail because someone else moved the essay under us — most
     * often the student accepting a suggestion, which rewrites the content and
     * bumps `updated_at`. Retrying with the version we already knew to be
     * stale would fail identically forever, so "Retry" would be a button that
     * can never work. Re-reading the version means a retry sends the student's
     * text against the current server state and succeeds. Their typing is
     * never dropped and never silently overwritten: the save visibly failed,
     * nothing is retried automatically, and it takes their explicit click to
     * make their version the one that wins.
     */
    void queryClient
      .invalidateQueries({ queryKey: workspaceKeys.essays.detail(essayId) })
      .then(() => {
        const refreshed = queryClient.getQueryData<Essay>(
          workspaceKeys.essays.detail(essayId),
        );
        if (refreshed) {
          expectedUpdatedAtRef.current = laterVersion(
            refreshed.updated_at,
            expectedUpdatedAtRef.current,
          );
        }
      });
    void queryClient.invalidateQueries({
      queryKey: workspaceKeys.essays.list(),
    });
  }, [essayId, queryClient]);

  const clearQueuedDirectDraft = useCallback((draft: Draft) => {
    if (queuedDirectDraftRef.current?.key === draft.key) {
      queuedDirectDraftRef.current = null;
    }
  }, []);

  const handleSaveSuccess = useCallback(
    (draft: Draft, essay: Essay) => {
      inFlightDraftKeysRef.current.delete(draft.key);
      /* Unconditional, and deliberately not inside `syncEssayCache`: the
       * server's version advanced whether or not this response is the one we
       * end up displaying, and the next save has to be written against it.
       * `syncEssayCache` is also replayed with an older cached essay, which
       * would walk the version backwards and 409 every subsequent save. */
      expectedUpdatedAtRef.current = laterVersion(
        essay.updated_at,
        expectedUpdatedAtRef.current,
      );

      if (pendingDraftRef.current?.key === draft.key) {
        syncEssayCache(essay);
        latestSavedDraftRef.current = draft;
        latestSavedDraftKeyRef.current = draft.key;
        pendingSavedDraftNeedsSaveRef.current = false;
        pendingDraftRef.current = null;
        if (mountedRef.current) {
          setDirty(false);
          setSaveState("saved");
        }
        return;
      }

      syncLatestSavedCache();
      if (pendingDraftRef.current?.key === latestSavedDraftKeyRef.current) {
        pendingSavedDraftNeedsSaveRef.current = true;
      }
      settlePendingSavedDraft();
    },
    [settlePendingSavedDraft, syncEssayCache, syncLatestSavedCache],
  );

  const handleSaveError = useCallback(
    (draft: Draft) => {
      inFlightDraftKeysRef.current.delete(draft.key);

      if (pendingDraftRef.current?.key === draft.key) {
        markSaveFailed();
        if (mountedRef.current) {
          setDirty(true);
          setSaveState("error");
        }
        return;
      }

      syncLatestSavedCache();
      settlePendingSavedDraft();
    },
    [markSaveFailed, settlePendingSavedDraft, syncLatestSavedCache],
  );

  /* Returns a promise that settles only once the request it stands for — and
   * any save queued behind it — has landed. Callers that fire and forget can
   * keep ignoring it; the accept/reject flow needs to await the flush before
   * it POSTs, or it would act against a copy of the essay the server has not
   * seen yet. It resolves on failure too: "the save finished" is the question,
   * and `saveState` already carries the answer to "did it work". */
  const saveDraft = useCallback(
    (draft: Draft, options: SaveOptions = {}): Promise<void> => {
      if (inFlightDraftKeysRef.current.has(draft.key)) {
        if (directInFlightDraftKeyRef.current === draft.key) {
          queuedDirectDraftRef.current = null;
        }
        return inFlightSaveRef.current;
      }

      if (directInFlightDraftKeyRef.current) {
        queuedDirectDraftRef.current = draft;
        if (options.updateState !== false && mountedRef.current) {
          setSaveState("saving");
        }
        // The in-flight save chains its queued successor, so awaiting it
        // covers this draft too.
        return inFlightSaveRef.current;
      }

      if (
        !options.allowConflictingInFlight &&
        latestSavedDraftKeyRef.current === draft.key &&
        hasConflictingInFlight(draft.key)
      ) {
        if (options.updateState !== false && mountedRef.current) {
          setSaveState("saving");
        }
        return inFlightSaveRef.current;
      }

      directInFlightDraftKeyRef.current = draft.key;
      inFlightDraftKeysRef.current.add(draft.key);
      if (options.updateState !== false && mountedRef.current) {
        setSaveState("saving");
      }

      // Returning the queued save from the continuation is what makes the
      // outer promise cover the whole cascade rather than just the first hop.
      function drainQueue() {
        const queuedDraft = queuedDirectDraftRef.current;
        if (!queuedDraft) {
          return;
        }
        queuedDirectDraftRef.current = null;
        return saveDraftRef.current(queuedDraft);
      }

      const save = updateEssay(
        essayId,
        contentPatch(draft.content, expectedUpdatedAtRef.current),
      )
        .then((essay) => {
          directInFlightDraftKeyRef.current = null;
          handleSaveSuccess(draft, essay);
          return drainQueue();
        })
        .catch(() => {
          directInFlightDraftKeyRef.current = null;
          handleSaveError(draft);
          return drainQueue();
        });

      inFlightSaveRef.current = save;
      return save;
    },
    [essayId, handleSaveError, handleSaveSuccess, hasConflictingInFlight],
  );

  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  const saveDraftKeepalive = useCallback(
    (draft: Draft, options: SaveOptions = {}) => {
      if (inFlightDraftKeysRef.current.has(draft.key)) {
        return;
      }

      if (
        !options.allowConflictingInFlight &&
        latestSavedDraftKeyRef.current === draft.key &&
        hasConflictingInFlight(draft.key)
      ) {
        if (options.updateState !== false && mountedRef.current) {
          setSaveState("saving");
        }
        return;
      }

      window.clearTimeout(timeoutRef.current);
      inFlightDraftKeysRef.current.add(draft.key);
      if (options.updateState !== false && mountedRef.current) {
        setSaveState("saving");
      }
      /* Deliberately UNGUARDED — no `expected_updated_at`, unlike the debounced
       * path above. This fires on pagehide with `allowConflictingInFlight`, so
       * it can carry the student's newest text while an older save is still in
       * flight against the same, not-yet-bumped version. Guarded, the older
       * save lands first and bumps the version, and the newest text is the one
       * rejected — at the single write site that structurally cannot retry,
       * because the page is gone and the student never sees the failure.
       *
       * This reopens nothing: an accepted suggestion arrives through
       * `setContent(..., { emitUpdate: false })`, which fires no `onUpdate`, so
       * an accept never dirties the pending draft this sends. */
      void updateEssayKeepalive(essayId, { content: draft.content })
        .then((essay) => {
          clearQueuedDirectDraft(draft);
          handleSaveSuccess(draft, essay);
        })
        .catch(() => handleSaveError(draft));
    },
    [
      clearQueuedDirectDraft,
      essayId,
      handleSaveError,
      handleSaveSuccess,
      hasConflictingInFlight,
    ],
  );

  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timeoutRef.current);
    const draft = pendingDraftRef.current;

    if (!draft) {
      return Promise.resolve();
    }

    return saveDraft(draft);
  }, [saveDraft]);

  const flushOnUnmount = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    const draft = pendingDraftRef.current;

    if (!draft) {
      return;
    }

    if (hasConflictingInFlight(draft.key)) {
      saveDraftKeepalive(draft, {
        allowConflictingInFlight: true,
        updateState: false,
      });
      return;
    }

    void saveDraft(draft, { updateState: false });
  }, [hasConflictingInFlight, saveDraft, saveDraftKeepalive]);

  const flushKeepalive = useCallback(() => {
    const draft = pendingDraftRef.current;

    if (!draft) {
      return;
    }

    saveDraftKeepalive(draft, { allowConflictingInFlight: true });
  }, [saveDraftKeepalive]);

  const queueSave = useCallback(
    (content: TiptapContent, wordCount: number) => {
      const draft = {
        content,
        key: draftKey(content, wordCount),
        wordCount,
      };

      if (latestSavedDraftKeyRef.current === draft.key) {
        if (hasConflictingInFlight(draft.key)) {
          pendingDraftRef.current = draft;
          if (directInFlightDraftKeyRef.current) {
            queuedDirectDraftRef.current = draft;
          }
          pendingSavedDraftNeedsSaveRef.current = false;
          window.clearTimeout(timeoutRef.current);
          setDirty(true);
          setSaveState("saving");
          return;
        }

        pendingDraftRef.current = null;
        pendingSavedDraftNeedsSaveRef.current = false;
        window.clearTimeout(timeoutRef.current);
        setDirty(false);
        setSaveState("saved");
        return;
      }

      pendingDraftRef.current = draft;
      pendingSavedDraftNeedsSaveRef.current = false;
      setDirty(true);
      setSaveState("saving");
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(
        () => void saveDraft(draft),
        AUTOSAVE_DELAY_MS,
      );
    },
    [hasConflictingInFlight, saveDraft],
  );

  const retry = useCallback(() => {
    void flush();
  }, [flush]);

  const flushOnUnmountRef = useRef(flushOnUnmount);
  useEffect(() => {
    flushOnUnmountRef.current = flushOnUnmount;
  }, [flushOnUnmount]);

  const flushKeepaliveRef = useRef(flushKeepalive);
  useEffect(() => {
    flushKeepaliveRef.current = flushKeepalive;
  }, [flushKeepalive]);

  useEffect(() => {
    mountedRef.current = true;
    pagehideFlushedRef.current = false;

    function flushOnHidden() {
      if (document.visibilityState === "hidden") {
        flushKeepaliveRef.current();
      }
    }

    function flushOnPageHide() {
      pagehideFlushedRef.current = true;
      flushKeepaliveRef.current();
    }

    document.addEventListener("visibilitychange", flushOnHidden);
    window.addEventListener("pagehide", flushOnPageHide);

    return () => {
      mountedRef.current = false;
      if (!pagehideFlushedRef.current) {
        flushOnUnmountRef.current();
      }
      window.clearTimeout(timeoutRef.current);
      document.removeEventListener("visibilitychange", flushOnHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, []);

  return {
    flush,
    isDirty: dirty,
    queueSave,
    retry,
    saveState,
  };
}
