import { Badge } from "@/components/ui/badge";
import type { PendingChangeCounts } from "@/features/essays/suggestions/suggestion-counts";
import { cn } from "@/lib/utils";

/*
 * The one thing beside an essay conversation that is not the model talking.
 *
 * A reply is prose, and prose can be wrong: the agent has claimed to propose an
 * edit on a turn where it made no tool call at all, which left a student
 * looking for changes that were never written. Nothing in the transcript could
 * contradict that, and the pending-changes bar unmounts at zero — so the state
 * the claim was false about was the one state with no surface.
 *
 * This is that surface. It reads the counts off the essay record the workspace
 * cache holds, never off the message stream, and it is honest at zero for
 * exactly the reason it exists: "None" is the reading that refutes the claim.
 * It is deliberately NOT a validator — it does not inspect, gate or rewrite
 * anything the agent says (the repo removed that whole layer on purpose). It
 * just states what is true, next to whatever was said.
 *
 * Both surfaces that host an essay conversation render it — the editor's chat
 * panel and the main chat's essay document panel — because they run the same
 * essay tools and so carry the same failure. One component, because it is one
 * fact stated for one reason; `className` only ever adjusts the band to the
 * chrome it docks under (inset, rule colour), never what it says.
 *
 * Callers must mount it only where the counts are KNOWN, and must source them
 * from `countPendingChanges` — the same function `SuggestionsBar` counts itself
 * with. Both of those are honesty constraints, not tidiness: a readout that
 * renders "None" while the essay is still loading is the same lie in the other
 * direction, and a readout doing its own arithmetic printed "3 waiting" above a
 * bar saying "proposed 2 changes" — a student who catches the app disagreeing
 * with itself has no reason to believe this band the next time it contradicts
 * the model, which is the whole asset.
 */
export function PendingChangesReadout({
  announce = false,
  className,
  counts,
}: {
  /**
   * Announce a change in the counts politely.
   *
   * Off by default, and that is the honest default: wherever `SuggestionsBar`
   * is reachable it already announces "Counselle proposed N changes", so a
   * second live region here made a screen reader say the same fact twice in two
   * grammars. The one state where it is not reachable is the editor's chat
   * panel *covering* the document, which makes the scroll column — and the bar
   * inside it — `inert`, and its announcement goes with it. That is the state
   * this opts into, and the only one.
   */
  announce?: boolean;
  className?: string;
  counts: PendingChangeCounts;
}) {
  const { outdated, waiting } = counts;

  return (
    <div
      className={cn(
        /*
         * The pair sits together, deliberately not `justify-between`. Spread to
         * the band's two walls, "Proposed changes" and its value measured up to
         * 1094px apart in the document panel at 1280 — the value landing in
         * dead margin beside a content column it was nowhere near, so the two
         * fragments stopped reading as one statement. They are a label and its
         * reading; they belong at reading distance. The inset stays the host
         * header's, so the label's left edge still matches the title above it.
         */
        "flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs",
        className,
      )}
      role={announce ? "status" : undefined}
    >
      <span className="text-muted-foreground">Proposed changes</span>
      {/* Keyed on the reading so a new one fades in rather than swapping under
       * the eye — the surface-enter vocabulary, 200ms `ease-out`, motion-gated.
       * The easing is explicit because `animate-in` falls through to plain
       * `ease` without it, and DESIGN.md rule 27 wants `ease-out` on entry. */}
      <span
        className="flex items-center gap-2 tabular-nums motion-safe:animate-in motion-safe:fade-in duration-200 ease-out"
        key={`${waiting}:${outdated}`}
      >
        {waiting > 0 && (
          /*
           * A chip only ever appears when something is waiting on the student,
           * which is what `warning` claims under DESIGN.md Law 2 — and the
           * appearing is the point. Zero and N were previously the same size,
           * weight, colour and position, so peripherally the band did not
           * change at all; here the shape changes, the word changes and the hue
           * changes together, never hue alone (§14.3).
           */
          <Badge variant="warning">{waiting} waiting</Badge>
        )}
        {outdated > 0 && (
          /*
           * Stale ink, the same token the bar's own outdated rows take, because
           * an outdated change is not waiting on anybody — it is inert, and it
           * must not read as a second thing to do.
           */
          <span className="text-(--essay-suggestion-stale-ink)">
            {outdated} outdated
          </span>
        )}
        {waiting === 0 && outdated === 0 && (
          /*
           * "None waiting" read as "none have arrived *yet*" — an invitation to
           * keep waiting, the exact opposite of the refutation, in the one
           * moment the band exists for. Said against the label above it this is
           * "Proposed changes: None", which is the house pattern for an absent
           * value (§13.4) and cannot be read the other way.
           */
          <span className="font-medium">None</span>
        )}
      </span>
    </div>
  );
}
