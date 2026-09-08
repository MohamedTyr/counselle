import { requestJson } from "@/api/http/client";
import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";

/** `GET /v1/schools/{unitid}/facts` (plan §5.2). A 404 means the unitid is
 * not in our database; a school with no crawl row still comes back 200 with
 * `has_collegedata: false` — never 404 for that case. */
export function getSchoolFacts(unitid: number) {
  return requestJson<SchoolFactsResponse>(`/schools/${unitid}/facts`);
}
