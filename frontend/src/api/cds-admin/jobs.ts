import { requestJson } from "@/api/http/client";
import type { JobStatusRow } from "@/api/cds-admin/types";

/** `GET /admin/cds/jobs` takes either `batch_id` or `ids[]` (endpoint #8) —
 * never both, never neither (the route 422s on that). */
export type JobsQuery = { batchId: string } | { ids: string[] };

export function getJobs(query: JobsQuery) {
  const params = new URLSearchParams();
  if ("batchId" in query) {
    params.set("batch_id", query.batchId);
  } else {
    for (const id of query.ids) params.append("ids", id);
  }
  return requestJson<JobStatusRow[]>(`/admin/cds/jobs?${params}`);
}
