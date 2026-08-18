import { requestJson } from "@/api/http/client";
import type {
  CoverageFilters,
  CoverageResult,
  SchoolSummary,
} from "@/api/cds-admin/types";

/** Builds the query string for `GET /admin/cds/coverage`. Array filters
 * (`year[]`, `status[]`) go out as repeated keys (`year=2023&year=2024`) —
 * the shape FastAPI's `list[int] | None` query parsing expects. */
function coverageParams(filters: CoverageFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const year of filters.year ?? []) params.append("year", String(year));
  for (const status of filters.status ?? []) params.append("status", status);
  if (filters.missing_year !== undefined) {
    params.set("missing_year", String(filters.missing_year));
  }
  if (filters.all_schools !== undefined) {
    params.set("all_schools", String(filters.all_schools));
  }
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) {
    params.set("offset", String(filters.offset));
  }
  return params;
}

export function getCoverage(filters: CoverageFilters = {}) {
  const query = coverageParams(filters).toString();
  return requestJson<CoverageResult>(
    `/admin/cds/coverage${query ? `?${query}` : ""}`,
  );
}

export function searchSchools(q: string, limit = 20) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return requestJson<SchoolSummary[]>(`/admin/cds/schools?${params}`);
}
