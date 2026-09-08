import { describe, expect, test } from "vitest";

import { groupBlocks } from "@/features/schools/facts/school-facts-blocks";
import type { Fact } from "@/features/schools/facts/school-facts-types";

function fact(overrides: Partial<Fact> & Pick<Fact, "key" | "kind">): Fact {
  return {
    label: overrides.key,
    tab: "admission",
    state: "value",
    display: "value",
    unit: null,
    value: null,
    observed_at: null,
    reported_period: null,
    caveat_ids: [],
    ...overrides,
  };
}

describe("groupBlocks", () => {
  test("consecutive scalar facts batch into one rows block", () => {
    const facts = [
      fact({ key: "a", kind: "scalar" }),
      fact({ key: "b", kind: "scalar" }),
      fact({ key: "c", kind: "scalar" }),
    ];
    expect(groupBlocks(facts)).toEqual([{ renderKind: "rows", facts }]);
  });

  test("consecutive ordinal facts batch into one ordinal block", () => {
    const facts = [
      fact({ key: "a", kind: "ordinal" }),
      fact({ key: "b", kind: "ordinal" }),
    ];
    expect(groupBlocks(facts)).toEqual([{ renderKind: "ordinal", facts }]);
  });

  test("band, distribution, table and matrix facts never batch — each is its own block", () => {
    const facts = [
      fact({ key: "a", kind: "band" }),
      fact({ key: "b", kind: "band" }),
    ];
    expect(groupBlocks(facts)).toEqual([
      { renderKind: "band", facts: [facts[0]] },
      { renderKind: "band", facts: [facts[1]] },
    ]);
  });

  test("table and matrix share the same render kind but never batch together", () => {
    const facts = [fact({ key: "a", kind: "table" }), fact({ key: "b", kind: "matrix" })];
    expect(groupBlocks(facts)).toEqual([
      { renderKind: "table", facts: [facts[0]] },
      { renderKind: "table", facts: [facts[1]] },
    ]);
  });

  test("a mixed sequence interleaves blocks in the wire's own order", () => {
    /* The real shape of getting-in/test-detail: band, scalar (avg),
     * distribution, repeated per test. Order is the yaml's, and nothing
     * here is allowed to re-sort across kinds. */
    const facts = [
      fact({ key: "band1", kind: "band" }),
      fact({ key: "avg1", kind: "scalar" }),
      fact({ key: "dist1", kind: "distribution" }),
      fact({ key: "avg2", kind: "scalar" }),
    ];
    const blocks = groupBlocks(facts);
    expect(blocks.map((block) => block.renderKind)).toEqual([
      "band",
      "rows",
      "distribution",
      "rows",
    ]);
    expect(blocks[1].facts).toEqual([facts[1]]);
    expect(blocks[3].facts).toEqual([facts[3]]);
  });

  test("every fact lands in exactly one block", () => {
    const facts = [
      fact({ key: "a", kind: "scalar" }),
      fact({ key: "b", kind: "ordinal" }),
      fact({ key: "c", kind: "ordinal" }),
      fact({ key: "d", kind: "band" }),
      fact({ key: "e", kind: "scalar" }),
    ];
    const flattened = groupBlocks(facts).flatMap((block) => block.facts);
    expect(flattened).toEqual(facts);
  });
});
