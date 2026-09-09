import type { Fact } from "@/features/schools/facts/school-facts-types";

/*
 * A group's facts, split into renderable blocks.
 *
 * `FactGroup.chart` rides the wire (plan §5.2) but the shipped catalog never
 * populates it (`app/facts/service.py::_build_section` always emits
 * `chart=None`). So there is no group-level
 * chart config to key off; each fact's OWN `kind` decides how it renders,
 * and this module's only job is deciding which consecutive facts share one
 * visual instead of each getting its own.
 *
 * `rows` and `ordinal` batch (a name/value table, and the "how they weigh
 * your file" step-grid, both read best as one block of several facts).
 * `band`, `distribution`, `table` and `matrix` never batch — each is its own
 * figure, because batching them would mean plotting unrelated scales (a
 * band) or unrelated tables on top of each other.
 */

export type FactBlock =
  | { renderKind: "rows"; facts: Fact[] }
  | { renderKind: "ordinal"; facts: Fact[] }
  | { renderKind: "band"; facts: Fact[] }
  | { renderKind: "distribution"; facts: Fact[] }
  | { renderKind: "table"; facts: Fact[] };

function visualKind(fact: Fact): FactBlock["renderKind"] {
  switch (fact.kind) {
    case "band":
      return "band";
    case "distribution":
      return "distribution";
    case "ordinal":
      return "ordinal";
    case "table":
    case "matrix":
      return "table";
    default:
      return "rows";
  }
}

const BATCHABLE: ReadonlySet<FactBlock["renderKind"]> = new Set([
  "rows",
  "ordinal",
]);

export function groupBlocks(facts: readonly Fact[]): FactBlock[] {
  const blocks: FactBlock[] = [];
  for (const fact of facts) {
    const kind = visualKind(fact);
    const last = blocks.at(-1);
    if (last && last.renderKind === kind && BATCHABLE.has(kind)) {
      last.facts.push(fact);
      continue;
    }
    blocks.push({ renderKind: kind, facts: [fact] } as FactBlock);
  }
  return blocks;
}
