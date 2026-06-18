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
