import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getQuestion, getSession, getSessionByQuestion, putBookmark, deleteBookmark, submitAttempt } from "@/api/sat/client";
import { isTransportError } from "@/api/http/errors";
import { toastSatError } from "@/api/sat/errors";
import { satKeys } from "@/api/sat/keys";
import type { SatFilterQuery, SatSessionRow } from "@/api/sat/types";
import { SAT_SESSION_TIMEOUT_MS } from "@/config";
import { toLocalDateKey } from "@/features/sat/SatActivityRail";
import {
  createInitialSatSessionState,
  satSessionReducer,
  selectAnswer,
  selectEliminations,
  selectHistory,
  selectIsInFlight,
  selectReusableAttemptId,
  selectReveal,
  type SatHistoryEntry,
  type SatReveal,
  type SatSessionAction,
  type SatSessionState,
} from "@/features/sat/sat-session-reducer";

/**
 * `useSatSession` — the deep module of plan §5.3: a launched session's whole
 * lifetime, fetched once per mount (D6) and held in its own state, never in
 * the TanStack cache. The pure state transitions live in
 * `sat-session-reducer.ts` (not owned by this file); this hook owns the one
 * side effect that reducer can't — the `GET /session` fetch, its abort
 * handling, prefetch, and the submit/bookmark mutations — and exposes the
 * result keyed by `question_id` throughout, per §5.3's "applied by its
 * `question_id`" rule (a response that lands after the student moved on is
 * still correct).
 */

export type SatSessionStatus = "loading" | "ready" | "error";

/** How the session was launched (plan §5.1's deep-link precedence — path
 * id, then `?id=`, then `?q=` — is resolved by the caller into this before
 * it ever reaches the hook; `/session?question=` is an id lookup, not a
 * filtered list, plan §4.2). */
export type SatSessionSource =
  | { kind: "filter"; filter: SatFilterQuery }
  | { kind: "question"; questionId: string };

export interface UseSatSessionApi {
  status: SatSessionStatus;
  rows: readonly SatSessionRow[];
  index: number;
  current: SatSessionRow | undefined;
  /** Re-runs `GET /session` against the same source — the session-load
   * failure state's "Try again" (ui-spec §4.3). */
  reload: () => void;
  /** Jumps to `index` and clears any text selection (Q30a) — the one
   * funnel every navigation goes through (cell, Next, Enter). */
  goTo: (index: number) => void;
  answer: (value: string) => void;
  toggleEliminate: (label: string) => void;
  /** Captures `elapsedSeconds` at press time (the caller reads
   * `useQuestionTimer().readElapsed()`, plan §5.5) rather than owning the
   * timer itself — the timer is UI state the question pane renders, this
   * hook only needs its final value. No-ops when the current question has
   * no answer or is already in flight. */
  submit: (elapsedSeconds: number) => Promise<void>;
  /** Idempotent set/clear, not a toggle server-side (plan §4.2) — but the
   * only state this hook has is the row's current `bookmarked`, so it
   * flips it, optimistically, restoring the snapshot on error (plan §5.3). */
  toggleBookmark: () => Promise<void>;
  // Per-question selectors (plan §5.3) — used by the navigator over every
  // row, and by the question pane for the current row alike.
  getAnswer: (questionId: string) => string | undefined;
  getEliminations: (questionId: string) => ReadonlySet<string>;
  getReveal: (questionId: string) => SatReveal | undefined;
  getHistory: (questionId: string) => SatHistoryEntry;
  isInFlight: (questionId: string) => boolean;
}

function sourceKeyOf(source: SatSessionSource): string {
  return source.kind === "filter"
    ? `filter:${JSON.stringify({
        skills: [...(source.filter.skills ?? [])].sort(),
        bands: [...(source.filter.bands ?? [])].sort(),
        status: source.filter.status ?? "all",
        excludeBluebook: source.filter.excludeBluebook ?? true,
      })}`
    : `question:${source.questionId}`;
}

