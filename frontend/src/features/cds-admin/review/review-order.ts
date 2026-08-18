import type { ReviewSection } from "@/api/cds-admin/types";

/**
 * The right pane renders sections in CDS letter order (DESIGN.md §5.6) —
 * "A. General information", "B. Enrolment and persistence", etc. The API
 * already returns `sections` pre-sorted this way: `app/cds/service_review.py`
 * (`_domain_sort_key`) sorts each domain by the natural key of its metrics'
 * lowest `source_hint` (e.g. `"A1"` → `("A", 1)`). This module mirrors only
 * the *display letter* derivation so the header can show it — the sort
 * order itself is trusted from the wire, never re-sorted here.
 *
 * A domain whose metrics carry no source hints (a packet that predates the
 * `provider_contract` embedding) has no derivable letter; the backend sorts
 * it last and this returns `null` — the caller renders no letter rather
 * than guessing one.
 */

const HINT_PATTERN = /^([A-Za-z]+)-?(\d*)/;

function naturalKey(hint: string): readonly [string, number] {
  const match = HINT_PATTERN.exec(hint);
  if (!match) return [hint, 0];
  const [, letters, digits] = match;
  return [letters.toUpperCase(), digits ? Number.parseInt(digits, 10) : 0];
}

function compareNaturalKey(
  a: readonly [string, number],
  b: readonly [string, number],
): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] - b[1];
}

/** The section's CDS letter (e.g. `"A"`), or `null` when it has no source
 * hints to derive one from. */
export function sectionLetter(section: ReviewSection): string | null {
  const hints = section.metrics.flatMap((metric) => metric.source_hints);
  if (hints.length === 0) return null;
  const [letters] = hints.map(naturalKey).reduce((min, key) =>
    compareNaturalKey(key, min) < 0 ? key : min,
  );
  return letters;
}
