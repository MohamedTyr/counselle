/** Read a nested value by dot-path, returning `undefined` past any missing
 * or non-object segment (never throws on a partially-filled profile). */
export function getAtPath(source: unknown, path: readonly string[]): unknown {
  let current = source
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Build a minimal nested merge-patch object with `value` at `path`,
 * leaving every sibling key at every depth omitted. The backend applies an
 * RFC 7396-style deep merge (`app/workspace/service_profile.py::_merge_patch`):
 * an omitted key is left alone, `null` clears it. Sending only the touched
 * leaf — never a whole section — is what keeps per-field autosave-on-blur
 * honest to that contract.
 */
export function buildPatchAtPath(
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    throw new Error("buildPatchAtPath requires a non-empty path")
  }
  const [head, ...rest] = path
  if (rest.length === 0) {
    return { [head]: value }
  }
  return { [head]: buildPatchAtPath(rest, value) }
}

/** Parses the comma-separated editor text for a string-list field back into
 * `string[] | null` — empty input clears the field (`null`), matching the
 * merge-patch clear semantics rather than sending `[]`. */
export function parseStringList(text: string): string[] | null {
  const items = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : null
}

export function formatStringList(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : ""
}
