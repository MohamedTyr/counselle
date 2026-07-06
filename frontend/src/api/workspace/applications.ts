import {
  jsonRequestInit,
  requestJson,
  requestVoid,
} from "@/api/http/client"
import type {
  ApplicationAddResult,
  ApplicationCreate,
  ApplicationDetail,
  ApplicationPatch,
  ApplicationView,
  SchoolSearchResult,
} from "@/api/workspace/types"

export function searchSchools(query: string, limit = 8) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return requestJson<SchoolSearchResult[]>(`/schools/search?${params}`)
}

export function listApplications() {
  return requestJson<ApplicationView[]>("/applications")
}

export function addApplication(input: ApplicationCreate) {
  return requestJson<ApplicationAddResult>(
    "/applications",
    jsonRequestInit("POST", input),
  )
}

export function getApplication(applicationId: string) {
  return requestJson<ApplicationDetail>(`/applications/${applicationId}`)
}

export function updateApplication(
  applicationId: string,
  patch: ApplicationPatch,
) {
  return requestJson<ApplicationView>(
    `/applications/${applicationId}`,
    jsonRequestInit("PATCH", patch),
  )
}

export function archiveApplication(applicationId: string) {
  return requestVoid(`/applications/${applicationId}`, { method: "DELETE" })
}

export function restoreApplication(applicationId: string) {
  return requestVoid(`/applications/${applicationId}/restore`, {
    method: "POST",
  })
}
