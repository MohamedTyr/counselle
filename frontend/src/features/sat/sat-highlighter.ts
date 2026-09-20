// Pure offset arithmetic for the passage/stem highlighter (plan.md §6.3;
// parity-inventory Q33, Q33a, Q34). No DOM here — `use-sat-highlighter.ts`
// (another agent's file) walks text nodes to turn these offsets into
// `Range`s for the CSS Custom Highlight API.
//
// Storage is a sorted, merged, non-overlapping list of half-open
// `[start, end)` character offsets into a field's `textContent` — never
// persisted, dropped on question change (Q34).

/** A half-open character offset range `[start, end)`. */
export type Offset = readonly [start: number, end: number];

function rangeLength([start, end]: Offset): number {
  return Math.max(0, end - start);
}

/**
 * Sorts and merges overlapping or touching ranges into the canonical form
 * every other function in this module assumes and returns. Zero-length
 * ranges are dropped. "Adjacent marks merge" (Q33) — touching ranges
 * (`start <= previous end`) merge, not just overlapping ones.
 */
function normalize(ranges: readonly Offset[]): Offset[] {
  const sorted = ranges
    .filter((range) => rangeLength(range) > 0)
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: Offset[] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], end)];
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Adds a highlight range, merging it with any existing range it overlaps
 * or touches. */
export function addRange(
  existing: readonly Offset[],
  addition: Offset,
): Offset[] {
  return normalize([...existing, addition]);
}

/** Removes a range, splitting any existing range it partially overlaps. */
export function subtractRange(
  existing: readonly Offset[],
  removal: Offset,
): Offset[] {
  const [removeStart, removeEnd] = removal;
  const result: Offset[] = [];
  for (const [start, end] of normalize(existing)) {
    if (end <= removeStart || start >= removeEnd) {
      result.push([start, end]);
      continue;
    }
    if (start < removeStart) {
      result.push([start, removeStart]);
    }
    if (end > removeEnd) {
      result.push([removeEnd, end]);
    }
  }
  return result;
}

/** The total length of `existing`'s overlap with `range`. */
export function coveredLength(
  existing: readonly Offset[],
  range: Offset,
): number {
  const [rangeStart, rangeEnd] = range;
  let total = 0;
  for (const [start, end] of existing) {
    const overlapStart = Math.max(start, rangeStart);
    const overlapEnd = Math.min(end, rangeEnd);
    if (overlapEnd > overlapStart) {
      total += overlapEnd - overlapStart;
    }
  }
  return total;
}

/** Merges a set of ranges (e.g. a selection clipped into several
 * highlightable fields) into their union, deduplicating any overlap among
 * themselves before it is compared against `existing` (plan §6.3: coverage
 * is measured over the union, so a multi-range selection cannot add and
 * subtract in one gesture). */
export function unionRanges(ranges: readonly Offset[]): Offset[] {
  return normalize(ranges);
}

export function totalLength(ranges: readonly Offset[]): number {
  return ranges.reduce((sum, range) => sum + rangeLength(range), 0);
}

/** Clips `range` to `bounds`, or `null` if nothing remains. */
export function clipRange(range: Offset, bounds: Offset): Offset | null {
  const start = Math.max(range[0], bounds[0]);
  const end = Math.min(range[1], bounds[1]);
  return end > start ? [start, end] : null;
}

const MAJORITY_COVERAGE_THRESHOLD = 0.5;

/**
 * The toggle decision (plan §6.3): more than half of the selection's union
 * is already highlighted → subtract; otherwise add. An empty union (nothing
 * clipped into a highlightable field) never subtracts.
 */
export function shouldSubtract(
  existing: readonly Offset[],
  selectionRanges: readonly Offset[],
): boolean {
  const union = unionRanges(selectionRanges);
  const total = totalLength(union);
  if (total === 0) {
    return false;
  }
  const covered = union.reduce(
    (sum, range) => sum + coveredLength(existing, range),
    0,
  );
  return covered / total > MAJORITY_COVERAGE_THRESHOLD;
}

/**
 * Applies one highlighter gesture: unions the selection's clipped ranges,
 * decides add vs. subtract from their coverage of `existing`, then applies
 * that single decision to every range in the union.
 */
export function applyHighlightToggle(
  existing: readonly Offset[],
  selectionRanges: readonly Offset[],
): Offset[] {
  const union = unionRanges(selectionRanges);
  if (union.length === 0) {
    return normalize(existing);
  }

  const subtract = shouldSubtract(existing, union);
  return union.reduce(
    (ranges, range) =>
      subtract ? subtractRange(ranges, range) : addRange(ranges, range),
    normalize(existing),
  );
}