export function useSatSession(source: SatSessionSource): UseSatSessionApi {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SatSessionState>(() =>
    createInitialSatSessionState([]),
  );
  const [status, setStatus] = useState<SatSessionStatus>("loading");
  const [reloadNonce, setReloadNonce] = useState(0);

  const dispatch = useCallback((action: SatSessionAction) => {
    setSession((prev) => satSessionReducer(prev, action));
  }, []);

  const sourceKey = sourceKeyOf(source);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(SAT_SESSION_TIMEOUT_MS),
    ]);

    setStatus("loading");

    (async () => {
      try {
        const rows =
          source.kind === "filter"
            ? await getSession(source.filter, signal)
            : await getSessionByQuestion(source.questionId, signal);
        if (cancelled) return;
        setSession(createInitialSatSessionState(rows));
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        // Our own cleanup abort (StrictMode's first dev mount always
        // aborts) is not an error — only a genuine failure or the
        // timeout's own abort sets the error state.
        if (controller.signal.aborted) return;
        // An id the bank does not hold is an answer, not a failure: an empty
        // session is what the "Question not found" state renders.
        if (
          source.kind === "question" &&
          isTransportError(error) &&
          error.status === 404
        ) {
          setSession(createInitialSatSessionState([]));
          setStatus("ready");
          return;
        }
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey is the canonical, value-stable dependency; `source` itself may be a fresh object every render.
  }, [sourceKey, reloadNonce]);

  const current = session.rows[session.index];

  // Prefetch the next two bodies on every index change (plan §5.3, §5.4).
  useEffect(() => {
    if (status !== "ready") return;
    const upcoming = session.rows.slice(session.index + 1, session.index + 3);
    for (const row of upcoming) {
      void queryClient.prefetchQuery({
        queryKey: satKeys.question(row.id, row.content_sha),
        queryFn: ({ signal }) => getQuestion(row.id, signal),
        staleTime: Infinity,
      });
    }
  }, [status, session.index, session.rows, queryClient]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const goTo = useCallback(
    (index: number) => {
      dispatch({ type: "index_changed", index });
      window.getSelection()?.removeAllRanges();
    },
    [dispatch],
  );

  const answer = useCallback(
    (value: string) => {
      if (!current) return;
      if (selectReveal(session, current.id)) return; // locked after submit (Q18)
      dispatch({ type: "answer_changed", questionId: current.id, answer: value });
    },
    [current, dispatch, session],
  );

  const toggleEliminate = useCallback(
    (label: string) => {
      if (!current) return;
      dispatch({ type: "eliminate_toggled", questionId: current.id, label });
    },
    [current, dispatch],
  );

  const submit = useCallback(
    async (elapsedSeconds: number) => {
      if (!current) return;
      if (selectIsInFlight(session, current.id)) return; // per-question guard (plan §5.3)
      const answerValue = selectAnswer(session, current.id);
      if (answerValue === undefined || answerValue === "") return;

      const reused = selectReusableAttemptId(session, current.id, answerValue);
      const clientAttemptId = reused ?? crypto.randomUUID();
      const questionId = current.id;

      dispatch({
        type: "submit_started",
        questionId,
        answer: answerValue,
        clientAttemptId,
      });

      try {
        const result = await submitAttempt(questionId, {
          client_attempt_id: clientAttemptId,
          answer: answerValue,
          time_spent_seconds: Math.max(1, Math.round(elapsedSeconds)),
          local_date: toLocalDateKey(new Date()),
        });
        dispatch({ type: "submit_succeeded", questionId, result });
        void queryClient.invalidateQueries({ queryKey: satKeys.attempts(questionId) });
        void queryClient.invalidateQueries({ queryKey: [...satKeys.all, "counts"] });
        void queryClient.invalidateQueries({ queryKey: [...satKeys.all, "stats"] });
      } catch (error) {
        dispatch({ type: "submit_failed", questionId });
        toastSatError(error, { client: queryClient });
      }
    },
    [current, dispatch, queryClient, session],
  );

  const toggleBookmark = useCallback(async () => {
    if (!current) return;
    const questionId = current.id;
    const next = !current.bookmarked;
    dispatch({ type: "bookmark_patched", questionId, bookmarked: next });
    try {
      if (next) {
        await putBookmark(questionId);
      } else {
        await deleteBookmark(questionId);
      }
      void queryClient.invalidateQueries({ queryKey: [...satKeys.all, "counts"] });
    } catch (error) {
      dispatch({ type: "bookmark_patched", questionId, bookmarked: !next }); // rollback (plan §5.3)
      toastSatError(error, { client: queryClient });
    }
  }, [current, dispatch, queryClient]);

  const getAnswer = useCallback((id: string) => selectAnswer(session, id), [session]);
  const getEliminations = useCallback(
    (id: string) => selectEliminations(session, id),
    [session],
  );
  const getReveal = useCallback((id: string) => selectReveal(session, id), [session]);
  const getHistory = useCallback((id: string) => selectHistory(session, id), [session]);
  const isInFlight = useCallback((id: string) => selectIsInFlight(session, id), [session]);

  return useMemo(
    () => ({
      status,
      rows: session.rows,
      index: session.index,
      current,
      reload,
      goTo,
      answer,
      toggleEliminate,
      submit,
      toggleBookmark,
      getAnswer,
      getEliminations,
      getReveal,
      getHistory,
      isInFlight,
    }),
    [
      status,
      session.rows,
      session.index,
      current,
      reload,
      goTo,
      answer,
      toggleEliminate,
      submit,
      toggleBookmark,
      getAnswer,
      getEliminations,
      getReveal,
      getHistory,
      isInFlight,
    ],
  );
}
