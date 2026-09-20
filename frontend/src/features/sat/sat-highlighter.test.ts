import { describe, expect, it } from "vitest";

import {
  addRange,
  applyHighlightToggle,
  clipRange,
  coveredLength,
  shouldSubtract,
  subtractRange,
  totalLength,
  unionRanges,
} from "./sat-highlighter";

describe("addRange", () => {
  it("merges overlapping ranges", () => {
    expect(addRange([[0, 10]], [5, 15])).toEqual([[0, 15]]);
  });

  it("merges touching ranges (adjacent marks merge, Q33)", () => {
    expect(addRange([[0, 10]], [10, 20])).toEqual([[0, 20]]);
  });

  it("keeps disjoint ranges separate", () => {
    expect(addRange([[0, 5]], [10, 15])).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });

  it("drops a zero-length addition", () => {
    expect(addRange([[0, 5]], [3, 3])).toEqual([[0, 5]]);
  });
});

describe("subtractRange", () => {
  it("splits a range it partially overlaps", () => {
    expect(subtractRange([[0, 20]], [5, 10])).toEqual([
      [0, 5],
      [10, 20],
    ]);
  });

  it("removes a range it fully covers", () => {
    expect(subtractRange([[5, 10]], [0, 20])).toEqual([]);
  });

  it("leaves untouched ranges alone", () => {
    expect(subtractRange([[0, 5], [10, 15]], [20, 25])).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });

  it("never throws when un-highlighting the middle of a mark (Q34 fix)", () => {
    expect(() => subtractRange([[0, 20]], [8, 12])).not.toThrow();
    expect(subtractRange([[0, 20]], [8, 12])).toEqual([
      [0, 8],
      [12, 20],
    ]);
  });
});

describe("coveredLength", () => {
  it("sums the overlap between existing ranges and a query range", () => {
    expect(
      coveredLength(
        [
          [0, 5],
          [10, 15],
        ],
        [3, 12],
      ),
    ).toBe(4);
  });

  it("is 0 when nothing overlaps", () => {
    expect(coveredLength([[0, 5]], [10, 15])).toBe(0);
  });
});

describe("unionRanges / totalLength", () => {
  it("merges and sums a set of ranges", () => {
    const union = unionRanges([
      [0, 5],
      [4, 10],
      [20, 25],
    ]);
    expect(union).toEqual([
      [0, 10],
      [20, 25],
    ]);
    expect(totalLength(union)).toBe(15);
  });
});

describe("clipRange", () => {
  it("clips a range to bounds", () => {
    expect(clipRange([0, 20], [5, 15])).toEqual([5, 15]);
  });

  it("returns null when nothing remains", () => {
    expect(clipRange([0, 5], [10, 20])).toBeNull();
  });

  it("returns null for a boundary touch with no overlap", () => {
    expect(clipRange([0, 5], [5, 10])).toBeNull();
  });
});

describe("shouldSubtract — the >50% toggle decision (§6.3)", () => {
  it("adds when nothing is covered", () => {
    expect(shouldSubtract([], [[0, 10]])).toBe(false);
  });

  it("adds when the union is empty", () => {
    expect(shouldSubtract([[0, 10]], [])).toBe(false);
  });

  it("subtracts when more than half of the union is already highlighted", () => {
    expect(shouldSubtract([[0, 6]], [[0, 10]])).toBe(true);
  });

  it("adds when exactly half is covered (strict majority required)", () => {
    expect(shouldSubtract([[0, 5]], [[0, 10]])).toBe(false);
  });

  it("computes coverage over the UNION of clipped ranges, not each in isolation", () => {
    // Two disjoint selection ranges: one fully covered (len 5), one
    // uncovered (len 10). Union length 15; covered 5 -> 33%, so this must
    // add, even though the first sub-range alone is 100% covered.
    const existing = [[0, 5]];
    const selection = [
      [0, 5],
      [20, 30],
    ];
    expect(shouldSubtract(existing, selection)).toBe(false);
  });
});

describe("applyHighlightToggle", () => {
  it("adds a new highlight", () => {
    expect(applyHighlightToggle([], [[0, 10]])).toEqual([[0, 10]]);
  });

  it("subtracts a majority-covered selection", () => {
    expect(applyHighlightToggle([[0, 10]], [[2, 8]])).toEqual([
      [0, 2],
      [8, 10],
    ]);
  });

  it("is a no-op over an empty union", () => {
    expect(applyHighlightToggle([[0, 5]], [])).toEqual([[0, 5]]);
  });

  it("applies one decision across every range in a multi-range selection", () => {
    // Mostly-covered union of two ranges -> both subtract, in one gesture.
    const existing = [
      [0, 10],
      [20, 30],
    ];
    const selection = [
      [0, 8],
      [20, 22],
    ];
    const result = applyHighlightToggle(existing, selection);
    expect(result).toEqual([
      [8, 10],
      [22, 30],
    ]);
  });
});
