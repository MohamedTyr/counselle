import type { SourceEntry } from '@/api/protocol';

/**
 * Resolve a source index only when the payload has exactly one matching entry.
 * Duplicate marker indexes are malformed; fail closed for honesty-sensitive UI.
 */
export function uniqueSourceByIndex(
  sources: ReadonlyArray<SourceEntry> | undefined,
  index: number,
): SourceEntry | undefined {
  let found: SourceEntry | undefined;
  for (const entry of sources ?? []) {
    if (entry.index !== index) {
      continue;
    }
    if (found !== undefined) {
      return undefined;
    }
    found = entry;
  }
  return found;
}

export function uniqueSourcesByIndexes(
  sources: ReadonlyArray<SourceEntry> | undefined,
  indexes: ReadonlySet<number>,
): SourceEntry[] {
  if (sources === undefined || sources.length === 0 || indexes.size === 0) {
    return [];
  }

  const firstByIndex = new Map<number, SourceEntry>();
  const duplicateIndexes = new Set<number>();
  for (const entry of sources) {
    if (!indexes.has(entry.index)) {
      continue;
    }
    if (firstByIndex.has(entry.index)) {
      duplicateIndexes.add(entry.index);
      continue;
    }
    firstByIndex.set(entry.index, entry);
  }

  return sources.filter(
    (entry) =>
      indexes.has(entry.index) &&
      firstByIndex.get(entry.index) === entry &&
      !duplicateIndexes.has(entry.index),
  );
}
