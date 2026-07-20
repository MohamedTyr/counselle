import type {
  Task as ApiTask,
  TaskPatch as ApiTaskPatch,
} from "@/api/workspace/types";

export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type TaskCategory =
  "essay" | "lor" | "aid" | "research" | "other" | "form" | "interview";
export type TaskPriority = "low" | "med" | "high";
export type TaskAssignee = "student" | "counselle";

export type Task = {
  id: string;
  title: string;
  notes?: string;
  due_at?: string;
  planned_for?: string;
  status: TaskStatus;
  category: TaskCategory;
  assignee: TaskAssignee;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  needs_input?: boolean;
  reminder_at?: string;
  priority: TaskPriority;
  application_id?: string;
  essay_id?: string;
  requirement_kind?: string;
};

function undefinedIfNull<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

export function taskFromApi(task: ApiTask): Task {
  return {
    id: task.id,
    title: task.title,
    notes: undefinedIfNull(task.notes),
    due_at: undefinedIfNull(task.due_at),
    planned_for: undefinedIfNull(task.planned_for),
    status: task.status,
    category: task.category,
    assignee: task.assignee,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: undefinedIfNull(task.completed_at),
    needs_input: task.needs_input,
    reminder_at: undefinedIfNull(task.reminder_at),
    priority: task.priority,
    application_id: undefinedIfNull(task.application_id),
    essay_id: undefinedIfNull(task.essay_id),
    requirement_kind: undefinedIfNull(task.requirement_kind),
  };
}

const patchableTaskFields = [
  "title",
  "notes",
  "due_at",
  "planned_for",
  "status",
  "category",
  "assignee",
  "needs_input",
  "reminder_at",
  "priority",
  "application_id",
  "essay_id",
  "requirement_kind",
] as const satisfies readonly (keyof Task)[];

/**
 * Converts a domain-level task patch (where clearing a field means setting it
 * to `undefined`) into the API patch shape (where clearing a field means
 * sending an explicit `null`). `completed_at` is intentionally excluded: the
 * server derives it from `status` and does not accept it as a patch field.
 */
export function taskPatchToApi(patch: Partial<Task>): ApiTaskPatch {
  const apiPatch: Record<string, unknown> = {};

  for (const field of patchableTaskFields) {
    if (field in patch) {
      const value = patch[field];
      apiPatch[field] = value === undefined ? null : value;
    }
  }

  if ("application_id" in patch) {
    if (!("essay_id" in patch)) apiPatch.essay_id = null;
    if (!("requirement_kind" in patch)) apiPatch.requirement_kind = null;
  }

  return apiPatch as ApiTaskPatch;
}
