import type {
  KnownStepKind,
  StepData,
  StepKind,
  StepSource,
} from "@/api/chat/types";

import type { Segment, TurnStatus } from "../turn-reducer";

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
  write_plan: DEFAULT_KIND_PRESENTATION,
};

function presentationForKind(kind: StepKind): KindPresentation {
  return KIND_PRESENTATION[kind as KnownStepKind] ?? DEFAULT_KIND_PRESENTATION;
}

export function isSearchKind(kind: StepKind): boolean {
  return presentationForKind(kind).resultNoun !== null;
}

function formatList(label: string, values: string[]): string | null {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  return clean.length > 0 ? `${label}: ${clean.join(", ")}` : null;
}

/** DB/sql/viz internals stay hidden — `receiptText` only reveals a safe
 *  subset of StepDetail. Field keys, raw row counts, tool names, and timings
 *  stay out of the student-facing run surface. */
export function receiptText(step: StepData): string | null {
  if ((step.status !== "end" && step.status !== "error") || step.kind === "write_plan") {
    return null;
  }

  const detail = step.detail;
  if (detail === null) {
    return null;
  }

  const parts: string[] = [];
  if (detail.error !== undefined && detail.error !== "") {
    parts.push(detail.error);
  }
  if (detail.summary !== undefined && detail.summary !== "") {
    parts.push(detail.summary);
  }
  if (isSearchKind(step.kind) && detail.query !== undefined && detail.query !== "") {
    parts.push(`"${detail.query}"`);
  }

  const resultNoun = presentationForKind(step.kind).resultNoun;
  if (typeof detail.result_count === "number" && resultNoun !== null) {
    const noun = resultNoun;
    parts.push(`${detail.result_count} ${noun}${detail.result_count === 1 ? "" : "s"}`);
  }
  if (typeof detail.value_count === "number") {
    parts.push(`${detail.value_count} ${detail.value_count === 1 ? "value" : "values"}`);
  }
  if (detail.viz_type !== undefined && detail.viz_type !== "") {
    parts.push(detail.viz_type.replaceAll("_", " "));
  }
  if (detail.schools !== undefined) {
    const schools = formatList("Schools", detail.schools);
    if (schools !== null) {
      parts.push(schools);
    }
  }
  if (detail.domains !== undefined) {
    const domains = formatList("Domains", detail.domains);
    if (domains !== null) {
      parts.push(domains);
    }
  }
  if (detail.next_actions !== undefined) {
    const actions = formatList("Next", detail.next_actions);
    if (actions !== null) {
      parts.push(actions);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function latestPlanStep(segments: readonly Segment[]): StepData | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const entry = segments[index];
    if (entry.type === "tool" && entry.step.kind === "write_plan") {
      return entry.step;
    }
  }

  return null;
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
