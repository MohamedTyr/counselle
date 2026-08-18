import {
  coverageFiltersFromUrlState,
  coverageUrlStateToParams,
  hasActiveCoverageFilters,
  isCoverageFindModeIdle,
  parseCoverageUrlState,
  type CoverageUrlState,
} from "@/features/cds-admin/coverage/coverage-params";

const DEFAULT_STATE: CoverageUrlState = {
  failed: false,
  missingYear: null,
  needsReview: false,
  q: "",
  scope: "with_documents",
};

describe("coverage-params", () => {
  it("parses an empty URL into the default state", () => {
    expect(parseCoverageUrlState(new URLSearchParams())).toEqual(
      DEFAULT_STATE,
    );
  });

  it("round-trips a fully-populated state through URLSearchParams", () => {
    const state: CoverageUrlState = {
      failed: true,
      missingYear: 2025,
      needsReview: true,
      q: "yale",
      scope: "all",
    };
    const params = coverageUrlStateToParams(state);
    expect(parseCoverageUrlState(params)).toEqual(state);
  });

  it("omits default values from the URL instead of writing them explicitly", () => {
    const params = coverageUrlStateToParams(DEFAULT_STATE);
    expect(params.toString()).toBe("");
  });

  it("is idle only in find mode with an empty query", () => {
    expect(isCoverageFindModeIdle(DEFAULT_STATE)).toBe(false);
    expect(isCoverageFindModeIdle({ ...DEFAULT_STATE, scope: "all" })).toBe(
      true,
    );
    expect(
      isCoverageFindModeIdle({ ...DEFAULT_STATE, scope: "all", q: "yale" }),
    ).toBe(false);
  });

  it("treats only q/missingYear/needsReview/failed as active filters, never scope", () => {
    expect(hasActiveCoverageFilters(DEFAULT_STATE)).toBe(false);
    expect(hasActiveCoverageFilters({ ...DEFAULT_STATE, scope: "all" })).toBe(
      false,
    );
    expect(hasActiveCoverageFilters({ ...DEFAULT_STATE, q: "  " })).toBe(
      false,
    );
    expect(hasActiveCoverageFilters({ ...DEFAULT_STATE, q: "yale" })).toBe(
      true,
    );
    expect(
      hasActiveCoverageFilters({ ...DEFAULT_STATE, needsReview: true }),
    ).toBe(true);
  });

  it("requests limit:0 in idle find mode, so only `total` is fetched", () => {
    const filters = coverageFiltersFromUrlState({
      ...DEFAULT_STATE,
      scope: "all",
    });
    expect(filters.all_schools).toBe(true);
    expect(filters.limit).toBe(0);
    expect(filters.q).toBeUndefined();
  });

  it("caps find-mode search results once a query exists", () => {
    const filters = coverageFiltersFromUrlState({
      ...DEFAULT_STATE,
      q: "yale",
      scope: "all",
    });
    expect(filters.limit).toBe(50);
    expect(filters.q).toBe("yale");
  });

  it("leaves limit unset for the default with_documents scope", () => {
    const filters = coverageFiltersFromUrlState(DEFAULT_STATE);
    expect(filters.all_schools).toBe(false);
    expect(filters.limit).toBeUndefined();
  });

  it("maps needsReview/failed onto the status filter array", () => {
    const filters = coverageFiltersFromUrlState({
      ...DEFAULT_STATE,
      failed: true,
      needsReview: true,
    });
    expect(filters.status).toEqual(["needs_review", "failed"]);
  });
});
