import { getNowDate } from "@/lib/time";

export function formatShortDate(value?: string) {
  if (!value) {
    return "No due date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatPickerDate(value?: string) {
  if (!value) {
    return "Pick date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getCalendarDayDiff(value: Date, from: Date) {
  return Math.round(
    (startOfLocalDay(value).getTime() - startOfLocalDay(from).getTime()) /
      86_400_000,
  );
}

export function getDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatTodayPageTitle(referenceDate: Date = getNowDate()) {
  return `Today, ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(referenceDate)}`;
}

/**
 * Parses a `YYYY-MM-DD` date-only string into a local-midnight `Date`.
 *
 * THE CORRECTNESS RULE (plans/tasks-redesign-plan.md P5.1): every date in this
 * feature is a date-only string end to end. `new Date("2026-09-04")` parses as
 * UTC midnight, which renders as the *previous* day in any negative-offset
 * timezone (e.g. `America/New_York`). Always split the string and construct
 * with the local-time constructor instead.
 */
/**
 * `YYYY-MM-DD` → a local-midnight `Date`. **The one safe parse in the
 * feature — always use this.** `new Date("2026-09-04")` parses as UTC
 * midnight and renders as the previous day in any negative-offset timezone,
 * which is the single most likely correctness bug in this feature. Exported
 * so no caller is tempted to hand-roll a second copy.
 */
export function parseDateOnly(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The `YYYY-MM-DD` form of a wire date value. Undefined-safe passthrough. */
export function toDateKey(value: string | undefined): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWeekdayShort(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

/** `"12 Sep"` — day before month, matching the design doc's chip examples. */
function formatDayMonth(date: Date): string {
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    date,
  );
  return `${day} ${month}`;
}

/**
 * design doc §3.7 — "Today" | "Tomorrow" | "Fri" (within 7 days) |
 * "Fri 12 Sep" (beyond) | "12 Sep 2027" (different year). Never a bare ISO
 * string.
 */
export function formatWhenChip(
  whenOn: string,
  referenceDate: Date = getNowDate(),
): string {
  const whenDate = parseDateOnly(whenOn);
  const dayDiff = getCalendarDayDiff(whenDate, referenceDate);

  if (dayDiff === 0) {
    return "Today";
  }

  if (dayDiff === 1) {
    return "Tomorrow";
  }

  if (whenDate.getFullYear() !== referenceDate.getFullYear()) {
    return `${formatDayMonth(whenDate)} ${whenDate.getFullYear()}`;
  }

  if (dayDiff > 1 && dayDiff < 7) {
    return formatWeekdayShort(whenDate);
  }

  return `${formatWeekdayShort(whenDate)} ${formatDayMonth(whenDate)}`;
}

/**
 * design doc §3.8 exact thresholds, disambiguated by the plan: overdue
 * `< today`; due-soon `<= today+2`; normal `<= today+7`; hidden otherwise or
 * when null.
 */
export function getDeadlineState(
  deadlineOn: string | undefined,
  referenceDate: Date = getNowDate(),
): "overdue" | "due-soon" | "normal" | "hidden" {
  if (!deadlineOn) {
    return "hidden";
  }

  const deadlineDate = parseDateOnly(deadlineOn);
  const dayDiff = getCalendarDayDiff(deadlineDate, referenceDate);

  if (dayDiff < 0) {
    return "overdue";
  }

  if (dayDiff <= 2) {
    return "due-soon";
  }

  if (dayDiff <= 7) {
    return "normal";
  }

  return "hidden";
}

/**
 * The date half of the deadline chip (design doc §3.8 "Rendered" examples):
 * `due Fri` for a near date, `overdue Jan 1` once it has passed. Near dates
 * (due-soon/normal) render as a short weekday, matching the When chip's
 * near-term form; overdue dates render as month + day (unbounded past, a
 * weekday is not useful), with the year appended only when it differs from
 * `referenceDate`'s year.
 */
export function formatDeadline(
  deadlineOn: string,
  referenceDate: Date = getNowDate(),
): string {
  const deadlineDate = parseDateOnly(deadlineOn);
  const state = getDeadlineState(deadlineOn, referenceDate);

  if (state === "overdue") {
    const dayMonth = formatDayMonth(deadlineDate);
    return deadlineDate.getFullYear() === referenceDate.getFullYear()
      ? dayMonth
      : `${dayMonth} ${deadlineDate.getFullYear()}`;
  }

  return formatWeekdayShort(deadlineDate);
}

function pluralizeTasks(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

export type TaskSubtitleView = "today" | "upcoming" | "anytime" | "logbook";

/** design doc §2.1's page-subtitle strings. Always pairs a number with its noun. */
export function formatPageSubtitle(
  view: TaskSubtitleView,
  count: number,
  referenceDate: Date = getNowDate(),
): string {
  switch (view) {
    case "today": {
      const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
      }).format(referenceDate);
      const day = referenceDate.getDate();
      const month = new Intl.DateTimeFormat("en-US", {
        month: "long",
      }).format(referenceDate);
      return `${weekday} ${day} ${month} · ${pluralizeTasks(count)}`;
    }
    case "upcoming":
      return `${pluralizeTasks(count)} over the next six weeks`;
    case "anytime":
      return `${pluralizeTasks(count)}, no date`;
    case "logbook":
      return `${count} done this week`;
  }
}
