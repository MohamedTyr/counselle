// Pure grouping/filter functions for the four task views
// (plans/tasks-redesign-plan.md P6.2, plans/tasks-redesign-design.md §2.5).
// No React here — TasksLayout.tsx and the four view components call these
// against the one hoisted `useTasks()` list so the tab count, the page
// subtitle count, and the rendered row count can never disagree (P6.1).
//
// Every task lands in exactly one of Today / Upcoming / Anytime / Logbook
// (plan P6.2's deliberate split — a task with a deadline but no When belongs
// to Upcoming's "Deadlines without a plan" group, never to Anytime).
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import { getDerivedLabel } from "@/features/tasks/task-config";
import {
  addDays,
  getCalendarDayDiff,
  getDateKey,
  parseDateOnly,
} from "@/features/tasks/task-dates";
import { getNowDate } from "@/lib/time";

export type TaskGroup = {
  id: string;
  label: string;
  tasks: Task[];
  /**
   * design doc §2.5 — the one exception header: name renders on
   * `--ink-secondary` instead of `--ink`, and the group is closed by a
   * hairline rule below its last row.
   */
  variant?: "unplanned-deadlines";
};

// ---- shared predicates and sorts ---------------------------------------

function isDone(task: Task): boolean {
  return Boolean(task.done_at);
}

function whenDayDiff(task: Task, referenceDate: Date): number | undefined {
  return task.when_on
    ? getCalendarDayDiff(parseDateOnly(task.when_on), referenceDate)
    : undefined;
}

function deadlineDayDiff(task: Task, referenceDate: Date): number | undefined {
  return task.deadline_on
    ? getCalendarDayDiff(parseDateOnly(task.deadline_on), referenceDate)
    : undefined;
}

/** Stable, deterministic tiebreak used everywhere below: oldest first. */
function byCreatedAt(a: Task, b: Task): number {
  return a.created_at.localeCompare(b.created_at);
}

/**
 * plan P6.2 — Today's deterministic order until P9's manual reorder lands:
 * flagged first, then soonest deadline, nulls last, then creation order.
 */
function compareTodayOrder(referenceDate: Date) {
  return (a: Task, b: Task): number => {
    if (a.flagged !== b.flagged) {
      return a.flagged ? -1 : 1;
    }

    const aDeadline = deadlineDayDiff(a, referenceDate);
    const bDeadline = deadlineDayDiff(b, referenceDate);
    if ((aDeadline === undefined) !== (bDeadline === undefined)) {
      return aDeadline === undefined ? 1 : -1;
    }
    if (aDeadline !== undefined && bDeadline !== undefined && aDeadline !== bDeadline) {
      return aDeadline - bDeadline;
    }

    return byCreatedAt(a, b);
  };
}

// ---- Today (spec §6.1, design §2.5/§2.6) -------------------------------

export type TodayGroups = {
  /** `when_on <= today`, not done. No group header — the page title said it. */
  main: Task[];
  /** not done, `deadline_on <= today+7`, not already in `main`. */
  dueSoon: Task[];
};

const DUE_SOON_WINDOW_DAYS = 7;

/**
 * Distinguishes the Today view's two empty states (design doc §8): "Nothing
 * planned" (nothing was ever planned for today) vs "Today is done"
 * (something was planned and it is finished). `getTodayGroups` only returns
 * *open* tasks, so this checks the done ones separately rather than
 * inferring the state from an empty `main`/`dueSoon` alone.
 */
export function hasCompletedTodayPlan(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
): boolean {
  return tasks.some((task) => {
    if (!isDone(task)) {
      return false;
    }
    const diff = whenDayDiff(task, referenceDate);
    return diff !== undefined && diff <= 0;
  });
}

export function getTodayGroups(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
): TodayGroups {
  const openTasks = tasks.filter((task) => !isDone(task));

  const main = openTasks.filter((task) => {
    const diff = whenDayDiff(task, referenceDate);
    return diff !== undefined && diff <= 0;
  });
  const mainIds = new Set(main.map((task) => task.id));

  const dueSoon = openTasks.filter((task) => {
    if (mainIds.has(task.id)) {
      return false;
    }
    const diff = deadlineDayDiff(task, referenceDate);
    return diff !== undefined && diff <= DUE_SOON_WINDOW_DAYS;
  });

  const order = compareTodayOrder(referenceDate);
  return {
    main: [...main].sort(order),
    dueSoon: [...dueSoon].sort(order),
  };
}

