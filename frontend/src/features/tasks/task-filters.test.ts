import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import {
  getAnytimeGroups,
  getTodayGroups,
  getUpcomingGroups,
} from "@/features/tasks/task-filters";

// Pinned to two timezone extremes, same rationale as task-dates.test.ts
// (plans/tasks-redesign-plan.md P5.1): every date here is a date-only
// `YYYY-MM-DD` string, and a naive `new Date(dateKey)` parse would shift a
// day at a negative UTC offset. `getTodayGroups`/`getUpcomingGroups` build
// on `task-dates.ts`'s local-safe parsing, so this is what catches a
// regression back to the naive parse before it ships.
const TIMEZONES = ["Etc/GMT+5", "Etc/GMT-13"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

function localMidnight(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

let taskSequence = 0;

function makeTask(overrides: Partial<Task> = {}): Task {
  taskSequence += 1;
  return {
    id: `task-${taskSequence}`,
    title: `Task ${taskSequence}`,
    status: "todo",
    category: "other",
    assignee: "student",
    created_at: `2026-01-${String(taskSequence).padStart(2, "0")}T00:00:00Z`,
    updated_at: `2026-01-${String(taskSequence).padStart(2, "0")}T00:00:00Z`,
    priority: "med",
    flagged: false,
    created_by_actor: "student",
    last_actor: "student",
    ...overrides,
  };
}

describe.each(TIMEZONES)("getTodayGroups under TZ=%s", (tz) => {
  it("puts when_on <= today, not done, in main and excludes done tasks", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const dueToday = makeTask({ when_on: "2026-09-04" });
    const overdueWhen = makeTask({ when_on: "2026-09-01" });
    const doneToday = makeTask({ when_on: "2026-09-04", done_at: "2026-09-04T10:00:00Z" });
    const future = makeTask({ when_on: "2026-09-05" });

    const groups = getTodayGroups(
      [dueToday, overdueWhen, doneToday, future],
      referenceDate,
    );

    expect(groups.main.map((task) => task.id).sort()).toEqual(
      [dueToday.id, overdueWhen.id].sort(),
    );
  });

  it("puts open tasks with deadline_on <= today+7 not already in main into dueSoon, and excludes overlap", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const dueSoonOnly = makeTask({ deadline_on: "2026-09-08" });
    const beyondWindow = makeTask({ deadline_on: "2026-09-12" });
    const overlapsMain = makeTask({
      when_on: "2026-09-04",
      deadline_on: "2026-09-05",
    });
    const noDeadline = makeTask({});

    const groups = getTodayGroups(
      [dueSoonOnly, beyondWindow, overlapsMain, noDeadline],
      referenceDate,
    );

    expect(groups.dueSoon.map((task) => task.id)).toEqual([dueSoonOnly.id]);
    expect(groups.main.map((task) => task.id)).toEqual([overlapsMain.id]);
  });

  it("orders main by flagged first, then soonest deadline, nulls last", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const unflaggedNoDeadline = makeTask({
      when_on: "2026-09-04",
      created_at: "2026-01-01T00:00:00Z",
    });
    const unflaggedSoonDeadline = makeTask({
      when_on: "2026-09-04",
      deadline_on: "2026-09-05",
    });
    const flagged = makeTask({ when_on: "2026-09-04", flagged: true });

    const groups = getTodayGroups(
      [unflaggedNoDeadline, unflaggedSoonDeadline, flagged],
      referenceDate,
    );

    expect(groups.main.map((task) => task.id)).toEqual([
      flagged.id,
      unflaggedSoonDeadline.id,
      unflaggedNoDeadline.id,
    ]);
  });
});

