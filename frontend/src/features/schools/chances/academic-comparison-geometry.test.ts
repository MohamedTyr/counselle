import { describe, expect, test } from "vitest";

import { PLOT_WINDOW_TICK, plotWindow } from "./academic-comparison-geometry";

describe("plotWindow", () => {
  test("PLOT_WINDOW_TICK names each metric's snap grid once", () => {
    expect(PLOT_WINDOW_TICK).toEqual({ gpa: 0.25, sat: 20, act: 1 });
  });

  test("plan's worked example: ACT band 30-34 with a student at 33 crops to roughly 28-36, not 1-36", () => {
    const window = plotWindow("act", { min: 1, max: 36 }, [30, 34], 33);

    expect(window).toEqual({ lo: 29, hi: 35 });
    // The point of the fix: a window dramatically smaller than the full
    // instrument scale, centered on the reported band.
    expect(window.hi - window.lo).toBeLessThan(36 - 1);
    expect(window.lo).toBeGreaterThan(1);
    expect(window.hi).toBeLessThan(36);
  });

  test("clamps to the instrument domain, redistributing slack to the open side", () => {
    // Drawn data + student value push the padded/widened span below the ACT
    // floor of 1; the lo edge is pinned there and the excess width the floor
    // would have given the lo side is added to hi instead.
    const window = plotWindow("act", { min: 1, max: 36 }, [2, 4], 1);

    expect(window).toEqual({ lo: 1, hi: 7 });
  });

  test("never narrower than 15% of the instrument scale (the floor)", () => {
    // A 1-point ACT band would otherwise pad to ~1.24 points; the 15% floor
    // (5.25 points on a 1-36 scale) takes over and widens around the center.
    const window = plotWindow("act", { min: 1, max: 36 }, [30, 31], 30.5);

    expect(window).toEqual({ lo: 27, hi: 34 });
    expect(window.hi - window.lo).toBeGreaterThanOrEqual((36 - 1) * 0.15);
  });

  test("snaps outward to the metric's tick with no float drift", () => {
    const window = plotWindow("gpa", { min: 0, max: 4 }, [3.0, 3.5], 3.2);

    expect(window).toEqual({ lo: 2.75, hi: 3.75 });
    // Exact decimal equality, not "close to" — this is what a rendered tick
    // label reads, and it must never show `3.7500000001`.
    expect(Number.isInteger(window.lo * 100)).toBe(true);
    expect(Number.isInteger(window.hi * 100)).toBe(true);
  });

  test("a student value outside the drawn band still widens the span to include it", () => {
    const window = plotWindow("act", { min: 1, max: 36 }, [30, 34], 20);

    expect(window).toEqual({ lo: 18, hi: 36 });
    expect(window.lo).toBeLessThanOrEqual(20);
    expect(window.hi).toBeGreaterThanOrEqual(20);
  });

  test("a student value outside the instrument scale entirely is clamped into the domain, not left to blow up the window", () => {
    // e.g. a GPA reported on a non-4.0 scale slipping through as a raw 5.0.
    const window = plotWindow("gpa", { min: 0, max: 4 }, [3.0, 3.5], 5.0);

    expect(window).toEqual({ lo: 2.75, hi: 4 });
    expect(window.hi).toBeLessThanOrEqual(4);
  });

  test("a single point of drawn data (an average, no band) still produces a sane window via the 15% floor", () => {
    const window = plotWindow("act", { min: 1, max: 36 }, [15], undefined);

    expect(window).toEqual({ lo: 12, hi: 18 });
    expect(window.lo).toBeLessThanOrEqual(15);
    expect(window.hi).toBeGreaterThanOrEqual(15);
  });

  test("no drawn data and no student value falls back to the full instrument domain", () => {
    const window = plotWindow("act", { min: 1, max: 36 }, [], null);

    expect(window).toEqual({ lo: 1, hi: 36 });
  });

  test("a degenerate min === max instrument domain returns that single point rather than dividing by zero", () => {
    const window = plotWindow("sat", { min: 700, max: 700 }, [700], 700);

    expect(window).toEqual({ lo: 700, hi: 700 });
  });

  test("is pure and stable: identical inputs produce an identical window", () => {
    const first = plotWindow("sat", { min: 200, max: 800 }, [690, 760], 725);
    const second = plotWindow("sat", { min: 200, max: 800 }, [690, 760], 725);

    expect(first).toEqual(second);
  });
});