// ---- Upcoming (spec §6.2, design §2.5) ---------------------------------

const UPCOMING_DAY_WINDOW = 7;
const UPCOMING_WEEK_COUNT = 3;

function formatUpcomingDayLabel(date: Date, dayDiff: number): string {
  if (dayDiff === 1) {
    return "Tomorrow";
  }
  if (dayDiff === 2) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  return `${weekday} ${day} ${month}`;
}

function formatWeekLabel(startDate: Date): string {
  const day = startDate.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(startDate);
  return `Week of ${day} ${month}`;
}

function formatMonthLabel(date: Date, referenceDate: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  return date.getFullYear() === referenceDate.getFullYear()
    ? month
    : `${month} ${date.getFullYear()}`;
}

/**
 * `when_on > today` and not done, grouped by day for 7 days, then by week
 * for 3, then by month. "Deadlines without a plan" — not done, `when_on`
 * null, `deadline_on` not null — goes first, unlabelled by a date group.
 */
export function getUpcomingGroups(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
): TaskGroup[] {
  const openTasks = tasks.filter((task) => !isDone(task));

  const unplanned = openTasks.filter(
    (task) => !task.when_on && Boolean(task.deadline_on),
  );
  const unplannedSorted = [...unplanned].sort((a, b) => {
    const aDiff = deadlineDayDiff(a, referenceDate) ?? 0;
    const bDiff = deadlineDayDiff(b, referenceDate) ?? 0;
    return aDiff !== bDiff ? aDiff - bDiff : byCreatedAt(a, b);
  });

  const scheduled = openTasks.filter((task) => {
    const diff = whenDayDiff(task, referenceDate);
    return diff !== undefined && diff > 0;
  });

  const byDay = new Map<number, Task[]>();
  const byWeek = new Map<number, Task[]>();
  const byMonth = new Map<string, Task[]>();

  for (const task of scheduled) {
    const diff = whenDayDiff(task, referenceDate) as number;
    if (diff <= UPCOMING_DAY_WINDOW) {
      const bucket = byDay.get(diff) ?? [];
      bucket.push(task);
      byDay.set(diff, bucket);
      continue;
    }

    const weekWindowEnd = UPCOMING_DAY_WINDOW + UPCOMING_WEEK_COUNT * 7;
    if (diff <= weekWindowEnd) {
      const weekIndex = Math.floor((diff - UPCOMING_DAY_WINDOW - 1) / 7);
      const bucket = byWeek.get(weekIndex) ?? [];
      bucket.push(task);
      byWeek.set(weekIndex, bucket);
      continue;
    }

    const date = parseDateOnly(task.when_on as string);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`;
    const bucket = byMonth.get(monthKey) ?? [];
    bucket.push(task);
    byMonth.set(monthKey, bucket);
  }

  const groups: TaskGroup[] = [];

  if (unplannedSorted.length > 0) {
    groups.push({
      id: "deadlines-without-a-plan",
      label: "Deadlines without a plan",
      tasks: unplannedSorted,
      variant: "unplanned-deadlines",
    });
  }

  for (let diff = 1; diff <= UPCOMING_DAY_WINDOW; diff += 1) {
    const bucketTasks = byDay.get(diff);
    if (!bucketTasks) {
      continue;
    }
    const date = addDays(referenceDate, diff);
    groups.push({
      id: `day-${diff}`,
      label: formatUpcomingDayLabel(date, diff),
      tasks: [...bucketTasks].sort(byCreatedAt),
    });
  }

  for (let weekIndex = 0; weekIndex < UPCOMING_WEEK_COUNT; weekIndex += 1) {
    const bucketTasks = byWeek.get(weekIndex);
    if (!bucketTasks) {
      continue;
    }
    const startDiff = UPCOMING_DAY_WINDOW + 1 + weekIndex * 7;
    const startDate = addDays(referenceDate, startDiff);
    groups.push({
      id: `week-${weekIndex}`,
      label: formatWeekLabel(startDate),
      tasks: [...bucketTasks].sort(byCreatedAt),
    });
  }

  for (const monthKey of [...byMonth.keys()].sort()) {
    const bucketTasks = byMonth.get(monthKey) as Task[];
    const date = parseDateOnly(bucketTasks[0].when_on as string);
    groups.push({
      id: `month-${monthKey}`,
      label: formatMonthLabel(date, referenceDate),
      tasks: [...bucketTasks].sort(byCreatedAt),
    });
  }

  return groups;
}

// ---- Anytime (spec §6.3, design §2.5) ----------------------------------

const UNLABELLED_LABEL = "Unlabelled";

/**
 * `when_on` null and `deadline_on` null and not done, grouped by derived
 * label (school → essay → category), `Unlabelled` last.
 */
export function getAnytimeGroups(
  tasks: Task[],
  applicationsById: ReadonlyMap<string, ApplicationView>,
  essaysById: ReadonlyMap<string, EssaySummary>,
): TaskGroup[] {
  const openTasks = tasks.filter(
    (task) => !isDone(task) && !task.when_on && !task.deadline_on,
  );

  const byLabel = new Map<string, Task[]>();
  for (const task of openTasks) {
    const label = getDerivedLabel(task, applicationsById, essaysById) ?? UNLABELLED_LABEL;
    const bucket = byLabel.get(label) ?? [];
    bucket.push(task);
    byLabel.set(label, bucket);
  }

  const labelledGroups = [...byLabel.keys()]
    .filter((label) => label !== UNLABELLED_LABEL)
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({
      id: `label-${label}`,
      label,
      tasks: [...(byLabel.get(label) as Task[])].sort(byCreatedAt),
    }));

  const unlabelled = byLabel.get(UNLABELLED_LABEL);
  return unlabelled
    ? [
        ...labelledGroups,
        {
          id: "unlabelled",
          label: UNLABELLED_LABEL,
          tasks: [...unlabelled].sort(byCreatedAt),
        },
      ]
    : labelledGroups;
}

// ---- Logbook (spec §6.4) ------------------------------------------------

function formatLogbookDayLabel(date: Date, referenceDate: Date): string {
  const diff = getCalendarDayDiff(date, referenceDate);
  if (diff === 0) {
    return "Today";
  }
  if (diff === -1) {
    return "Yesterday";
  }
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  const base = `${weekday} ${day} ${month}`;
  return date.getFullYear() === referenceDate.getFullYear()
    ? base
    : `${base} ${date.getFullYear()}`;
}

/**
 * `done_at` not null, newest first, grouped by day. `done_at` is a real
 * timestamptz (not a date-only string), so it is parsed with the ordinary
 * `Date` constructor and reduced to a local day key via `getDateKey` —
 * unlike `when_on`/`deadline_on`, it carries a real time of day and is not
 * the date-only UTC-midnight trap `parseDateOnly` exists to avoid.
 */
export function getLogbookGroups(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
): TaskGroup[] {
  const doneTasks = tasks.filter((task) => Boolean(task.done_at));
  const sorted = [...doneTasks].sort((a, b) =>
    (b.done_at as string).localeCompare(a.done_at as string),
  );

  const byDay = new Map<string, Task[]>();
  const dayOrder: string[] = [];
  for (const task of sorted) {
    const dayKey = getDateKey(new Date(task.done_at as string));
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, []);
      dayOrder.push(dayKey);
    }
    (byDay.get(dayKey) as Task[]).push(task);
  }

  return dayOrder.map((dayKey) => ({
    id: `day-${dayKey}`,
    label: formatLogbookDayLabel(parseDateOnly(dayKey), referenceDate),
    tasks: byDay.get(dayKey) as Task[],
  }));
}

const DONE_THIS_WEEK_WINDOW_DAYS = 6;

/**
 * The Logbook subtitle and the Today footer link both read "N done this
 * week" (design doc §2.1, §2.6) — a rolling 7-day window ending today, not
 * the full Logbook. Kept separate from `getLogbookGroups` so the (larger)
 * all-time list and the (smaller) week count never have to agree by
 * construction.
 */
export function getDoneThisWeekCount(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
): number {
  return tasks.filter((task) => {
    if (!task.done_at) {
      return false;
    }
    const diff = getCalendarDayDiff(new Date(task.done_at), referenceDate);
    return diff >= -DONE_THIS_WEEK_WINDOW_DAYS && diff <= 0;
  }).length;
}
