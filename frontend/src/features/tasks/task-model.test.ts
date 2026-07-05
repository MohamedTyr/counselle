import type { Task } from "@/domain/task"
import { formatPlannedDateLabel, getDateKey } from "@/features/tasks/task-dates"
import {
  filterTasksByQuery,
  getUpcomingGroups,
  groupTasksByStatus,
  isTaskInUpcomingView,
} from "@/features/tasks/task-filters"
import {
  createAgentPlanTask,
  createNewTask,
  moveTasksToStatus,
  updateTaskById,
} from "@/features/tasks/task-mutations"
import { sortAllTasks, sortPlanningTasks } from "@/features/tasks/task-sort"
import { parseTaskDragPayload } from "@/features/tasks/useTaskDrag"

const timestamp = "2026-07-01T12:00:00.000Z"

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

describe("task date labels", () => {
  it("labels planned dates against the fixed demo today", () => {
    expect(formatPlannedDateLabel()).toBe("Unplanned")
    expect(formatPlannedDateLabel("2026-06-30T09:00:00")).toBe("Yesterday")
    expect(formatPlannedDateLabel("2026-07-01T09:00:00")).toBe("Today")
    expect(formatPlannedDateLabel("2026-07-02T09:00:00")).toBe("Tomorrow")
    expect(formatPlannedDateLabel("2026-07-08T09:00:00")).toBe("Jul 8")
  })
})

describe("task filtering and grouping", () => {
  const tasks = [
    task({
      category: "essay",
      id: "essay",
      planned_for: "2026-07-01T09:00:00",
      priority: "high",
      status: "doing",
      title: "Revise essay",
    }),
    task({
      due_at: "2026-07-05T23:59:00",
      id: "aid",
      title: "Submit aid correction",
    }),
    task({
      id: "done",
      planned_for: "2026-07-03T09:00:00",
      status: "done",
      title: "Finished task",
    }),
  ]

  it("matches search text across task fields", () => {
    expect(filterTasksByQuery(tasks, "essay").map((item) => item.id)).toEqual([
      "essay",
    ])
    expect(filterTasksByQuery(tasks, "high").map((item) => item.id)).toEqual([
      "essay",
    ])
    expect(filterTasksByQuery(tasks, "aid").map((item) => item.id)).toEqual([
      "aid",
    ])
  })

  it("keeps done tasks out of the upcoming view", () => {
    expect(tasks.filter(isTaskInUpcomingView).map((item) => item.id)).toEqual([
      "aid",
    ])
  })

  it("groups tasks by status immutably", () => {
    const grouped = groupTasksByStatus(tasks)

    expect(grouped.doing.map((item) => item.id)).toEqual(["essay"])
    expect(grouped.todo.map((item) => item.id)).toEqual(["aid"])
    expect(grouped.done.map((item) => item.id)).toEqual(["done"])
  })

  it("builds upcoming groups from planned and unplanned work", () => {
    const groups = getUpcomingGroups([
      task({
        id: "overdue",
        planned_for: "2026-06-30T09:00:00",
        title: "Overdue",
      }),
      task({
        id: "tomorrow",
        planned_for: "2026-07-02T09:00:00",
        title: "Tomorrow",
      }),
      task({
        due_at: "2026-07-08T23:59:00",
        id: "needs-planning",
        title: "Needs planning",
      }),
      task({ id: "unscheduled", title: "Unscheduled" }),
    ])

    expect(groups.find((group) => group.id === "overdue")?.tasks[0]?.id).toBe(
      "overdue"
    )
    expect(groups.find((group) => group.id === "tomorrow")?.tasks[0]?.id).toBe(
      "tomorrow"
    )
    expect(
      groups.find((group) => group.id === "needs-planning")?.tasks[0]?.id
    ).toBe("needs-planning")
    expect(
      groups.find((group) => group.id === "unscheduled")?.tasks[0]?.id
    ).toBe("unscheduled")
  })
})

