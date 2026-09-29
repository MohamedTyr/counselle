import type { StepData, StepSource } from "@/api/chat/types";

import type { Segment, TurnStatus } from "../turn-reducer";
export { isSearchKind, KIND_PRESENTATION, receiptText } from "../step-receipts";

/** `awaiting_input` (parked on a clarify) is NOT live: the agent finished
 *  thinking and asked a question — the trace must settle, not keep
 *  glowing/ticking while the student reads. Mirrors the model's `isLive`. */
const LIVE_STATUSES: ReadonlySet<TurnStatus> = new Set(["streaming", "idle"]);

export function isLiveStatus(status: TurnStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/** Skips item-less `write_plan` steps — the start event carries `detail=None`
 *  (items land on the end event), so the checklist would flicker empty during
 *  the start→end window if we didn't prefer the latest step with items. */
export function latestPlanStep(segments: readonly Segment[]): StepData | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const entry = segments[index];
    if (
      entry.type === "tool" &&
      entry.step.kind === "write_plan" &&
      (entry.step.detail?.items?.length ?? 0) > 0
    ) {
      return entry.step;
    }
  }

  return null;
}

/** Skips `goal` steps with no ledger payload yet, mirroring `latestPlanStep`'s
 *  guard for the same reason: a step can in principle arrive before its
 *  `detail.goal` is populated, and the header must not flicker empty in that
 *  window (plans/goal-mode-plan.md §5.4). */
export function latestGoalStep(segments: readonly Segment[]): StepData | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const entry = segments[index];
    if (
      entry.type === "tool" &&
      entry.step.kind === "goal" &&
      entry.step.detail?.goal != null
    ) {
      return entry.step;
    }
  }

  return null;
}

/**
 * The crash rule (plans/goal-mode-plan.md §5.3): a goal message is
 * "interrupted" — no `phase: "final"` step was ever emitted before the run
 * ended — precisely when it is NOT the turn this client is actively
 * streaming AND its latest `goal` step's `status` is still `null`.
 *
 * Deliberately not a `turnStatus` allowlist. A persisted replay with no
 * terminal event lands on `turnStatus: "idle"` — the same value a genuinely
 * live turn briefly holds before its first event — so an allowlist either
 * misses the crash (idle counted as live) or misfires on a boot window
 * (idle counted as dead). Comparing against the actively-streaming
 * message's id sidesteps the ambiguity entirely: it doesn't matter what
 * `turnStatus` says, only whether THIS message is the one currently being
 * streamed to.
 */
export function isInterruptedGoal(
  message: { messageId: string; segments: readonly Segment[] },
  liveMessageId: string | null,
): boolean {
  if (message.messageId === liveMessageId) {
    return false;
  }

  const goalStep = latestGoalStep(message.segments);
  return goalStep?.detail?.goal?.status == null && goalStep !== null;
}

export const MAX_VISIBLE_SOURCE_CHIPS = 4;

/** Source chips capped and deduped by URL (falling back to label) — a step
 *  that reports the same page twice never doubles its receipt. */
export function dedupeStepSources(
  sources: StepSource[] | undefined,
): StepSource[] {
  if (sources === undefined) {
    return [];
  }

  const seen = new Set<string>();
  const deduped: StepSource[] = [];

  for (const source of sources) {
    const key = source.url ?? source.label;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}
