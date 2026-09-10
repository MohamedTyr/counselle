import type { EssaySuggestion } from "@/domain/essay-suggestion";

/*
 * What a review surface may state about the pending changes, and the one
 * arithmetic that turns the server's rows into it.
 *
 * Not in `SuggestionsBar` because it is not the bar's alone: `PendingChangesReadout`
 * states the same fact on the same screen, and both are components, so the
 * shared function needs a home that is not one of them.
 */

/**
 * One pending change as the live document sees it: where it currently sits,
 * and whether it can still be applied. Both are derived inside the decoration
 * plugin against the document itself — never sent by the server — so the bar
 * reads them from there rather than answering either question twice.
 */
export type SuggestionResolution = {
  /** Document position, or `null` when the change no longer anchors at all. */
  from: number | null;
  id: string;
  stale: boolean;
};

/**
 * The two numbers a review surface may state: what can still be applied, and
 * what can no longer be.
 */
export type PendingChangeCounts = {
  outdated: number;
  waiting: number;
};

/**
 * Split the server's pending rows into those two counts, in one place.
 *
 * Staleness is derived against the live document by the decoration plugin, not
 * sent by the server, so the split is only knowable here — but this bar is not
 * the only surface that states it. `PendingChangesReadout` sits on the same
 * screen, and a second arithmetic over the same rows is how that band came to
 * print "3 waiting" directly above this bar's "Counselle proposed 2 changes":
 * two different numbers for one fact, on the one surface whose entire purpose
 * is being the number a student can trust. One function, so they cannot drift.
 */
export function countPendingChanges(
  suggestions: readonly Pick<EssaySuggestion, "id">[],
  resolutions: readonly SuggestionResolution[],
): PendingChangeCounts {
  const staleIds = new Set(
    resolutions.filter((entry) => entry.stale).map((entry) => entry.id),
  );
  const outdated = suggestions.filter((suggestion) =>
    staleIds.has(suggestion.id),
  ).length;
  return { outdated, waiting: suggestions.length - outdated };
}
