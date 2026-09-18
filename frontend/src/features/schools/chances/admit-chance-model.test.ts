import { describe, expect, test } from "vitest";

import {
  academicWeight,
  estimateChance,
  normalCdf,
  normalQuantile,
} from "./admit-chance-model";

describe("normal distribution helpers", () => {
  test("cdf and quantile agree with known values and invert each other", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    for (const p of [0.001, 0.02, 0.3, 0.5, 0.81, 0.999])
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 5);
  });
});

describe("estimateChance", () => {
  test("rises with class standing and never leaves 0..1", () => {
    let previous = 0;
    for (let q = 0.01; q <= 0.99; q += 0.07) {
      const { chance, low, high } = estimateChance(q, 0.2, "private");
      expect(chance).toBeGreaterThanOrEqual(previous);
      expect(low).toBeLessThanOrEqual(chance);
      expect(high).toBeGreaterThanOrEqual(chance);
      expect(high).toBeLessThanOrEqual(1);
      previous = chance;
    }
  });

  /* The honesty pin. Harvard admits about 5% and the published admit rate for
   * its strongest academic decile is 15.3% (Arcidiacono, Kinsler & Ransom,
   * Table 4). Whatever else changes, the very top of a 5%-admit private
   * school's class must stay a long shot, not a likelihood. */
  test("the top of a 5%-admit private class stays a long shot", () => {
    const top = estimateChance(0.99, 0.05, "private");
    expect(top.chance).toBeLessThan(0.3);
    expect(top.high).toBeLessThan(0.4);
    const middle = estimateChance(0.5, 0.05, "private");
    expect(middle.chance).toBeGreaterThan(0.03);
    expect(middle.chance).toBeLessThan(0.15);
  });

  /* UNC in-state admits about half its applicants and its published top
   * decile is 98.9%: at a numbers-driven public school, the top of the class
   * is close to certain and the bottom is not hopeless. */
  test("the top of a 50%-admit public class is near certain", () => {
    expect(estimateChance(0.95, 0.5, "public").chance).toBeGreaterThan(0.85);
    expect(estimateChance(0.05, 0.5, "public").chance).toBeLessThan(0.5);
  });

  test("the same standing is worth less at a more selective school", () => {
    const selective = estimateChance(0.6, 0.08, "private").chance;
    const open = estimateChance(0.6, 0.7, "private").chance;
    expect(selective).toBeLessThan(open);
  });
});

describe("academicWeight", () => {
  test("academics decide more at public and at less selective schools", () => {
    expect(academicWeight(0.05, "private")).toBeLessThan(academicWeight(0.05, "public"));
    expect(academicWeight(0.1, "public")).toBeLessThan(academicWeight(0.6, "public"));
    const unknown = academicWeight(0.2, null);
    expect(unknown).toBeGreaterThan(academicWeight(0.2, "private"));
    expect(unknown).toBeLessThan(academicWeight(0.2, "public"));
  });
});
