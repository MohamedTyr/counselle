import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import type {
  Activity,
  ActivityCreate,
  ActivityPatch,
  Honor,
  HonorCreate,
  HonorPatch,
} from "@/api/workspace/types";

export function listActivities() {
  return requestJson<Activity[]>("/activities");
}

export function createActivity(input: ActivityCreate) {
  return requestJson<Activity>("/activities", jsonRequestInit("POST", input));
}

export function updateActivity(activityId: string, patch: ActivityPatch) {
  return requestJson<Activity>(
    `/activities/${activityId}`,
    jsonRequestInit("PATCH", patch),
  );
}

export function archiveActivity(activityId: string) {
  return requestVoid(`/activities/${activityId}`, { method: "DELETE" });
}

export function restoreActivity(activityId: string) {
  return requestJson<Activity>(`/activities/${activityId}/restore`, {
    method: "POST",
  });
}

export function reorderActivities(ids: string[]) {
  return requestJson<Activity[]>(
    "/activities/order",
    jsonRequestInit("PUT", { ids }),
  );
}

export function listHonors() {
  return requestJson<Honor[]>("/honors");
}

export function createHonor(input: HonorCreate) {
  return requestJson<Honor>("/honors", jsonRequestInit("POST", input));
}

export function updateHonor(honorId: string, patch: HonorPatch) {
  return requestJson<Honor>(
    `/honors/${honorId}`,
    jsonRequestInit("PATCH", patch),
  );
}

export function archiveHonor(honorId: string) {
  return requestVoid(`/honors/${honorId}`, { method: "DELETE" });
}

export function restoreHonor(honorId: string) {
  return requestJson<Honor>(`/honors/${honorId}/restore`, { method: "POST" });
}

export function reorderHonors(ids: string[]) {
  return requestJson<Honor[]>("/honors/order", jsonRequestInit("PUT", { ids }));
}
