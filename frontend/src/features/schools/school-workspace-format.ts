/*
 * Shared vocabulary for the school workspace surfaces.
 *
 * Extracted from SchoolWorkspace.tsx, which had grown to 1489 lines against
 * the 800-line house limit. Pure move: every function below is byte-identical
 * to what it replaced, so this file changes structure and nothing else.
 */

export function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatMonthYear(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

/**
 * Where a deadline came from, in the words the school page and the calendar
 * both show: the student's own date, or Counselle's data and when it was last
 * checked. `null` when there is nothing honest to say.
 */
export function deadlineSourceLabel(
  source: "student" | "facts" | null,
  checkedAt: string | null,
): string | null {
  if (source === "student") {
    return "You set this date";
  }
  if (source === "facts" && checkedAt) {
    return `From Counselle’s data, checked ${formatMonthYear(checkedAt)}`;
  }
  return null;
}

export function cycleLabel(cycleYear: number | null | undefined) {
  return cycleYear
    ? `${cycleYear - 1}-${String(cycleYear).slice(-2)}`
    : "cycle not confirmed";
}
