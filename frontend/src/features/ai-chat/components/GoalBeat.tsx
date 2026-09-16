import type { StepData } from "@/api/chat/types";

import { ToolBeatIcon, ToolBeatLabel, ToolBeatRow, ToolBeatSubtitle } from "./ToolBeat";

type Props = Readonly<{ step: StepData }>;

/**
 * The `compaction` beat (plans/goal-mode-plan.md §5.4) — the quietest row on
 * the surface (C4): the model never mentions compaction in its own prose, so
 * this one-line beat is the only place a student learns it happened.
 *
 * Emitted as a single settled step (there is no in-progress phase to show —
 * clearing is synchronous), so this never renders a running/spinner state.
 *
 * Extended in Phase 5 with the in-stream `goal` check beat.
 */
export function CompactionBeat({ step }: Props) {
  return (
    <ToolBeatRow aria-live="polite">
      <ToolBeatIcon>·</ToolBeatIcon>
      <ToolBeatLabel state="settled">{step.label}</ToolBeatLabel>
    </ToolBeatRow>
  );
}

/**
 * The in-stream goal check beat (plans/goal-mode-plan.md §5.2 point 5,
 * §5.4) — one compact row per round. `ChatMessage.tsx` only ever passes a
 * `phase: "check"` goal step here (`criteria` and `final` are suppressed
 * before reaching this dispatch, feeding the header/card instead), so this
 * never needs its own phase check.
 *
 * The header's criteria flip their marks and its counters advance at the
 * same moment this beat renders — both derive from the same latest `goal`
 * step, so they never disagree about where the run stands.
 */
export function GoalCheckBeat({ step }: Props) {
  const detail = step.detail?.goal;
  if (detail === undefined || detail === null) {
    return null;
  }

  const outstanding = detail.criteria.filter(
    (criterion) => criterion.met !== true,
  );

  return (
    <ToolBeatRow aria-live="polite">
      <ToolBeatIcon>◆</ToolBeatIcon>
      <div className="min-w-0">
        <ToolBeatLabel state="settled">
          Checked against the goal — {detail.met_count} of{" "}
          {detail.total_count} done · continuing
        </ToolBeatLabel>
        {outstanding.length > 0 && (
          <ToolBeatSubtitle>
            Still outstanding:{" "}
            {outstanding
              // `reason` is `""` (not `null`) for a criterion the judge
              // never assessed, so `??` doesn't fall through — an empty
              // segment would render, e.g. "Still outstanding: ; c4 not
              // reached". A length check (not just nullish-coalescing)
              // guarantees every criterion is named.
              .map((criterion) =>
                criterion.reason && criterion.reason.length > 0
                  ? criterion.reason
                  : criterion.text,
              )
              .join("; ")}
          </ToolBeatSubtitle>
        )}
      </div>
    </ToolBeatRow>
  );
}