describe.each(TIMEZONES)("getUpcomingGroups under TZ=%s", (tz) => {
  it("excludes done tasks and tasks whose when_on is today or earlier", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const today = makeTask({ when_on: "2026-09-04" });
    const done = makeTask({ when_on: "2026-09-10", done_at: "2026-09-04T00:00:00Z" });
    const tomorrow = makeTask({ when_on: "2026-09-05" });

    const groups = getUpcomingGroups([today, done, tomorrow], referenceDate);
    const allIds = groups.flatMap((group) => group.tasks.map((task) => task.id));

    expect(allIds).toEqual([tomorrow.id]);
  });

  it("puts \"Deadlines without a plan\" first: not done, when_on null, deadline_on set", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const unplanned = makeTask({ deadline_on: "2026-09-20" });
    const scheduled = makeTask({ when_on: "2026-09-05" });

    const groups = getUpcomingGroups([scheduled, unplanned], referenceDate);

    expect(groups[0].id).toBe("deadlines-without-a-plan");
    expect(groups[0].tasks.map((task) => task.id)).toEqual([unplanned.id]);
  });

  it("does not put a deadline-only task in Anytime — it belongs to Upcoming alone", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const unplanned = makeTask({ deadline_on: "2026-09-20" });
    const applicationsById = new Map<string, ApplicationView>();
    const essaysById = new Map<string, EssaySummary>();

    const upcoming = getUpcomingGroups([unplanned], referenceDate);
    const anytime = getAnytimeGroups([unplanned], applicationsById, essaysById);

    expect(upcoming.flatMap((group) => group.tasks.map((task) => task.id))).toEqual([
      unplanned.id,
    ]);
    expect(anytime.flatMap((group) => group.tasks.map((task) => task.id))).toEqual([]);
  });

  it("groups by day for 7 days, then by week for 3, then by month", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const dayTask = makeTask({ when_on: "2026-09-06" }); // +2 days
    const weekTask = makeTask({ when_on: "2026-09-15" }); // +11 days -> week bucket
    const monthTask = makeTask({ when_on: "2026-11-01" }); // +58 days -> month bucket

    const groups = getUpcomingGroups([dayTask, weekTask, monthTask], referenceDate);
    const groupOf = (taskId: string) =>
      groups.find((group) => group.tasks.some((task) => task.id === taskId));

    expect(groupOf(dayTask.id)?.id).toBe("day-2");
    expect(groupOf(weekTask.id)?.id).toMatch(/^week-/);
    expect(groupOf(monthTask.id)?.id).toMatch(/^month-/);

    // Order: day groups before week groups before month groups.
    const dayIndex = groups.findIndex((group) => group.id === "day-2");
    const weekIndex = groups.findIndex((group) => group.id.startsWith("week-"));
    const monthIndex = groups.findIndex((group) => group.id.startsWith("month-"));
    expect(dayIndex).toBeLessThan(weekIndex);
    expect(weekIndex).toBeLessThan(monthIndex);
  });
});

describe("getAnytimeGroups", () => {
  it("groups by derived label and puts Unlabelled last", () => {
    const application: ApplicationView = {
      id: "app-1",
      user_id: "u1",
      school_id: 1,
      school_name: "Berkeley",
      school_city: null,
      school_state: null,
      website_url: null,
      status: "in_progress",
      list_type: "target",
      round: "RD",
      deadline: null,
      aid_deadline: null,
      scholarship_deadline: null,
      notes: null,
      intended_major: null,
      test_plan: null,
      cycle_year: null,
      checklist: {},
      platform: null,
      platform_other: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      archived_at: null,
      progress: { done: 0, total: 0 },
      essays: { done: 0, total: 0 },
    } as unknown as ApplicationView;

    const applicationsById = new Map([[application.id, application]]);
    const essaysById = new Map<string, EssaySummary>();

    const labelled = makeTask({ application_id: application.id });
    const unlabelled = makeTask({});

    const groups = getAnytimeGroups(
      [labelled, unlabelled],
      applicationsById,
      essaysById,
    );

    expect(groups.map((group) => group.label)).toEqual(["Berkeley", "Unlabelled"]);
    expect(groups.at(-1)?.tasks.map((task) => task.id)).toEqual([unlabelled.id]);
  });

  it("excludes done tasks and any task with a when_on or deadline_on", () => {
    const applicationsById = new Map<string, ApplicationView>();
    const essaysById = new Map<string, EssaySummary>();
    const done = makeTask({ done_at: "2026-09-01T00:00:00Z" });
    const scheduled = makeTask({ when_on: "2026-09-10" });
    const deadlineOnly = makeTask({ deadline_on: "2026-09-10" });
    const anytime = makeTask({});

    const groups = getAnytimeGroups(
      [done, scheduled, deadlineOnly, anytime],
      applicationsById,
      essaysById,
    );

    expect(groups.flatMap((group) => group.tasks.map((task) => task.id))).toEqual([
      anytime.id,
    ]);
  });
});
