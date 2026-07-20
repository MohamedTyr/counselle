import type { Task, TaskStatus } from "@/domain/task";
import { createClientId, createTimestamp } from "@/lib/time";
import type { TaskView, UpdateTask } from "@/features/tasks/task-types";
import { getTodayPlannedForValue } from "@/features/tasks/task-dates";

export function getTaskStatusPatch(
  task: Task,
  status: TaskStatus,
  timestamp = createTimestamp(),
): Partial<Task> {
  return {
    completed_at:
      status === "done" ? (task.completed_at ?? timestamp) : undefined,
    status,
  };
}

export function createNewTask(
  view: TaskView,
  timestamp = createTimestamp(),
  id = createClientId("task"),
): Task {
  return {
    id,
    title: "Untitled task",
    status: "todo",
    category: "other",
    assignee: "student",
    created_at: timestamp,
    updated_at: timestamp,
    planned_for:
      view === "today"
        ? getTodayPlannedForValue(new Date(timestamp))
        : undefined,
    priority: "med",
  };
}

export function updateTaskStatusFromPlanning(
  task: Task,
  status: TaskStatus,
  onUpdateTask: UpdateTask,
  options?: { planForToday?: boolean },
) {
  onUpdateTask(task.id, {
    ...getTaskStatusPatch(task, status),
    planned_for: options?.planForToday
      ? getTodayPlannedForValue()
      : task.planned_for,
  });
}
