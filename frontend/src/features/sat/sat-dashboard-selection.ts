/** Pure `Set` helpers for the dashboard's skill/band selection state
 * (plan §5.1, §5.3; parity F20). No React, no fetch — split out of
 * `SatDashboard.tsx` (plan §5.2's 400-line cap).
 */

export function toggledSet<T>(current: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(current);
  if (next.has(item)) {
    next.delete(item);
  } else {
    next.add(item);
  }
  return next;
}

export function withMembership<T>(
  current: ReadonlySet<T>,
  items: readonly T[],
  present: boolean,
): Set<T> {
  const next = new Set(current);
  for (const item of items) {
    if (present) {
      next.add(item);
    } else {
      next.delete(item);
    }
  }
  return next;
}

/** F20: never encode the full taxonomy/band list to say "all". */
export function collapseIfFull<T>(selected: ReadonlySet<T>, full: readonly T[]): T[] {
  return selected.size >= full.length ? [] : Array.from(selected);
}
