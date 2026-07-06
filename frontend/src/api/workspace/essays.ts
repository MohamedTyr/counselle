import {
  jsonRequestInit,
  requestJson,
  requestVoid,
} from "@/api/http/client"
import type {
  Essay,
  EssayCreate,
  EssayPatch,
  EssaySummary,
} from "@/api/workspace/types"

export function listEssays() {
  return requestJson<EssaySummary[]>("/essays")
}

export function createEssay(input: EssayCreate) {
  return requestJson<EssaySummary>("/essays", jsonRequestInit("POST", input))
}

export function getEssay(essayId: string) {
  return requestJson<Essay>(`/essays/${essayId}`)
}

export function updateEssay(essayId: string, patch: EssayPatch) {
  return requestJson<Essay>(
    `/essays/${essayId}`,
    jsonRequestInit("PATCH", patch),
  )
}

export function archiveEssay(essayId: string) {
  return requestVoid(`/essays/${essayId}`, { method: "DELETE" })
}

export function restoreEssay(essayId: string) {
  return requestJson<EssaySummary>(`/essays/${essayId}/restore`, {
    method: "POST",
  })
}

export function duplicateEssay(essayId: string) {
  return requestJson<EssaySummary>(`/essays/${essayId}/duplicate`, {
    method: "POST",
  })
}
