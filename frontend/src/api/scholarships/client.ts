import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import type {
  AdminScholarship,
  RevisionOut,
  SavedIds,
  ScholarshipDraft,
  ScholarshipList,
  ScholarshipStatus,
} from "@/api/scholarships/types";

/* One function per `/v1/scholarships` and `/v1/admin/scholarships` route. */

const ADMIN = "/admin/scholarships";

export function listScholarships(signal?: AbortSignal) {
  return requestJson<ScholarshipList>("/scholarships", { signal });
}

export function listSavedScholarshipIds(signal?: AbortSignal) {
  return requestJson<SavedIds>("/scholarships/saved", { signal });
}

export function saveScholarship(id: string) {
  return requestVoid(`/scholarships/${id}/save`, { method: "PUT" });
}

export function unsaveScholarship(id: string) {
  return requestVoid(`/scholarships/${id}/save`, { method: "DELETE" });
}

export function listAdminScholarships(signal?: AbortSignal) {
  return requestJson<AdminScholarship[]>(ADMIN, { signal });
}

export function getAdminScholarship(id: string, signal?: AbortSignal) {
  return requestJson<AdminScholarship>(`${ADMIN}/${id}`, { signal });
}

export function createScholarship(draft: ScholarshipDraft) {
  return requestJson<AdminScholarship>(ADMIN, jsonRequestInit("POST", draft));
}

export function updateScholarship(id: string, draft: ScholarshipDraft, expectedVersion: number) {
  return requestJson<AdminScholarship>(
    `${ADMIN}/${id}`,
    jsonRequestInit("PUT", { ...draft, expected_version: expectedVersion }),
  );
}

export function setScholarshipStatus(id: string, status: ScholarshipStatus, expectedVersion?: number) {
  return requestJson<AdminScholarship>(
    `${ADMIN}/${id}/status`,
    jsonRequestInit("POST", { status, expected_version: expectedVersion ?? null }),
  );
}

export function markScholarshipChecked(id: string) {
  return requestJson<AdminScholarship>(`${ADMIN}/${id}/checked`, { method: "POST" });
}

export function listScholarshipRevisions(id: string, signal?: AbortSignal) {
  return requestJson<RevisionOut[]>(`${ADMIN}/${id}/revisions`, { signal });
}
