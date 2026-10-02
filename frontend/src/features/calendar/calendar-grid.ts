// Pure date maths for the calendar grid. Every date is built with the local
// `new Date(y, m, d)` constructor and every day is keyed by `getDateKey`; never
// `new Date("YYYY-MM-DD")`, which parses as UTC and lands on the previous day
// west of Greenwich (task-dates.ts carries the full warning).
import {
  addDays,
  getCalendarDayDiff,
  getDateKey,
  parseDateOnly,
  startOfLocalDay,
} from "@/features/tasks/task-dates";

/** Sunday, Google's US default. The mini-month reads the same constant. */
export const WEEK_STARTS_ON = 0;
/** The Schedule view's window: eight weeks from the anchor. */
export const SCHEDULE_DAYS = 56;
/** Below this calendar-body width the rail moves into the header's
 * `Calendars` popover, so a day column never drops much under ~100px. */
export const RAIL_MIN_BODY_WIDTH = 960;
/** The narrowest a day column may get before an open panel stops reserving
 * room beside the grid and simply overlays it instead. */
export const MIN_DAY_COLUMN_WIDTH = 88;
export const DAYS_PER_WEEK = 7;

export type CalendarView = "month" | "week" | "schedule";

export const CALENDAR_VIEWS: readonly CalendarView[] = [
  "month",
  "week",
  "schedule",
];

export function isCalendarView(value: string | null): value is CalendarView {
  return CALENDAR_VIEWS.includes(value as CalendarView);
}

export function startOfWeek(day: Date): Date {
  const start = startOfLocalDay(day);
  const offset =
    (start.getDay() - WEEK_STARTS_ON + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(start, -offset);
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    addDays(start, index),
  );
}

/** Exactly the weeks the anchor's month touches: four, five or six rows. */
export function monthMatrix(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks: Date[][] = [];
  for (
    let weekStart = startOfWeek(first);
    weekStart <= last;
    weekStart = addDays(weekStart, DAYS_PER_WEEK)
  ) {
    weeks.push(weekDays(weekStart));
  }
  return weeks;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Moves the anchor by one range. A month step keeps the day of the month,
 * clamped, so Jan 31 pages to Feb 28 and never overflows into March. */
export function shiftAnchor(
  anchor: Date,
  view: CalendarView,
  dir: 1 | -1,
): Date {
  if (view === "week") {
    return addDays(anchor, DAYS_PER_WEEK * dir);
  }
  if (view === "schedule") {
    return addDays(anchor, SCHEDULE_DAYS * dir);
  }
  return shiftMonths(anchor, dir);
}

export function shiftMonths(anchor: Date, months: number): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + months;
  const target = new Date(year, month, 1);
  const day = Math.min(
    anchor.getDate(),
    daysInMonth(target.getFullYear(), target.getMonth()),
  );
  return new Date(target.getFullYear(), target.getMonth(), day);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isSameDay(a: Date, b: Date): boolean {
  return getDateKey(a) === getDateKey(b);
}

/** Whether `day` falls inside the range the view is currently showing. */
export function isInRange(
  day: Date,
  anchor: Date,
  view: CalendarView,
): boolean {
  if (view === "week") {
    return isSameDay(startOfWeek(day), startOfWeek(anchor));
  }
  if (view === "schedule") {
    const diff = getCalendarDayDiff(day, anchor);
    return diff >= 0 && diff < SCHEDULE_DAYS;
  }
  return isSameMonth(day, anchor);
}

const MONTH_LONG = new Intl.DateTimeFormat("en-US", { month: "long" });
const MONTH_SHORT_DAY = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function formatWeekdayShort(day: Date): string {
  return WEEKDAY_SHORT.format(day);
}

export function formatWeekdayLong(day: Date): string {
  return WEEKDAY_LONG.format(day);
}

/** `Oct 1` — the label the first of each month carries in the grid. */
export function formatMonthDay(day: Date): string {
  return MONTH_SHORT_DAY.format(day);
}

/** The header title, split so the year can sit in a quieter weight. */
export function formatRangeTitle(
  anchor: Date,
  view: CalendarView,
): { primary: string; secondary: string } {
  if (view === "month") {
    return {
      primary: MONTH_LONG.format(anchor),
      secondary: String(anchor.getFullYear()),
    };
  }
  if (view === "schedule") {
    return {
      primary: `From ${formatMonthDay(anchor)}`,
      secondary: String(anchor.getFullYear()),
    };
  }
  const [first] = weekDays(anchor);
  const last = addDays(first, DAYS_PER_WEEK - 1);
  if (first.getFullYear() !== last.getFullYear()) {
    return {
      primary: `${formatMonthDay(first)}, ${first.getFullYear()} – ${formatMonthDay(last)}`,
      secondary: String(last.getFullYear()),
    };
  }
  return {
    primary: `${formatMonthDay(first)} – ${formatMonthDay(last)}`,
    secondary: String(first.getFullYear()),
  };
}

/** `Friday, January 1, 2027` — the year only when it isn't this year. */
export function formatDayTitle(day: Date, today: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(day);
}

/** The full grid-cell label: `Thursday, October 1, 2026`. */
export function formatDayLabel(day: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(day);
}

/** `Today` · `Tomorrow` · `In 3 days` · `2 days ago` · `Yesterday`. */
export function formatRelativeDay(dateKey: string, today: Date): string {
  const diff = getCalendarDayDiff(parseDateOnly(dateKey), today);
  if (diff === 0) {
    return "Today";
  }
  if (diff === 1) {
    return "Tomorrow";
  }
  if (diff === -1) {
    return "Yesterday";
  }
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

/**
 * The grid's one tab stop: the selected day when it is on screen, so Shift+Tab
 * out and Tab back lands where the user left off, else the anchor.
 */
export function rovingDayKey(
  days: readonly Date[],
  selectedKey: string | null,
  anchor: Date,
): string {
  if (selectedKey && days.some((day) => getDateKey(day) === selectedKey)) {
    return selectedKey;
  }
  return getDateKey(anchor);
}
