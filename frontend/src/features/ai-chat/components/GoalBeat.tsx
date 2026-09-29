import { RotateCwIcon } from "lucide-react";

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
 * The in-stream goal check (plans/goal-mode-plan.md §5.2 point 5, §5.4) —
 * the one beat an ordinary turn never has: the agent stopped and an
 * independent check looked at the goal. `ChatMessage.tsx` only ever passes a
 * `phase: "check"` goal step here (`criteria` and `final` feed the goal line
 * and the result instead).
 *
 * The backend emits this step BEFORE it decides whether the run continues,
 * so it states only what the check found — never that the run kept going,
 * which a check that then hit a budget or a stall would make a false claim.
 * What follows it on screen (more work, or the result) says the rest.
 *
 * A check that found everything met renders nothing: the result directly
 * below says exactly that, and saying it twice is noise.
 */
export function GoalCheckBeat({ step }: Props) {
  const detail = step.detail?.goal;
  if (detail === undefined || detail === null) {
    return null;
  }

  const outstanding = detail.criteria.filter(
    (criterion) => criterion.met !== true,
  );
  if (outstanding.length === 0) {
    return null;
  }

  return (
    <ToolBeatRow aria-live="polite">
      <ToolBeatIcon>
        <RotateCwIcon className="size-3.5" strokeWidth={2} />
      </ToolBeatIcon>
      <div className="min-w-0">
        <ToolBeatLabel state="settled">
          Checked the goal: {detail.met_count} of {detail.total_count} done.
          Still missing:
        </ToolBeatLabel>
        {outstanding.length > 0 && (
          <ul className="mt-0.5">
            {outstanding.map((criterion) => (
              <li key={criterion.id}>
                <ToolBeatSubtitle>
                  {/* `reason` is `""` (not `null`) for a criterion the check
                      never assessed, so a length test — not `??` — is what
                      guarantees every outstanding criterion is named. */}
                  {criterion.reason !== null && criterion.reason.length > 0
                    ? criterion.reason
                    : criterion.text}
                </ToolBeatSubtitle>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolBeatRow>
  );
}
