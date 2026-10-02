import { describe, expect, it } from "vitest";

import type { SchoolDeadlineItem } from "@/api/calendar/types";
import type {
  ApplicationView,
  EssaySummary,
  Task as ApiTask,
} from "@/api/workspace/types";
import { taskFromApi, type Task } from "@/domain/task";
import {
  buildCalendarItems,
  DEFAULT_LAYERS,
  getItemState,
  visibleCellItems,
  type CalendarItem,
  type CalendarItemsInput,
} from "@/features/calendar/calendar-items";
import {
  workspaceApplicationFixture,
  workspaceEssayFixture,
  workspaceTaskFixture,
} from "@/test/render-app";

const TODAY = new Date(2026, 9, 1);

function task(overrides: Partial<ApiTask>): Task {
  return taskFromApi({ ...workspaceTaskFixture, ...overrides });
}

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return { ...workspaceApplicationFixture, ...overrides };
}

function essay(overrides: Partial<EssaySummary>): EssaySummary {
  return { ...workspaceEssayFixture, ...overrides };
}

function school(
  unitid: number,
  overrides: Partial<SchoolDeadlineItem> = {},
): SchoolDeadlineItem {
  return {
    checked_at: "2026-09-20",
    date: "2027-01-01",
    round: "RD",
    school_name: `School ${unitid}`,
    unitid,
    website_url: null,
    ...overrides,
  };
}

function build(input: Partial<CalendarItemsInput>) {
  return buildCalendarItems({
    applications: [],
    essays: [],
    layers: DEFAULT_LAYERS,
    schoolDeadlines: undefined,
    tasks: [],
    ...input,
  });
}

function kinds(items: CalendarItem[] | undefined) {
  return (items ?? []).map((item) => item.kind);
}

