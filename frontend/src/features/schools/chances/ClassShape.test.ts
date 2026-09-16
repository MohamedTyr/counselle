import { describe, expect, test } from "vitest";

import { steppedAreaData } from "./ClassShape";
import type { ChanceBucket, DistributionModel } from "./school-chances-model";

function bucket(
  label: string,
  pct: number,
  range: ChanceBucket["range"],
): ChanceBucket {
  return { label, pct, absence: null, absenceDisplay: null, range };
}

function distribution(buckets: ChanceBucket[]): DistributionModel {
  return { buckets, omittedBuckets: [], sumsTo: null, reportedPeriod: null };
}

describe("steppedAreaData", () => {
  // FIX 1: an open-ended top bucket ("4.00 and Above") used to clamp to a
  // zero-width point exactly at the window's edge (its raw lo === the
  // domain-capped window.hi) and get filtered out entirely — silently
  // dropping 20% of the reported class from the shape.
  test("keeps an open-ended top bucket as a visible sliver flush to the window's edge", () => {
    const model = distribution([
      bucket("3.75 - 3.99", 60, { lo: 3.75, hi: 3.99, upperInclusive: true }),
      bucket("4.00 and Above", 20, {
        lo: 4,
        hi: Number.POSITIVE_INFINITY,
        upperInclusive: true,
      }),
    ]);

    const data = steppedAreaData(model, { lo: 3.5, hi: 4 }, "gpa");

    // The bucket must show up as a nonzero-width, nonzero-height step, not
    // vanish because it clamped to a single point at x = 4.
    const topStepStart = data.find((point) => point.y === 20);
    expect(topStepStart).toBeDefined();
    expect(topStepStart!.x).toBeLessThan(4);
    expect(topStepStart!.x).toBeGreaterThanOrEqual(3.5);
    const last = data[data.length - 1]!;
    expect(last).toEqual({ x: 4, y: 20 });
  });

  // Mirror case named explicitly by the fix: an open-ended *bottom* bucket.
  // The window pads below the bucket the way `plotWindow()` naturally would
  // (a `-Infinity` lo is excluded from the span computation, so the window
  // floor comes from wherever the domain/other data actually land) — the
  // same "the class continues past this edge" honesty concern as the top
  // bucket, just clamped by `window.lo` instead of `window.hi`.
  test("keeps an open-ended bottom bucket flush to the window's edge instead of dropping it", () => {
    const model = distribution([
      bucket("Below 2.00", 5, {
        lo: Number.NEGATIVE_INFINITY,
        hi: 2,
        upperInclusive: false,
      }),
      bucket("2.00 - 2.49", 15, { lo: 2, hi: 2.49, upperInclusive: true }),
    ]);

    const data = steppedAreaData(model, { lo: 1.5, hi: 3 }, "gpa");

    const firstStep = data[0]!;
    // The open-ended bucket's -Infinity lo clamps to window.lo — it must
    // still be the very first point, at its full reported percentage, not
    // filtered away.
    expect(firstStep).toEqual({ x: 1.5, y: 5 });
    const secondStep = data.find((point) => point.x === 2);
    expect(secondStep).toEqual({ x: 2, y: 15 });
  });

  // FIX 2: 3.50-3.74 and 3.75-3.99 are adjacent GPA bands whose 0.01 gap is
  // only the label's own precision, not a reported 0% zone. The step must
  // hold flat across the seam rather than dipping to zero and back up.
  // Window matches the buckets' own combined span exactly (no trailing
  // window slack) so any zero point in the output can only be the
  // between-bucket canyon this fix removes, not a legitimate
  // no-data-reported tail after the last bucket.
  test("does not drop to zero between buckets whose gap is within the metric's own tick", () => {
    const model = distribution([
      bucket("3.50 - 3.74", 40, { lo: 3.5, hi: 3.74, upperInclusive: true }),
      bucket("3.75 - 3.99", 60, { lo: 3.75, hi: 3.99, upperInclusive: true }),
    ]);

    const data = steppedAreaData(model, { lo: 3.5, hi: 3.99 }, "gpa");

    expect(data.some((point) => point.y === 0)).toBe(false);
    expect(data).toEqual([
      { x: 3.5, y: 40 },
      { x: 3.75, y: 60 },
      { x: 3.99, y: 60 },
    ]);
  });

  // A real reported gap — wider than the metric's tick — must still drop to
  // the baseline; the fix must not paper over genuine 0% zones.
  test("still drops to zero for a real gap wider than the metric's tick", () => {
    const model = distribution([
      bucket("2.00 - 2.49", 10, { lo: 2, hi: 2.49, upperInclusive: true }),
      // A full bucket's width away — nothing reported for 2.50-2.99.
      bucket("3.00 - 3.49", 30, { lo: 3, hi: 3.49, upperInclusive: true }),
    ]);

    const data = steppedAreaData(model, { lo: 2, hi: 3.5 }, "gpa");

    expect(data.find((point) => point.x === 2.49)).toEqual({ x: 2.49, y: 0 });
  });

  // FIX C: the touching tolerance is the metric's *label* precision
  // (0.01 GPA), not its coarser axis tick (0.25 GPA, a full bucket wide).
  // A real gap that sits strictly between the two — 0.20 GPA here — must
  // still drop to zero. Under the old tick-sized tolerance, 0.20 <= 0.25
  // reads as "touching" and the gap is wrongly smoothed away; only the
  // label-precision tolerance (0.20 > 0.01) reports it as the real
  // reported gap it is. A gap of 0.26 (as tried first) would have dropped
  // to zero under *both* tolerances and proven nothing about which one is
  // in effect — the gap has to land inside the (0.01, 0.25] window to
  // discriminate the fix from the bug it replaces.
  test("still drops to zero for a real gap smaller than the axis tick but larger than the label precision", () => {
    const model = distribution([
      bucket("3.00 - 3.30", 25, { lo: 3, hi: 3.3, upperInclusive: true }),
      // 0.20 GPA away — real, reported-nothing gap for 3.30-3.50 — inside
      // the 0.25 GPA axis tick (would wrongly join) but far wider than the
      // 0.01 label seam (correctly still drops to zero).
      bucket("3.50 - 3.74", 35, { lo: 3.5, hi: 3.74, upperInclusive: true }),
    ]);

    const data = steppedAreaData(model, { lo: 3, hi: 3.75 }, "gpa");

    expect(data.find((point) => point.x === 3.3)).toEqual({ x: 3.3, y: 0 });
  });
});
