import type { StepData } from "@/api/chat/types";

import { ToolBeatIcon, ToolBeatLabel, ToolBeatRow } from "./ToolBeat";

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
