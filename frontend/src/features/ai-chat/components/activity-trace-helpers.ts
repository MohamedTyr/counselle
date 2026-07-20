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
