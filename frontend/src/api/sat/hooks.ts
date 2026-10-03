import { usePrivateMutation } from "@/app/private-mutations";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { toastSatError } from "@/api/sat/errors";
import { satKeys } from "@/api/sat/keys";
import {
  deleteBookmark,
  getAttempts,
  getCounts,
  getQuestion,
  getStats,
  getTaxonomy,
  importProgress,
  putBookmark,
  resetProgress,
} from "@/api/sat/client";
import type { SatFilterQuery } from "@/api/sat/types";

/**
 * Server-state hooks (plan §5.3's table). `GET /session` is deliberately not
 * here — `useSatSession` owns that fetch outside TanStack Query.
 */

/** Static for the life of the tab (plan §5.3). */
export function useSatTaxonomy() {
  return useQuery({
    queryKey: satKeys.taxonomy(),
    queryFn: ({ signal }) => getTaxonomy(signal),
    staleTime: Infinity,
  });
}

/** `keepPreviousData` so the skill/domain counts don't blank between filter
 * changes (plan §5.3) — `/counts` ignores the skill selection (§4.5), so
 * `filter.skills` is accepted for a uniform call shape but never sent. */
export function useSatCounts(filter: SatFilterQuery) {
  return useQuery({
    queryKey: satKeys.counts(filter),
    queryFn: ({ signal }) => getCounts(filter, signal),
    placeholderData: keepPreviousData,
  });
}

/** Keyed by `content_sha` (plan §5.4): a bank refresh between sessions only
 * invalidates the questions that actually changed. `retry: 2` — a prefetch
 * miss should not strand a student on a body that never loads (plan §5.3). */
export function useSatQuestion(id: string, contentSha: string) {
  return useQuery({
    queryKey: satKeys.question(id, contentSha),
    queryFn: ({ signal }) => getQuestion(id, signal),
    staleTime: Infinity,
    retry: 2,
    enabled: Boolean(id),
  });
}

export function useSatAttempts(id: string) {
  return useQuery({
    queryKey: satKeys.attempts(id),
    queryFn: ({ signal }) => getAttempts(id, signal),
    enabled: Boolean(id),
  });
}

export function useSatStats(today: string) {
  return useQuery({
    queryKey: satKeys.stats(today),
    queryFn: ({ signal }) => getStats(today, signal),
  });
}

/** Bookmarks: idempotent set/clear, not a toggle (plan §4.2). The practice
 * screen's optimistic patch + rollback lives on the session row inside
 * `useSatSession` (plan §5.3) — these mutations only make the call and, on
 * settle, invalidate `counts` so the dashboard's bookmark tallies catch up. */
export function usePutBookmark() {
  return usePrivateMutation({
    mutationFn: putBookmark,
    onError: (error, _id, _onMutateResult, context) => {
      toastSatError(error, { client: context.client });
    },
    onSettled: (_data, _error, _id, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: [...satKeys.all, "counts"],
      });
    },
  });
}

export function useDeleteBookmark() {
  return usePrivateMutation({
    mutationFn: deleteBookmark,
    onError: (error, _id, _onMutateResult, context) => {
      toastSatError(error, { client: context.client });
    },
    onSettled: (_data, _error, _id, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: [...satKeys.all, "counts"],
      });
    },
  });
}

/** Import = replace (plan §5.7, A13): nothing here is optimistic. Success
 * invalidates `satKeys.all` so no stale session, counts, or stats can
 * survive a wholesale replace. */
export function useImportProgress() {
  return usePrivateMutation({
    mutationFn: ({ today, file }: { today: string; file: File }) =>
      importProgress(today, file),
    onError: (error, _vars, _onMutateResult, context) => {
      toastSatError(error, {
        client: context.client,
        copy: {
          tooLarge: "That file is too large to import.",
          invalid: "Invalid .liprep backup format.",
        },
      });
    },
    onSettled: (_data, _error, _vars, _onMutateResult, context) => {
      void context.client.invalidateQueries({ queryKey: satKeys.all });
    },
  });
}

/** Reset: attempts + bookmarks only (plan §4.2, A14). */
export function useResetProgress() {
  return usePrivateMutation({
    mutationFn: resetProgress,
    onError: (error, _vars, _onMutateResult, context) => {
      toastSatError(error, { client: context.client });
    },
    onSettled: (_data, _error, _vars, _onMutateResult, context) => {
      void context.client.invalidateQueries({ queryKey: satKeys.all });
    },
  });
}
