import { requestJson, requestVoid } from "@/api/http/client";
import { BASE } from "@/api/http/constants";
import { SAT_IMPORT_TIMEOUT_MS } from "@/config";
import type {
  SatAttemptOut,
  SatAttemptSubmit,
  SatCounts,
  SatFilterQuery,
  SatImportResult,
  SatQuestionPublic,
  SatSessionRow,
  SatStatsResponse,
  SatSubmitResult,
  SatTaxonomy,
} from "@/api/sat/types";

/** `bands`/`status`/`excludeBluebook` are shared by `/counts` and `/session`
 * (plan §4.2, §4.5); `skills` only applies to `/session` — `/counts` ignores
 * the skill selection on purpose (§4.5: "each skill shows what *it* would
 * contribute"), so callers that pass it here for `/counts` get it silently
 * dropped by `includeSkills: false`. */
function filterSearchParams(
  filter: SatFilterQuery,
  { includeSkills }: { includeSkills: boolean },
): URLSearchParams {
  const params = new URLSearchParams();
  if (includeSkills && filter.skills && filter.skills.length > 0) {
    for (const skill of filter.skills) params.append("skills", skill);
  }
  if (filter.bands && filter.bands.length > 0) {
    for (const band of filter.bands) params.append("bands", String(band));
  }
  if (filter.status && filter.status !== "all") {
    params.set("status", filter.status);
  }
  if (filter.excludeBluebook !== undefined) {
    params.set("exclude_bluebook", String(filter.excludeBluebook));
  }
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function getTaxonomy(signal?: AbortSignal) {
  return requestJson<SatTaxonomy>("/sat/taxonomy", { signal });
}

export function getCounts(filter: SatFilterQuery, signal?: AbortSignal) {
  const params = filterSearchParams(filter, { includeSkills: false });
  return requestJson<SatCounts>(withQuery("/sat/counts", params), { signal });
}

/** `GET /session` — the whole filtered session as light rows (plan §5.4). */
export function getSession(filter: SatFilterQuery, signal?: AbortSignal) {
  const params = filterSearchParams(filter, { includeSkills: true });
  return requestJson<SatSessionRow[]>(withQuery("/sat/session", params), {
    signal,
  });
}

/** `GET /session?question=<id>` — an id lookup, not a filtered list (plan
 * §4.2, P0.4): resolves aliases then `lower(id)`, ignores `retired_at`. The
 * server returns a *bare* row for this form (`api/routes/sat.py`'s
 * `SatSessionRow | list[SatSessionRow]`), not a list — this wraps it into a
 * one-element array so callers can treat any session identically, one row
 * or 1,900 (plan §4.2's own phrasing). */
export function getSessionByQuestion(
  questionId: string,
  signal?: AbortSignal,
): Promise<SatSessionRow[]> {
  const params = new URLSearchParams({ question: questionId });
  return requestJson<SatSessionRow>(withQuery("/sat/session", params), {
    signal,
  }).then((row) => [row]);
}

/** `GET /questions/{id}` — no `correct_answers`/`rationale` (plan §4.2). */
export function getQuestion(questionId: string, signal?: AbortSignal) {
  return requestJson<SatQuestionPublic>(
    `/sat/questions/${encodeURIComponent(questionId)}`,
    { signal },
  );
}

export function getAttempts(questionId: string, signal?: AbortSignal) {
  return requestJson<SatAttemptOut[]>(
    `/sat/questions/${encodeURIComponent(questionId)}/attempts`,
    { signal },
  );
}

export function submitAttempt(questionId: string, body: SatAttemptSubmit) {
  return requestJson<SatSubmitResult>(
    `/sat/questions/${encodeURIComponent(questionId)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function putBookmark(questionId: string) {
  return requestVoid(`/sat/bookmarks/${encodeURIComponent(questionId)}`, {
    method: "PUT",
  });
}

export function deleteBookmark(questionId: string) {
  return requestVoid(`/sat/bookmarks/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
  });
}

export function getStats(today: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ today });
  return requestJson<SatStatsResponse>(withQuery("/sat/stats", params), {
    signal,
  });
}

/** Raw-bytes download URL for `<a download href>` (plan §5.7) — the repo's
 * existing pattern for server files (`api/workspace/documents.ts`). Never
 * fetch this with JSON parsing. */
export function satProgressExportUrl(today: string): string {
  const params = new URLSearchParams({ today });
  return `${BASE}${withQuery("/sat/progress/export", params)}`;
}

/**
 * Import = replace (plan §5.7, A13). The plan calls for `requestVoid` here
 * (the file body is already JSON, so no multipart, no client-side parse),
 * but `PUT /progress` answers `SatImportResult` and the import banner
 * ("Imported N attempts & M bookmarks.", `sat-copy.ts`'s `importedToast`)
 * needs those counts — so this uses `requestJson<SatImportResult>` with the
 * exact same call shape instead of discarding the body.
 */
export function importProgress(today: string, file: File) {
  const params = new URLSearchParams({ today });
  return requestJson<SatImportResult>(
    withQuery("/sat/progress", params),
    {
      method: "PUT",
      body: file,
      headers: { "Content-Type": "application/json" },
    },
    SAT_IMPORT_TIMEOUT_MS,
  );
}

export function resetProgress() {
  return requestVoid("/sat/progress", { method: "DELETE" });
}
