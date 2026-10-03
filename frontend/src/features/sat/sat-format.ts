/** Display formatters for SAT practice — ported from liprep's own inline
 * helpers (`Practice.tsx`, `AnalyticsModal.tsx`, `Filter.tsx`; plan §5.3,
 * §5.5; ui-spec §4, §5). Pure, no I/O. */

/** The top-bar / bottom-bar countdown-less timer: `MM:SS` (Q5). Matches
 * upstream's `formatTimer` verbatim, including no hour rollover — a
 * session realistically never runs 60 minutes on one question. */
export function formatTimer(totalSeconds: number): string {
  const clamped = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** "Today's Progress" / footer-drawer total time: `Xm Ys` (F17, upstream's
 * `formatPrepTime`). Unlike `formatTimer` this never pads — `"3m 5s"`, not
 * `"3m 05s"`. */
export function formatPrepTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

/** A single attempt's recorded time, as shown in the reveal panel's
 * "Previous attempts" row and the analytics pace figures: `"42s"` (Q28). */
export function formatAttemptSeconds(seconds: number): string {
  return `${Math.max(0, Math.trunc(seconds))}s`;
}

/** The "Previous attempts" row timestamp: `"Sep 19, 02:41 PM"` — upstream's
 * two-digit hour (Q28). `timestamp` is a `Date`, an ISO string, or epoch
 * milliseconds. */
export function formatAttemptDate(timestamp: Date | string | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The Question Info dialog's Created / Updated field: `"Sep 19, 2026"`
 * (Q38). Returns `null` for a missing or invalid timestamp so the caller
 * can render the "not available" copy. */
export function formatShortDate(timestamp: Date | string | number | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined) {
    return null;
  }
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const UPDATED_MIN_DIFFERENCE_MS = 60_000;

/** Q38's Updated-visibility rule: shown when Created is missing, or when
 * Created and Updated differ by more than 60 seconds *and* format to
 * different calendar days. */
export function shouldShowUpdated(
  created: Date | string | number | null | undefined,
  updated: Date | string | number | null | undefined,
): boolean {
  if (created === null || created === undefined) {
    return true;
  }
  if (updated === null || updated === undefined) {
    return false;
  }
  const createdDate = created instanceof Date ? created : new Date(created);
  const updatedDate = updated instanceof Date ? updated : new Date(updated);
  if (Number.isNaN(createdDate.getTime()) || Number.isNaN(updatedDate.getTime())) {
    return false;
  }
  const differsByOver60s =
    Math.abs(updatedDate.getTime() - createdDate.getTime()) > UPDATED_MIN_DIFFERENCE_MS;
  const differentDay = formatShortDate(createdDate) !== formatShortDate(updatedDate);
  return differsByOver60s && differentDay;
}

/** The calendar-cell / tooltip label: `"Sep 19: 12 questions"` (F14). */
export function formatHeatmapTooltip(date: Date, count: number): string {
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${label}: ${count} question${count === 1 ? "" : "s"}`;
}

/** The activity streak line's count: `"1 day streak"`, `"12 day streak"`. */
export function formatStreak(days: number): string {
  return `${days} day streak`;
}
