import type { ScholarshipPublic } from "@/api/scholarships/types";
import { defaultAuthenticatedFetch, emptyResponse, jsonResponse } from "@/test/render-app";

export function scholarshipRecord(overrides: Partial<ScholarshipPublic> = {}): ScholarshipPublic {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-09-01T00:00:00Z",
    name: "Future Leaders Award",
    sponsor: "Acme Foundation",
    summary: "For students who lead.",
    apply_url: "https://acme.org/apply",
    source_url: "https://acme.org/scholarship",
    logo_url: "",
    award: { kind: "fixed", amount: 5000, min: null, max: null, renewable: false, years: null, awards_count: null },
    deadline: { kind: "rolling", date: null, opens_on: null, recurs_annually: false },
    basis: ["merit"],
    fields: [],
    eligibility: [],
    other_eligibility: [],
    requirements: { essays: [], recommendations: 0, transcript: false, financial_documents: false, interview: false },
    last_checked_on: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

/** Serves the scholarship list and a saved-ids set that PUT/DELETE really change. */
export function scholarshipFetch(
  list: () => Promise<Response> | Response,
  initialSaved: readonly string[] = [],
) {
  let saved = [...initialSaved];
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/scholarships")) return list();
    if (url.endsWith("/v1/scholarships/saved")) return jsonResponse({ ids: saved });
    const save = url.match(/\/v1\/scholarships\/([^/]+)\/save$/);
    if (save) {
      const id = save[1];
      saved = saved.filter((other) => other !== id);
      if (init?.method === "PUT") saved = [id, ...saved];
      return emptyResponse({ status: 204 });
    }
    return defaultAuthenticatedFetch(input, init);
  };
}
