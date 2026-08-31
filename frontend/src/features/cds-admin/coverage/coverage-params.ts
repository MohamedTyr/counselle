import type { CellStatus, CoverageFilters } from "@/api/cds-admin/types";

/**
 * Coverage screen URL state (DESIGN.md §3.8) and its translation into
 * `CoverageFilters` for `useCoverage`. Pure functions, kept separate from
 * the page component so the "what does this filter combination actually
 * fetch" logic is unit-testable without mounting React.
 */

export type CoverageScope = "with_documents" | "all";

export interface CoverageUrlState {
  q: string;
  scope: CoverageScope;
  missingYear: number | null;
  needsReview: boolean;
  /** Not in DESIGN.md's documented four-param URL list (`q`, `scope`,
   * `missing`, `review`) — added to satisfy §3.7's "non-zero attention
   * counts are buttons" rule for the `failed` counter, which has a colour
   * (red) but no corresponding control in the §3.8 filter bar. See the
   * implementation report for the full rationale. */
  failed: boolean;
}

/** Rows appear in "All schools" find mode only once there's a query
 * (DESIGN.md §3.1 move 2) — this is the idle/prompt state. */
export function isCoverageFindModeIdle(state: CoverageUrlState): boolean {
  return state.scope === "all" && state.q.trim().length === 0;
}

export function hasActiveCoverageFilters(state: CoverageUrlState): boolean {
  return Boolean(
    state.q.trim() || state.missingYear || state.needsReview || state.failed,
  );
}

export function parseCoverageUrlState(
  params: URLSearchParams,
): CoverageUrlState {
  const q = params.get("q") ?? "";
  const scope: CoverageScope = params.get("scope") === "all" ? "all" : "with_documents";
  const missingYearRaw = Number.parseInt(params.get("missing") ?? "", 10);
  const missingYear = Number.isFinite(missingYearRaw) ? missingYearRaw : null;

  return {
    failed: params.get("failed") === "1",
    missingYear,
    needsReview: params.get("review") === "1",
    q,
    scope,
  };
}

export function coverageUrlStateToParams(
  state: CoverageUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.scope === "all") params.set("scope", "all");
  if (state.missingYear) params.set("missing", String(state.missingYear));
  if (state.needsReview) params.set("review", "1");
  if (state.failed) params.set("failed", "1");
  return params;
}

/** In "All schools" find mode with a query, results are bounded so a broad
 * match still can't flood the grid. With an empty query the API itself
 * never returns rows for find mode (DESIGN.md §3.1 move 2 — enforced
 * server-side in `coverage_grid`'s idle branch), so no client-side limit
 * trick is needed to suppress them here. */
const FIND_MODE_RESULT_LIMIT = 50;

export function coverageFiltersFromUrlState(
  state: CoverageUrlState,
): CoverageFilters {
  const trimmedQuery = state.q.trim();
  const isFindMode = state.scope === "all";
  const status: CellStatus[] = [];
  if (state.needsReview) status.push("needs_review");
  if (state.failed) status.push("failed");

  return {
    all_schools: isFindMode,
    limit: isFindMode && trimmedQuery ? FIND_MODE_RESULT_LIMIT : undefined,
    missing_year: state.missingYear ?? undefined,
    q: trimmedQuery || undefined,
    status: status.length > 0 ? status : undefined,
  };
}
