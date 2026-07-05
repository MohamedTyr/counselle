import type { Task, TaskStatus } from "@/domain/task"
import { createDemoId, createTimestamp } from "@/domain/time"
import type { TaskView, UpdateTask } from "@/features/tasks/task-types"
import { getTodayPlannedForValue } from "@/features/tasks/task-dates"

export function getTaskStatusPatch(
  task: Task,
  status: TaskStatus,
  timestamp = createTimestamp()
): Partial<Task> {
  return {
    completed_at:
      status === "done" ? (task.completed_at ?? timestamp) : undefined,
    status,
  }
}

export function updateTaskById(
  tasks: Task[],
  taskId: string,
  patch: Partial<Task>,
  options: { timestamp?: string; touch?: boolean } = {}
) {
  const timestamp = options.timestamp ?? createTimestamp()
  const shouldTouch = options.touch !== false
  let changed = false

  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) {
      return task
    }

    changed = true

    return {
      ...task,
      ...patch,
      updated_at: shouldTouch
        ? timestamp
        : (patch.updated_at ?? task.updated_at),
    }
  })

  return changed ? nextTasks : tasks
}

export function moveTasksToStatus(
  tasks: Task[],
  taskIds: string[],
  targetStatus: TaskStatus,
  timestamp = createTimestamp()
) {
  const movingTaskIds = new Set(taskIds)
  let changed = false

  const nextTasks = tasks.map((task) => {
    if (!movingTaskIds.has(task.id) || task.status === targetStatus) {
      return task
    }

    changed = true

    return {
      ...task,
      ...getTaskStatusPatch(task, targetStatus, timestamp),
      updated_at: timestamp,
    }
  })

  return changed ? nextTasks : tasks
}

export function createNewTask(
  view: TaskView,
  timestamp = createTimestamp(),
  id = createDemoId("task")
): Task {
  return {
    id,
    title: "Untitled task",
    status: "todo",
    category: "other",
    assignee: "student",
    created_at: timestamp,
    updated_at: timestamp,
    planned_for: view === "today" ? getTodayPlannedForValue() : undefined,
    priority: "med",
  }
}

export function createAgentPlanTask(
  view: TaskView,
  timestamp = createTimestamp(),
  id = createDemoId("agent-plan")
): Task {
  return {
    id,
    title: "Let Counselle plan the next application sprint",
    notes:
      "Ask the agent to sequence essays, aid forms, research, and portal checks for the next seven days.",
    status: "todo",
    category: "other",
    assignee: "counselle",
    created_at: timestamp,
    updated_at: timestamp,
    planned_for: view === "today" ? getTodayPlannedForValue() : undefined,
    priority: "med",
  }
}

export function updateTaskStatusFromPlanning(
  task: Task,
  status: TaskStatus,
  onUpdateTask: UpdateTask,
  options?: { planForToday?: boolean }
) {
  onUpdateTask(task.id, {
    ...getTaskStatusPatch(task, status),
    planned_for: options?.planForToday
      ? getTodayPlannedForValue()
      : task.planned_for,
  })
}
