import { describe, expect, it } from "vitest";

import {
  markerCoversCaption,
  layoutPaceMarkers,
  paceAxis,
  paceMarkerGap,
  paceMarkerSize,
  paceVerticalPad,
} from "@/features/sat/sat-pace-layout";

const SIZE = { width: 600, height: 300 };
const MARKER = 24;

function minDistance(spots: readonly { left: number; top: number }[]): number {
  let min = Infinity;
  for (const [i, a] of spots.entries()) {
    for (const b of spots.slice(i + 1)) {
      min = Math.min(min, Math.hypot(a.left - b.left, a.top - b.top));
    }
  }
  return min;
}

describe("layoutPaceMarkers", () => {
  it("leaves a lone point on its true position, inset from the edges", () => {
    const [only] = layoutPaceMarkers([{ x: 60, y: 50 }], SIZE, 120);
    expect(only).toMatchObject({ left: 300, top: 150, homeLeft: 300, homeTop: 150 });
    const [top] = layoutPaceMarkers([{ x: 60, y: 100 }], SIZE, 120);
    expect(top.top).toBe(paceVerticalPad(MARKER));
  });

  it("separates coincident points to at least one marker gap", () => {
    const spots = layoutPaceMarkers(
      Array.from({ length: 5 }, () => ({ x: 15, y: 0 })),
      SIZE,
      120,
    );
    expect(minDistance(spots)).toBeGreaterThanOrEqual(paceMarkerGap(MARKER) - 0.001);
  });

  it("keeps eight coincident points visible on a phone-width plot", () => {
    const phone = { width: 250, height: 200 };
    const px = paceMarkerSize(phone.width);
    const spots = layoutPaceMarkers(
      Array.from({ length: 8 }, () => ({ x: 8, y: 100 })),
      phone,
      40,
      px,
    );
    expect(minDistance(spots)).toBeGreaterThanOrEqual(paceMarkerGap(px) - 0.001);
    for (const spot of spots) {
      expect(spot.left).toBeGreaterThanOrEqual(px / 2);
      expect(spot.left).toBeLessThanOrEqual(phone.width - px / 2);
      expect(spot.top).toBeGreaterThanOrEqual(paceVerticalPad(px) - 0.001);
      expect(spot.top).toBeLessThanOrEqual(phone.height - paceVerticalPad(px) + 0.001);
    }
  });

  it("is deterministic and keeps the first point's true spot", () => {
    const input = [
      { x: 15, y: 0 },
      { x: 15, y: 0 },
    ];
    const first = layoutPaceMarkers(input, SIZE, 120);
    expect(layoutPaceMarkers(input, SIZE, 120)).toEqual(first);
    expect(first[0]).toMatchObject({ left: 75, top: SIZE.height - paceVerticalPad(MARKER) });
  });
});

describe("nudge cap", () => {
  it("keeps every marker within a few gaps of its true point", () => {
    const spots = layoutPaceMarkers(
      Array.from({ length: 8 }, () => ({ x: 60, y: 50 })),
      SIZE,
      120,
    );
    for (const spot of spots) {
      expect(Math.hypot(spot.left - spot.homeLeft, spot.top - spot.homeTop)).toBeLessThanOrEqual(
        4 * paceMarkerGap(MARKER) + 4,
      );
    }
  });
});

describe("paceAxis", () => {
  it("scales to the data with headroom, never below 30 seconds", () => {
    expect(paceAxis(10)).toEqual({ max: 30, step: 5 });
    expect(paceAxis(25)).toEqual({ max: 40, step: 10 });
  });

  it("grows to hold slow skills on a round tick", () => {
    expect(paceAxis(130)).toEqual({ max: 240, step: 60 });
  });
});

describe("markerCoversCaption", () => {
  const box = { left: 12, top: 16, width: 100, height: 12 };

  it("detects a marker over the caption and ignores a distant one", () => {
    expect(markerCoversCaption(box, [{ left: 60, top: 20 }], MARKER)).toBe(true);
    expect(markerCoversCaption(box, [{ left: 300, top: 200 }], MARKER)).toBe(false);
  });
});