describe("task sorting", () => {
  const tasks = [
    task({
      id: "low-later",
      planned_for: "2026-07-05T09:00:00",
      priority: "low",
      title: "Low later",
    }),
    task({
      id: "high-sooner",
      planned_for: "2026-07-02T09:00:00",
      priority: "high",
      title: "High sooner",
    }),
    task({
      id: "high-unplanned",
      priority: "high",
      title: "High unplanned",
    }),
  ]

  it("sorts planning tasks by planning date first", () => {
    expect(sortPlanningTasks(tasks).map((item) => item.id)).toEqual([
      "high-sooner",
      "low-later",
      "high-unplanned",
    ])
  })

  it("sorts all tasks by selected columns with deterministic fallback", () => {
    expect(
      sortAllTasks(tasks, {
        columnId: "priority",
        direction: "asc",
      }).map((item) => item.id)
    ).toEqual(["high-sooner", "high-unplanned", "low-later"])

    expect(
      sortAllTasks(tasks, {
        columnId: "workDate",
        direction: "desc",
      }).map((item) => item.id)
    ).toEqual(["low-later", "high-sooner", "high-unplanned"])
  })
})

describe("task mutations", () => {
  const baseTasks = [
    task({
      id: "first",
      status: "todo",
      title: "First",
      updated_at: "2026-06-01T09:00:00.000Z",
    }),
    task({
      completed_at: "2026-06-15T09:00:00.000Z",
      id: "second",
      status: "done",
      title: "Second",
      updated_at: "2026-06-01T09:00:00.000Z",
    }),
  ]

  it("moves tasks to a status without mutating unchanged records", () => {
    const nextTasks = moveTasksToStatus(baseTasks, ["first"], "done", timestamp)

    expect(nextTasks).not.toBe(baseTasks)
    expect(nextTasks[0]).not.toBe(baseTasks[0])
    expect(nextTasks[1]).toBe(baseTasks[1])
    expect(nextTasks[0]).toMatchObject({
      completed_at: timestamp,
      status: "done",
      updated_at: timestamp,
    })
  })

  it("returns the original array when a move changes nothing", () => {
    expect(moveTasksToStatus(baseTasks, ["second"], "done", timestamp)).toBe(
      baseTasks
    )
  })

  it("patches a task and respects touch=false", () => {
    const nextTasks = updateTaskById(
      baseTasks,
      "first",
      { title: "Changed" },
      { timestamp, touch: false }
    )

    expect(nextTasks[0]).toMatchObject({
      title: "Changed",
      updated_at: "2026-06-01T09:00:00.000Z",
    })
  })

  it("creates new user and agent tasks from the demo clock", () => {
    const todayTask = createNewTask("today", timestamp, "task-id")
    const upcomingTask = createNewTask("upcoming", timestamp, "task-id-2")
    const agentTask = createAgentPlanTask("today", timestamp, "agent-id")

    expect(todayTask).toMatchObject({
      id: "task-id",
      planned_for: expect.any(String),
      title: "Untitled task",
    })
    expect(getDateKey(new Date(todayTask.planned_for ?? ""))).toBe("2026-07-01")
    expect(upcomingTask.planned_for).toBeUndefined()
    expect(agentTask).toMatchObject({
      assignee: "counselle",
      id: "agent-id",
      planned_for: expect.any(String),
      title: "Let Counselle plan the next application sprint",
    })
  })
})

describe("task drag payload parsing", () => {
  it("accepts valid task drag payloads", () => {
    expect(
      parseTaskDragPayload(
        JSON.stringify({
          sourceColumnId: "todo",
          taskId: "task-1",
          taskIds: ["task-1", "task-2"],
        })
      )
    ).toEqual({
      sourceColumnId: "todo",
      taskId: "task-1",
      taskIds: ["task-1", "task-2"],
    })
  })

  it("rejects malformed external drop payloads", () => {
    expect(parseTaskDragPayload("not json")).toBeNull()
    expect(
      parseTaskDragPayload(JSON.stringify({ taskId: "task-1" }))
    ).toBeNull()
    expect(
      parseTaskDragPayload(
        JSON.stringify({
          sourceColumnId: "todo",
          taskId: "task-1",
          taskIds: ["task-1", 42],
        })
      )
    ).toBeNull()
  })
})