describe("buildCalendarItems", () => {
  it("puts a task on its when, merged with its deadline on the same day", () => {
    const days = build({
      tasks: [task({ deadline_on: "2026-10-05", when_on: "2026-10-05" })],
    });
    const [item] = days.get("2026-10-05") ?? [];
    expect(days.size).toBe(1);
    expect(item).toMatchObject({ isAlsoDue: true, kind: "task" });
  });

  it("splits a task whose deadline differs from its when, or has no when", () => {
    const days = build({
      tasks: [
        task({ deadline_on: "2026-10-09", id: "a", when_on: "2026-10-05" }),
        task({ deadline_on: "2026-10-09", id: "b" }),
      ],
    });
    expect(kinds(days.get("2026-10-05"))).toEqual(["task"]);
    expect(kinds(days.get("2026-10-09"))).toEqual(["due", "due"]);
  });

  it("shows an essay's own deadline but not one inherited from its school", () => {
    const app = application({ deadline: "2027-01-01" });
    const days = build({
      applications: [app],
      essays: [
        essay({ deadline: "2027-01-01", id: "inherited" }),
        essay({ deadline: "2026-12-01", id: "own" }),
      ],
    });
    expect(kinds(days.get("2027-01-01"))).toEqual(["school"]);
    expect(kinds(days.get("2026-12-01"))).toEqual(["due"]);
  });

  it("shows each dated application field and skips withdrawn schools", () => {
    const days = build({
      applications: [
        application({
          aid_deadline: "2026-11-15",
          deadline: "2026-11-01",
          id: "kept",
          scholarship_deadline: "2026-12-01",
        }),
        application({ deadline: "2026-11-01", id: "gone", status: "Withdrawn" }),
      ],
    });
    expect(days.get("2026-11-01")).toHaveLength(1);
    expect(days.get("2026-11-15")?.[0]).toMatchObject({ field: "aid_deadline" });
    expect(days.get("2026-12-01")?.[0]).toMatchObject({
      field: "scholarship_deadline",
    });
  });

  it("excludes every listed school from All schools and groups the rest by day and round", () => {
    const days = build({
      applications: [application({ school_unitid: 1 })],
      layers: { ...DEFAULT_LAYERS, allSchools: true },
      schoolDeadlines: [
        school(1),
        school(2),
        school(3),
        school(4, { round: "EA2" }),
        school(5, { date: "2026-11-01", round: "ED" }),
      ],
    });
    const jan = days.get("2027-01-01") ?? [];
    expect(jan.map((item) => item.kind === "aggregate" && item.round)).toEqual([
      "EA2",
      "RD",
    ]);
    const rd = jan.find((item) => item.kind === "aggregate" && item.round === "RD");
    expect(rd?.kind === "aggregate" && rd.schools.map((s) => s.unitid)).toEqual([
      2, 3,
    ]);
    expect(days.get("2026-11-01")).toHaveLength(1);
  });

  it("filters All schools by round and waits for the student's list", () => {
    const layers = { ...DEFAULT_LAYERS, allSchools: true, allSchoolsRounds: [] };
    expect(build({ layers, schoolDeadlines: [school(2)] }).size).toBe(0);
    expect(
      build({ layers: { ...DEFAULT_LAYERS, allSchools: true } }).size,
    ).toBe(0);
  });

  it("hides finished work when Show completed is off", () => {
    const layers = { ...DEFAULT_LAYERS, showCompleted: false };
    const days = build({
      essays: [essay({ application_id: null, deadline: "2026-10-20", status: "Submitted" })],
      layers,
      tasks: [
        task({
          deadline_on: "2026-10-09",
          done_at: "2026-10-01T10:00:00Z",
          when_on: "2026-10-05",
        }),
      ],
    });
    expect(days.size).toBe(0);
  });

  it("drops a malformed or impossible date instead of defaulting it", () => {
    const days = build({
      applications: [application({ deadline: "2026-02-31" })],
      tasks: [task({ when_on: "next week" })],
    });
    expect(days.size).toBe(0);
  });

  it("orders a day: my schools, due, flagged, tasks, other schools, done", () => {
    const days = build({
      applications: [application({ deadline: "2026-10-05", school_unitid: 1 })],
      layers: { ...DEFAULT_LAYERS, allSchools: true },
      schoolDeadlines: [school(9, { date: "2026-10-05" })],
      tasks: [
        task({ done_at: "2026-10-01T00:00:00Z", id: "done", when_on: "2026-10-05" }),
        task({ id: "plain", when_on: "2026-10-05" }),
        task({ flagged: true, id: "flag", when_on: "2026-10-05" }),
        task({ deadline_on: "2026-10-05", id: "due" }),
      ],
    });
    expect(
      (days.get("2026-10-05") ?? []).map((item) =>
        item.kind === "task" ? item.task.id : item.kind,
      ),
    ).toEqual(["school", "due", "flag", "plain", "aggregate", "done"]);
  });
});

describe("getItemState", () => {
  it("marks only a submitted application's round deadline as submitted", () => {
    const app = application({
      aid_deadline: "2026-10-02",
      deadline: "2026-10-02",
      status: "Submitted",
    });
    const day = build({ applications: [app] }).get("2026-10-02") ?? [];
    expect(day.map((item) => getItemState(item, TODAY))).toEqual([
      "submitted",
      "due-soon",
    ]);
  });

  it("calls a missed round deadline passed and a missed due date overdue", () => {
    const days = build({
      applications: [application({ deadline: "2026-09-01" })],
      tasks: [task({ deadline_on: "2026-09-01" })],
    });
    expect(
      (days.get("2026-09-01") ?? []).map((item) => getItemState(item, TODAY)),
    ).toEqual(["passed", "overdue"]);
  });
});

describe("visibleCellItems", () => {
  it("pins the first aggregate to the last visible slot", () => {
    const days = build({
      layers: { ...DEFAULT_LAYERS, allSchools: true },
      schoolDeadlines: [school(9, { date: "2026-10-05" }), school(8, { date: "2026-10-05" })],
      tasks: ["a", "b", "c", "d"].map((id) => task({ id, when_on: "2026-10-05" })),
    });
    const { hiddenCount, shown } = visibleCellItems(days.get("2026-10-05") ?? [], 3);
    expect(kinds(shown)).toEqual(["task", "aggregate"]);
    expect(hiddenCount).toBe(3);
  });
});
