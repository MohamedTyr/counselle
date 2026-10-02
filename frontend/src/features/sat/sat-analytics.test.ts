import { describe, expect, it } from "vitest";

import { canDrawWeb, skipMissingVertices } from "@/features/sat/sat-analytics";

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

  it("leaves gaps unplotted when fewer than two axes are measured", () => {
    expect(skipMissingVertices([null, 40, null, null])).toEqual([null, 40, null, null]);
  });

  it("leaves a gap unplotted when no edge crosses it", () => {
    const plotted = skipMissingVertices([50, 50, 50, null, null, null, null, null]);
    expect(plotted.slice(3).every((value) => value === null)).toBe(true);
  });
});

describe("canDrawWeb", () => {
  it("needs three measured axes and no unplotted gap", () => {
    expect(canDrawWeb([10, 20, null], 2)).toBe(false);
    expect(canDrawWeb([10, 20, 30, 40], 4)).toBe(true);
    expect(canDrawWeb([10, 20, 30, null], 3)).toBe(false);
  });
});
