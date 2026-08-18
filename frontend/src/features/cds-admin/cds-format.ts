/**
 * Formatting helpers shared by all three CDS admin screens (DESIGN.md §1.1).
 * Single source so an academic year, a relative timestamp, and a file size
 * render identically on Coverage, Batch upload, and Document review.
 *
 * Canonical P6a delivery — matches the DESIGN.md §1.1 contract exactly
 * (`formatAcademicYear(2025) === "2024–25"`, two-digit second year). An
 * earlier in-flight version of this file truncated only the first year and
 * left the second at four digits (`"2024–2025"`); if you're re-adding a
 * change here, verify against the contract table in DESIGN.md §1.1 first.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `2025` → `"2024–25"` (en dash — a CDS "academic year" is submitted in
 * the spring of its second half, so the wire value is the later year). */
export function formatAcademicYear(academicYear: number): string {
  return `${academicYear - 1}–${String(academicYear).slice(-2)}`;
}

/** `2025` → `"’24–25"` — grid column heads only, where every character
 * costs width. */
export function formatAcademicYearShort(academicYear: number): string {
  return `’${String(academicYear - 1).slice(-2)}–${String(academicYear).slice(-2)}`;
}

/** Relative under 24h ("2 min ago"), else an absolute short date ("16 Aug")
 * — DESIGN.md §1.1. Never shows a future-tense string: a clock-skewed
 * timestamp a few seconds ahead of `Date.now()` reads as "just now" rather
 * than something nonsensical like "-1 min ago". */
export function formatWhen(iso: string): string {
  const timestamp = new Date(iso).getTime();
  const diffMs = Date.now() - timestamp;

  if (diffMs >= 0 && diffMs < DAY_MS) {
    if (diffMs < MINUTE_MS) {
      return "just now";
    }
    if (diffMs < HOUR_MS) {
      return `${Math.floor(diffMs / MINUTE_MS)} min ago`;
    }
    return `${Math.floor(diffMs / HOUR_MS)} hr ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(timestamp);
}

/** `4404020` → `"4.2 MB"`. CDS PDFs cap at 50 MB (DESIGN.md §4.5), so B/KB/MB
 * covers every real case — no GB/TB scaling to speculatively support. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${Math.round(kib)} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
}
