import type { KnownStepKind, StepData, StepKind } from "@/api/chat/types";

import { mutationGlanceText } from "./components/mutation-receipts/mutation-format";
import { parseMutationReceipt } from "./components/mutation-receipts/parseMutationReceipt";

type KindPresentation = {
  resultNoun: "result" | "thread" | null;
};

const DEFAULT_KIND_PRESENTATION: KindPresentation = { resultNoun: null };

export const KIND_PRESENTATION: Readonly<
  Record<KnownStepKind, KindPresentation>
> = {
  db_tool: DEFAULT_KIND_PRESENTATION,
  sql: DEFAULT_KIND_PRESENTATION,
  web_search: { resultNoun: "result" },
  edu_search: { resultNoun: "result" },
  reddit_search: { resultNoun: "thread" },
  viz: DEFAULT_KIND_PRESENTATION,
  skill: DEFAULT_KIND_PRESENTATION,
  research: DEFAULT_KIND_PRESENTATION,
  write_plan: DEFAULT_KIND_PRESENTATION,
  workspace: DEFAULT_KIND_PRESENTATION,
  memory: DEFAULT_KIND_PRESENTATION,
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

/** The same safe glance formatter the mutation receipt shell renders — used
 * so the visible collapsed row and `runMarkdownOf()` copy/export always
 * agree (plan §11.2). `null` when there's no valid mutation to glance. */
export function stepMutationGlance(step: StepData): string | null {
  const receipt = parseMutationReceipt(step.detail?.mutation);
  return receipt === null ? null : mutationGlanceText(receipt);
}

/** DB/sql/viz internals stay hidden; this only reveals the student-facing
 * StepDetail fields that are already safe to render in the run surface. */
export function receiptText(step: StepData): string | null {
  const mutationGlance = stepMutationGlance(step);
  if (mutationGlance !== null) {
    return mutationGlance;
  }
  if (
    (step.status !== "end" && step.status !== "error") ||
    step.kind === "write_plan"
  ) {
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
  if (
    isSearchKind(step.kind) &&
    detail.query !== undefined &&
    detail.query !== ""
  ) {
    parts.push(`"${detail.query}"`);
  }

  const resultNoun = presentationForKind(step.kind).resultNoun;
  if (typeof detail.result_count === "number" && resultNoun !== null) {
    parts.push(
      `${detail.result_count} ${resultNoun}${detail.result_count === 1 ? "" : "s"}`,
    );
  }
  if (typeof detail.value_count === "number") {
    parts.push(
      `${detail.value_count} ${detail.value_count === 1 ? "value" : "values"}`,
    );
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
  if (detail.domain_id !== undefined && detail.domain_id !== "") {
    parts.push(`Domain: ${detail.domain_id}`);
  }
  if (detail.sources !== undefined) {
    const sources = formatList("Sources", detail.sources);
    if (sources !== null) {
      parts.push(sources);
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
