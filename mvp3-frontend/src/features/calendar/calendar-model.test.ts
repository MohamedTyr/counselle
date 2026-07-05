import type { HardDeadline } from "@/domain/calendar"
import type { Task } from "@/domain/task"
import {
  dateKeyToDate,
  getDateKey,
  mergeDateWithExistingTime,
  mergeDateWithTargetTime,
} from "@/features/calendar/calendar-dates"
import {
  getDeadlinesWithoutPlannedWork,
  getHardDeadlineCounts,
  hasPlannedWorkBeforeDeadline,
} from "@/features/calendar/calendar-deadlines"
import { parseCalendarDragPayload } from "@/features/calendar/calendar-drag"
import {
  getCalendarModeCounts,
  getModeEvents,
  getTimeGridEvents,
} from "@/features/calendar/calendar-events"

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const { id, title, ...rest } = overrides

  return {
    assignee: "student",
    category: "other",
    created_at: "2026-06-01T09:00:00.000Z",
    id,
    priority: "med",
    status: "todo",
    title,
    updated_at: "2026-06-01T09:00:00.000Z",
    ...rest,
  }
}

function deadline(overrides: Partial<HardDeadline>): HardDeadline {
  return {
    deadline_at: "2026-07-10T23:59:00",
    id: "deadline-1",
    kind: "application",
    title: "Georgia Tech application",
    ...overrides,
  }
}

describe("calendar date helpers", () => {
  it("merges a new date with existing task time", () => {
    expect(getDateKey(dateKeyToDate("2026-07-04"))).toBe("2026-07-04")
    expect(
      mergeDateWithExistingTime(
        dateKeyToDate("2026-07-08"),
        "2026-07-01T15:30:00",
        9
      )
    ).toBe("2026-07-08T12:30:00.000Z")
  })

  it("uses target minutes when dropping onto the time grid", () => {
    expect(
      mergeDateWithTargetTime(
        dateKeyToDate("2026-07-09"),
        "2026-07-01T15:30:00",
        9,
        0,
        14 * 60 + 45
      )
    ).toBe("2026-07-09T11:45:00.000Z")
  })
})

describe("calendar event mapping", () => {
  const deadlines = [
    deadline({
      id: "hard-1",
      kind: "aid",
      title: "Aid document",
    }),
  ]
  const tasks = [
    task({
      due_at: "2026-07-03T23:59:00",
      id: "due",
      priority: "high",
      title: "Submit CSS Profile",
    }),
    task({
      id: "done-due",
      due_at: "2026-07-04T23:59:00",
      status: "done",
      title: "Completed due task",
    }),
    task({
      id: "work",
      planned_for: "2026-07-05T09:30:00",
      title: "Draft supplement",
    }),
  ]

  it("maps hard deadlines, due tasks, and work tasks into calendar events", () => {
    expect(
      getModeEvents({
        deadlines,
        mode: "hard_deadlines",
        showDoneDueTasks: false,
        tasks,
      }).map((event) => [event.id, event.kind, event.taskId])
    ).toEqual([["hard-hard-1", "hard_deadline", undefined]])

    expect(
      getModeEvents({
        deadlines,
        mode: "task_due_dates",
        showDoneDueTasks: false,
        tasks,
      }).map((event) => event.id)
    ).toEqual(["due-due"])

    expect(
      getModeEvents({
        deadlines,
        mode: "work_plan",
        showDoneDueTasks: false,
        tasks,
      }).map((event) => [event.id, event.kind])
    ).toEqual([["work-work", "task_work"]])
  })

  it("maps time grid events and keeps hard deadlines read-only", () => {
    expect(
      getTimeGridEvents({ deadlines, tasks }).map((event) => [
        event.id,
        event.kind,
        event.taskId,
      ])
    ).toEqual([
      ["time-hard-hard-1", "hard_deadline", undefined],
      ["time-due-due", "task_due", "due"],
      ["time-due-done-due", "task_due", undefined],
      ["time-work-work", "task_work", "work"],
    ])
  })
})

describe("calendar deadline warnings and counts", () => {
  it("detects related planned work before a hard deadline", () => {
    const gtDeadline = deadline({
      kind: "scholarship",
      school_name: "Georgia Tech",
      title: "Georgia Tech scholarship essay",
    })
    const tasks = [
      task({
        category: "essay",
        id: "related",
        planned_for: "2026-07-08T09:00:00",
        title: "Draft Georgia Tech scholarship essay",
      }),
    ]

    expect(hasPlannedWorkBeforeDeadline(gtDeadline, tasks)).toBe(true)
    expect(getDeadlinesWithoutPlannedWork([gtDeadline], tasks)).toEqual([])
  })

  it("flags deadlines without related planned work", () => {
    const aidDeadline = deadline({
      kind: "aid",
      school_name: "Berkeley",
      title: "Berkeley aid correction",
    })
    const unrelatedTasks = [
      task({
        category: "essay",
        id: "unrelated",
        planned_for: "2026-07-08T09:00:00",
        title: "Draft Georgia Tech supplement",
      }),
    ]

    expect(hasPlannedWorkBeforeDeadline(aidDeadline, unrelatedTasks)).toBe(
      false
    )
    expect(
      getDeadlinesWithoutPlannedWork([aidDeadline], unrelatedTasks)
    ).toEqual([aidDeadline])
  })

  it("counts hard deadlines and task modes", () => {
    const deadlines = [
      deadline({ id: "one", deadline_at: "2026-07-10T23:59:00" }),
      deadline({ id: "two", deadline_at: "2026-07-10T17:00:00" }),
    ]
    const tasks = [
      task({ due_at: "2026-07-02T23:59:00", id: "due", title: "Due" }),
      task({
        due_at: "2026-07-02T23:59:00",
        id: "done",
        status: "done",
        title: "Done",
      }),
      task({
        id: "work",
        planned_for: "2026-07-03T09:00:00",
        title: "Work",
      }),
    ]

    expect(getHardDeadlineCounts(deadlines)).toEqual({ "2026-07-10": 2 })
    expect(
      getCalendarModeCounts({
        deadlines,
        showDoneDueTasks: false,
        tasks,
      })
    ).toEqual({
      hard_deadlines: 2,
      task_due_dates: 1,
      work_plan: 1,
    })
    expect(
      getCalendarModeCounts({
        deadlines,
        showDoneDueTasks: true,
        tasks,
      }).task_due_dates
    ).toBe(2)
  })
})

describe("calendar drag payload parsing", () => {
  it("parses valid task event drag payloads", () => {
    expect(
      parseCalendarDragPayload(
        JSON.stringify({ kind: "task_work", taskId: "task-1" })
      )
    ).toEqual({ kind: "task_work", taskId: "task-1" })
  })

  it("rejects malformed calendar drag payloads", () => {
    expect(parseCalendarDragPayload("not json")).toBeUndefined()
    expect(
      parseCalendarDragPayload(
        JSON.stringify({ kind: "hard_deadline", taskId: "hard-1" })
      )
    ).toBeUndefined()
    expect(
      parseCalendarDragPayload(JSON.stringify({ kind: "task_due" }))
    ).toBeUndefined()
  })
})
