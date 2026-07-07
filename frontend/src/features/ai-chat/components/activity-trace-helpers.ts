import type { KnownStepKind, StepData, StepKind, StepSource } from "@/api/chat/types";

import type { TurnStatus } from "../turn-reducer";

/** `awaiting_input` (parked on a clarify) is NOT live: the agent finished
 *  thinking and asked a question — the trace must settle, not keep
 *  glowing/ticking while the student reads. Mirrors the model's `isLive`. */
const LIVE_STATUSES: ReadonlySet<TurnStatus> = new Set(["streaming", "idle"]);

export function isLiveStatus(status: TurnStatus): boolean {
  return LIVE_STATUSES.has(status);
}

type KindPresentation = {
  resultNoun: "result" | "thread" | null;
};

const DEFAULT_KIND_PRESENTATION: KindPresentation = { resultNoun: null };

export const KIND_PRESENTATION: Readonly<Record<KnownStepKind, KindPresentation>> = {
  db_tool: DEFAULT_KIND_PRESENTATION,
  sql: DEFAULT_KIND_PRESENTATION,
  web_search: { resultNoun: "result" },
  edu_search: { resultNoun: "result" },
  reddit_search: { resultNoun: "thread" },
  viz: DEFAULT_KIND_PRESENTATION,
  skill: DEFAULT_KIND_PRESENTATION,
  research: DEFAULT_KIND_PRESENTATION,
};

function presentationForKind(kind: StepKind): KindPresentation {
  return KIND_PRESENTATION[kind as KnownStepKind] ?? DEFAULT_KIND_PRESENTATION;
}

export function isSearchKind(kind: StepKind): boolean {
  return presentationForKind(kind).resultNoun !== null;
}

/** DB/sql/viz internals stay hidden — `receiptText` only ever reveals a
 *  receipt for a search-kind step (see `isSearchKind` above), so those kinds
 *  never leak a field/table name through this path. */
export function receiptText(step: StepData): string | null {
  if (!isSearchKind(step.kind) || step.status !== "end") {
    return null;
  }

  const detail = step.detail;
  if (detail === null) {
    return null;
  }

  const parts: string[] = [];
  if (detail.query !== undefined && detail.query !== "") {
    parts.push(`"${detail.query}"`);
  }

  const resultNoun = presentationForKind(step.kind).resultNoun;
  if (typeof detail.result_count === "number" && resultNoun !== null) {
    const noun = resultNoun;
    parts.push(`${detail.result_count} ${noun}${detail.result_count === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export const MAX_VISIBLE_SOURCE_CHIPS = 4;

/** Source chips capped and deduped by URL (falling back to label) — a step
 *  that reports the same page twice never doubles its receipt. */
export function dedupeStepSources(sources: StepSource[] | undefined): StepSource[] {
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

const MS_IN_S = 1000;

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, ms) / MS_IN_S;
  if (totalSeconds < 10) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  return `${Math.round(totalSeconds)}s`;
}
