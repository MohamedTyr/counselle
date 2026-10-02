import { describe, expect, it } from "vitest";

import { skipMissingVertices } from "@/features/sat/sat-analytics";

describe("skipMissingVertices", () => {
  it("leaves fully measured axes alone", () => {
    expect(skipMissingVertices([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
  });

  it("puts a gap on the straight edge between its neighbours", () => {
    const [, gap] = skipMissingVertices([50, null, 50, 50, 50, 50, 50, 50]);
    // The chord between two equal neighbours 90 degrees apart crosses the
    // axis between them at cos(45deg) of their radius.
    expect(gap).toBeCloseTo(50 * Math.cos(Math.PI / 4), 5);
  });

  it("keeps gaps at the centre when fewer than two axes are measured", () => {
    expect(skipMissingVertices([null, 40, null, null])).toEqual([0, 40, 0, 0]);
  });
});
