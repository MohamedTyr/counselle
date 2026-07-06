import {
  jsonRequestInit,
  requestJson,
  requestVoid,
} from "@/api/http/client"
import type {
  Task,
  TaskCreate,
  TaskPatch,
  TaskStatus,
} from "@/api/workspace/types"

export function listTasks() {
  return requestJson<Task[]>("/tasks")
}

export function createTask(input: TaskCreate) {
  return requestJson<Task>("/tasks", jsonRequestInit("POST", input))
}

export function updateTask(taskId: string, patch: TaskPatch) {
  return requestJson<Task>(`/tasks/${taskId}`, jsonRequestInit("PATCH", patch))
}

export function archiveTask(taskId: string) {
  return requestVoid(`/tasks/${taskId}`, { method: "DELETE" })
}

export function restoreTask(taskId: string) {
  return requestJson<Task>(`/tasks/${taskId}/restore`, { method: "POST" })
}

export function bulkUpdateTaskStatus(ids: string[], status: TaskStatus) {
  return requestJson<Task[]>(
    "/tasks/bulk-status",
    jsonRequestInit("POST", { ids, status }),
  )
}

export function bulkArchiveTasks(ids: string[]) {
  return requestJson<Task[]>(
    "/tasks/bulk-archive",
    jsonRequestInit("POST", { ids }),
  )
}
