import { requestJson, requestVoid } from "@/api/http/client";
import type { Memory } from "@/api/workspace/types";

export function listMemories() {
  return requestJson<Memory[]>("/memories");
}

export function archiveMemory(memoryId: string) {
  return requestVoid(`/memories/${memoryId}`, { method: "DELETE" });
}
