import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import type { Task, TaskCreate, TaskPatch } from "@/api/workspace/types";

export function listTasks() {
  return requestJson<Task[]>("/tasks");
}

export function createTask(input: TaskCreate) {
  return requestJson<Task>("/tasks", jsonRequestInit("POST", input));
}

export function updateTask(taskId: string, patch: TaskPatch) {
  const coherentPatch =
    "application_id" in patch
      ? { essay_id: null, requirement_kind: null, ...patch }
      : patch;
  return requestJson<Task>(
    `/tasks/${taskId}`,
    jsonRequestInit("PATCH", coherentPatch),
  );
}

export function archiveTask(taskId: string) {
  return requestVoid(`/tasks/${taskId}`, { method: "DELETE" });
}

export function restoreTask(taskId: string) {
  return requestJson<Task>(`/tasks/${taskId}/restore`, { method: "POST" });
}

export function reorderTasks(ids: string[]) {
  return requestJson<Task[]>("/tasks/order", jsonRequestInit("PUT", { ids }));
}
