import { describe, expect, it } from "vitest";

import {
  PACE_MARKER_GAP_PX,
  layoutPaceMarkers,
  paceAxisMax,
} from "@/features/sat/sat-pace-layout";

const SIZE = { width: 600, height: 300 };

describe("layoutPaceMarkers", () => {
  it("leaves a lone point on its true position", () => {
    const [only] = layoutPaceMarkers([{ x: 60, y: 50 }], SIZE, 120);
    expect(only).toEqual({ left: 300, top: 150 });
  });

  it("separates coincident points to at least one marker gap", () => {
    const spots = layoutPaceMarkers(
      Array.from({ length: 5 }, () => ({ x: 15, y: 0 })),
      SIZE,
      120,
    );
    for (const [i, a] of spots.entries()) {
      for (const b of spots.slice(i + 1)) {
        expect(Math.hypot(a.left - b.left, a.top - b.top)).toBeGreaterThanOrEqual(
          PACE_MARKER_GAP_PX - 0.001,
        );
      }
    }
  });

  it("is deterministic and keeps the first point's true spot", () => {
    const input = [
      { x: 15, y: 0 },
      { x: 15, y: 0 },
    ];
    const first = layoutPaceMarkers(input, SIZE, 120);
    expect(layoutPaceMarkers(input, SIZE, 120)).toEqual(first);
    expect(first[0]).toEqual({ left: 75, top: 300 });
  });
});

describe("paceAxisMax", () => {
  it("rounds up past the largest value to a whole tick", () => {
    expect(paceAxisMax(130, 82, 30)).toBe(150);
    expect(paceAxisMax(40, 82, 30)).toBe(120);
  });
});
