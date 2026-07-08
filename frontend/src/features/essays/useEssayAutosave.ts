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

export function useEssayAutosave(essayId: string, savedDraft?: SavedDraft) {
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<EssaySaveState>("saved");
  const savedDraftKey = useMemo(
    () =>
      savedDraft
        ? draftKey(savedDraft.content, savedDraft.wordCount)
        : null,
    [savedDraft],
  );
  const pendingDraftRef = useRef<Draft | null>(null);
  const latestSavedEssayRef = useRef<Essay | null>(null);
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
      queryClient.setQueryData<Essay>(workspaceKeys.essays.detail(essay.id), essay);
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
            ? { ...current, content: draft.content, word_count: draft.wordCount }
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

  const saveDraftRef = useRef<(draft: Draft, options?: SaveOptions) => void>(
    () => {},
  );

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
      saveDraftRef.current(pending);
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
    void queryClient.invalidateQueries({
      queryKey: workspaceKeys.essays.detail(essayId),
    });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.essays.list() });
  }, [essayId, queryClient]);

  const clearQueuedDirectDraft = useCallback((draft: Draft) => {
    if (queuedDirectDraftRef.current?.key === draft.key) {
      queuedDirectDraftRef.current = null;
    }
  }, []);

  const handleSaveSuccess = useCallback(
    (draft: Draft, essay: Essay) => {
      inFlightDraftKeysRef.current.delete(draft.key);

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

  const saveDraft = useCallback(
    (draft: Draft, options: SaveOptions = {}) => {
      if (inFlightDraftKeysRef.current.has(draft.key)) {
        if (directInFlightDraftKeyRef.current === draft.key) {
          queuedDirectDraftRef.current = null;
        }
        return;
      }

      if (directInFlightDraftKeyRef.current) {
        queuedDirectDraftRef.current = draft;
        if (options.updateState !== false && mountedRef.current) {
          setSaveState("saving");
        }
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

      directInFlightDraftKeyRef.current = draft.key;
      inFlightDraftKeysRef.current.add(draft.key);
      if (options.updateState !== false && mountedRef.current) {
        setSaveState("saving");
      }
      updateEssay(essayId, {
        content: draft.content,
      })
        .then((essay) => {
          directInFlightDraftKeyRef.current = null;
          handleSaveSuccess(draft, essay);
          const queuedDraft = queuedDirectDraftRef.current;
          if (queuedDraft) {
            queuedDirectDraftRef.current = null;
            saveDraftRef.current(queuedDraft);
          }
        })
        .catch(() => {
          directInFlightDraftKeyRef.current = null;
          handleSaveError(draft);
          const queuedDraft = queuedDirectDraftRef.current;
          if (queuedDraft) {
            queuedDirectDraftRef.current = null;
            saveDraftRef.current(queuedDraft);
          }
        });
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
      void updateEssayKeepalive(essayId, {
        content: draft.content,
      })
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

  const flush = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    const draft = pendingDraftRef.current;

    if (!draft) {
      return;
    }

    saveDraft(draft);
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

    saveDraft(draft, { updateState: false });
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
        () => saveDraft(draft),
        AUTOSAVE_DELAY_MS,
      );
    },
    [hasConflictingInFlight, saveDraft],
  );

  const retry = useCallback(() => {
    flush();
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
