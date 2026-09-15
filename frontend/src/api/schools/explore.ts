/**
 * Typed client + React Query hooks for `GET /v1/schools/explore` and
 * `GET /v1/schools/majors` (plan §5.3). Types mirror
 * `app/facts/explore_models.py` verbatim -- `ExploreSchoolCard.fields` keys
 * are `adapters/facts_store.py::EXPLORE_COLUMNS` names, unchanged on the
 * wire (no alias generator on `FrozenModel`, plan §6a).
 *
 * One file, matching the surface's size (the `api/admin/facts-status.ts`
 * precedent) -- `keys.ts`/`hooks.ts` in this directory belong to the facts
 * page; this endpoint's query key and hook live here instead of
 * splitting across files that belong to that other feature.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useAuthUser } from "@/app/auth";
import { requestJson } from "@/api/http/client";
import { schoolsExploreQueryKey } from "@/api/schools/explore-query-key";

export { schoolsExploreQueryKey } from "@/api/schools/explore-query-key";

export type Control = "public" | "private" | "private_for_profit";
export type TestPolicy =
  "required" | "considered" | "not_required" | "not_reported";
export type Gender = "coed" | "women" | "men";
export type CampusSettingFamily = "City" | "Suburb" | "Town" | "Rural";
export type SizeBucket = "lt2k" | "2k-10k" | "10k-25k" | "gt25k";
export type ScoreFit =
  "any" | "at_or_above_p25" | "inside_band" | "at_or_above_p75";
export type ExclusionReason = "missing" | "not_reported";
export type FitCategory = "Reach" | "Target" | "Safety" | "Unknown";
export type FitBasis = "school_rate" | "personalized" | "missing_admit_rate";
export type FitEvidenceLevel =
  "baseline_only" | "one_comparison" | "two_comparisons";
export type FitFactor = "academic" | "testing";
export type FitSignalSource =
  "gpa_distribution" | "class_rank" | "sat" | "act" | "sat_and_act";
export type FitAssessment = "strong" | "weak";
export type FitUnavailableReason =
  | "profile_gpa_missing"
  | "profile_gpa_invalid"
  | "gpa_scale_incompatible"
  | "gpa_distribution_unavailable"
  | "gpa_distribution_stale"
  | "gpa_distribution_invalid"
  | "profile_rank_unavailable"
  | "rank_disabled"
  | "rank_distribution_unavailable"
  | "rank_distribution_stale"
  | "rank_distribution_invalid"
  | "profile_test_missing"
  | "test_score_invalid"
  | "incomplete_sat_comparison"
  | "test_band_unavailable"
  | "test_band_stale"
  | "test_band_invalid"
  | "test_policy_not_required_or_unknown";
export type FitCaveat =
  "entering_class_benchmark_not_cutoff" | "stale_optional_facts";
export type SuggestedProfileField = "gpa" | "class_rank" | "test_scores";

export type FitSignal = {
  factor: FitFactor;
  source: FitSignalSource;
  assessment: FitAssessment;
};

export type UnavailableFactor = {
  factor: FitFactor;
  reason: FitUnavailableReason;
};

/** Server-owned category. It is a planning classification, never a client
 * calculation or a probability. */
export type FitEstimate = {
  category: FitCategory;
  baseline_category: FitCategory;
  baseline_admit_rate: number | null;
  basis: FitBasis;
  evidence_level: FitEvidenceLevel;
  signals: FitSignal[];
  unavailable: UnavailableFactor[];
  caveats: FitCaveat[];
  algorithm_version: "admissions-fit-v1";
};

/** Safe capability summary for the saved Profile the server used. The raw
 * Profile never rides the Explore response. */
export type FitProfileSummary = {
  has_academic_candidate: boolean;
  has_complete_test_candidate: boolean;
  suggested_profile_fields: SuggestedProfileField[];
};

/** `app/facts/explore_models.py::RangeKey` -- the columns Phase 1's
 * projection actually populates, minus the ones the plan itself drops
 * (net price, out-of-state %, admit rate by home state, REA, any SAT
 * composite -- R14/D10). `needFullyMet` and `meritAid` are real, filterable
 * columns, populated on 1,425 and 1,365 of 2,239 `cds_library.school_explore`
 * rows respectively (verified live) -- not NULL on every row. */
export type RangeKey =
  | "admit"
  | "cost"
  | "needMet"
  | "needFullyMet"
  | "meritAid"
  | "gradFour"
  | "gradSix"
  | "retention"
  | "ratio"
  | "housing"
  | "international";

export type SortKey =
  | "name"
  | "undergraduates"
  | "admit"
  | "cost"
  | "needMet"
  | "gradFour"
  | "gradSix"
  | "retention"
  | "deadline";

export type SortDirection = "asc" | "desc";

/** One `school_explore` row's ~60 metric/filter columns, exactly as
 * `adapters/facts_store.py::EXPLORE_COLUMNS` names them -- one source of
 * truth, not a hand-typed mirror that drifts from the SQL tuple. Every
 * value is nullable and never defaulted; a missing key reads the same as
 * an explicit `null` (`fields.foo ?? null`). */
export type ExploreFields = {
  region: string;
  locale: string | null;
  control: Control;
  institution_level: string | null;
  gender_model: Gender | null;
  religious_affiliation: string | null;
  hbcu: boolean;
  hsi: boolean | null;
  tribal: boolean;
  land_grant: boolean;
  undergraduates: number | null;
  graduate_students: number | null;
  international_pct: number | null;
  admit_rate: number | null;
  admit_rate_women: number | null;
  admit_rate_men: number | null;
  applicants_total: number | null;
  admitted_total: number | null;
  enrolled_total: number | null;
  yield_rate: number | null;
  entrance_difficulty: string | null;
  sat_math_p25: number | null;
  sat_math_p75: number | null;
  sat_ebrw_p25: number | null;
  sat_ebrw_p75: number | null;
  act_composite_p25: number | null;
  act_composite_p75: number | null;
  act_composite_avg: number | null;
  gpa_avg: number | null;
  need_met_pct: number | null;
  cost_attendance_in_state: number | null;
  cost_attendance_out_of_state: number | null;
  tuition_in_state: number | null;
  tuition_out_of_state: number | null;
  room_and_board: number | null;
  books_and_supplies: number | null;
  other_expenses: number | null;
  avg_indebtedness: number | null;
  graduates_with_loans_pct: number | null;
  retention_pct: number | null;
  grad_rate_4y: number | null;
  grad_rate_5y: number | null;
  grad_rate_6y: number | null;
  undergraduate_full_time: number | null;
  faculty_full_time: number | null;
  faculty_part_time: number | null;
  faculty_terminal_pct: number | null;
  housing_pct: number | null;
  greek_pct_men: number | null;
  greek_pct_women: number | null;
  calendar: string | null;
  application_fee: number | null;
  application_fee_waiver: boolean | null;
  accepts_common_app: boolean | null;
  offers_early_decision: boolean | null;
  offers_early_action: boolean | null;
  is_rolling: boolean | null;
  deadline_regular: string | null;
  waitlist_used: boolean | null;
  majors: string[] | null;
  majors_count: number | null;
  special_programs: string[] | null;
};

export type ExploreSchoolCard = {
  unitid: number;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
  fields: ExploreFields;
  fit: FitEstimate;
};

export type Exclusion = {
  key: string;
  metric_label: string;
  count: number;
  reason: ExclusionReason;
};

export type NullTail = {
  count: number;
  metric_label: string;
};

export type Narrowest = {
  key: string;
  label: string;
  remaining_without_it: number;
};

export type FilterOption = {
  value: string;
  label: string;
  states: string | null;
};

export type FilterOptions = {
  region: FilterOption[];
  campus_setting: FilterOption[];
  religious_affiliation: FilterOption[];
};

export type ExploreResponse = {
  schools: ExploreSchoolCard[];
  page: number;
  page_size: number;
  total: number;
  total_is_capped: boolean;
  browsable_total: number;
  catalog_total: number;
  exclusions: Exclusion[];
  sorted_null_tail: NullTail | null;
  control_counts: Record<Control, number>;
  narrowest: Narrowest | null;
  filter_options: FilterOptions;
  facts_observed_from: string | null;
  band_caption: string;
  entrance_difficulty_note: string;
  majors_match_note: string;
  religious_affiliation_note: string;
  fit_profile_summary: FitProfileSummary;
};

export type MajorOption = {
  name: string;
  school_count: number;
};

export type MajorsResponse = {
  majors: MajorOption[];
  majors_match_note: string;
};

/** The bound query fields `app/facts/explore_models.py::ExploreQuery`
 * accepts. Snake-cased to match the wire 1:1 -- this is the request body,
 * not a UI type, so it takes the server's naming rather than the client's. */
export type ExploreQueryInput = {
  q?: string | null;
  state?: string[];
  region?: string[];
  size_bucket?: SizeBucket[];
  control?: Control | null;
  test_policy?: TestPolicy | null;
  campus_setting?: CampusSettingFamily[];
  religious_affiliation?: string | null;
  gender?: Gender | null;
  hbcu?: boolean;
  hsi?: boolean;
  tribal?: boolean;
  land_grant?: boolean;
  entrance_difficulty?: string | null;
  calendar?: string | null;
  major?: string | null;
  no_application_fee?: boolean;
  offers_early_decision?: boolean;
  offers_early_action?: boolean;
  rolling_admission?: boolean;
  include_rolling?: boolean;
  deadline_before?: string | null;
  home_state?: string | null;
  score_fit?: ScoreFit;
  sat_math?: number | null;
  sat_ebrw?: number | null;
  act?: number | null;
  admit_min?: number | null;
  admit_max?: number | null;
  cost_min?: number | null;
  cost_max?: number | null;
  need_met_min?: number | null;
  need_met_max?: number | null;
  need_fully_met_min?: number | null;
  need_fully_met_max?: number | null;
  merit_aid_min?: number | null;
  merit_aid_max?: number | null;
  grad_four_min?: number | null;
  grad_four_max?: number | null;
  grad_six_min?: number | null;
  grad_six_max?: number | null;
  retention_min?: number | null;
  retention_max?: number | null;
  ratio_min?: number | null;
  ratio_max?: number | null;
  housing_min?: number | null;
  housing_max?: number | null;
  international_min?: number | null;
  international_max?: number | null;
  include_missing?: RangeKey[];
  sort?: string;
};

/** Server pages, per plan §5.3 ("the client appends server pages (24)").
 * Kept here, not in Settings: it is a request shape the client owns
 * (`page_size`), not a value the server would ever need tuned without a
 * matching client change. */
export const EXPLORE_PAGE_SIZE = 24;
function buildExploreSearchParams(
  query: ExploreQueryInput,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  const set = (
    key: string,
    value: string | number | boolean | null | undefined,
  ) => {
    if (value === null || value === undefined || value === "") return;
    params.append(key, String(value));
  };
  const setList = (key: string, values: readonly string[] | undefined) => {
    for (const value of values ?? []) params.append(key, value);
  };

  set("q", query.q);
  setList("state", query.state);
  setList("region", query.region);
  setList("size_bucket", query.size_bucket);
  set("control", query.control);
  set("test_policy", query.test_policy);
  setList("campus_setting", query.campus_setting);
  set("religious_affiliation", query.religious_affiliation);
  set("gender", query.gender);
  set("hbcu", query.hbcu || undefined);
  set("hsi", query.hsi || undefined);
  set("tribal", query.tribal || undefined);
  set("land_grant", query.land_grant || undefined);
  set("entrance_difficulty", query.entrance_difficulty);
  set("calendar", query.calendar);
  set("major", query.major);
  set("no_application_fee", query.no_application_fee || undefined);
  set("offers_early_decision", query.offers_early_decision || undefined);
  set("offers_early_action", query.offers_early_action || undefined);
  set("rolling_admission", query.rolling_admission || undefined);
  set("include_rolling", query.include_rolling || undefined);
  set("deadline_before", query.deadline_before);
  set("home_state", query.home_state);
  set(
    "score_fit",
    query.score_fit && query.score_fit !== "any" ? query.score_fit : undefined,
  );
  set("sat_math", query.sat_math);
  set("sat_ebrw", query.sat_ebrw);
  set("act", query.act);
  set("admit_min", query.admit_min);
  set("admit_max", query.admit_max);
  set("cost_min", query.cost_min);
  set("cost_max", query.cost_max);
  set("need_met_min", query.need_met_min);
  set("need_met_max", query.need_met_max);
  set("need_fully_met_min", query.need_fully_met_min);
  set("need_fully_met_max", query.need_fully_met_max);
  set("merit_aid_min", query.merit_aid_min);
  set("merit_aid_max", query.merit_aid_max);
  set("grad_four_min", query.grad_four_min);
  set("grad_four_max", query.grad_four_max);
  set("grad_six_min", query.grad_six_min);
  set("grad_six_max", query.grad_six_max);
  set("retention_min", query.retention_min);
  set("retention_max", query.retention_max);
  set("ratio_min", query.ratio_min);
  set("ratio_max", query.ratio_max);
  set("housing_min", query.housing_min);
  set("housing_max", query.housing_max);
  set("international_min", query.international_min);
  set("international_max", query.international_max);
  setList("include_missing", query.include_missing);
  set("sort", query.sort && query.sort !== "name:asc" ? query.sort : undefined);
  set("page", page);
  set("page_size", EXPLORE_PAGE_SIZE);

  return params;
}

export function getExplore(
  query: ExploreQueryInput,
  page: number,
  signal?: AbortSignal,
): Promise<ExploreResponse> {
  return requestJson<ExploreResponse>(
    `/schools/explore?${buildExploreSearchParams(query, page)}`,
    { signal },
  );
}

export function getMajors(q: string): Promise<MajorsResponse> {
  const params = new URLSearchParams({ q });
  return requestJson<MajorsResponse>(`/schools/majors?${params}`);
}

/**
 * Fetches `pages` server pages (1..pages) and concatenates their schools,
 * which is what lets "Load more" (Q18, kept) grow one result list while the
 * URL's `page` param stays the single source of "how many pages are
 * loaded" (plan §5.3: "only `page` joins" the URL codec). Metadata
 * (`total`, `exclusions`, `filter_options`, the four notes, …) is read from
 * the first page only -- it is identical across pages for one filter set.
 */
export function useExplore(query: ExploreQueryInput, pages: number) {
  const owner = useAuthUser();

  return useQuery({
    queryKey: [...schoolsExploreQueryKey, owner?.id ?? null, query, pages],
    queryFn: async ({ signal }): Promise<ExploreResponse> => {
      const responses = await Promise.all(
        Array.from({ length: pages }, (_, index) =>
          getExplore(query, index + 1, signal),
        ),
      );
      const [first] = responses;
      if (!first) {
        throw new Error("Explore returned no pages.");
      }
      return {
        ...first,
        schools: responses.flatMap((response) => response.schools),
      };
    },
    enabled: owner !== null,
    // Keep the grid stable for filter/page changes by one owner only. A
    // previous owner's personalized response is never even a placeholder
    // while the new owner's request is in flight.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === (owner?.id ?? null)
        ? keepPreviousData(previousData)
        : undefined,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}

/** Q19: 30s. `keepPreviousData` so the combobox's list doesn't blank
 * between keystrokes while the next page is in flight. */
export function useMajors(q: string) {
  return useQuery({
    queryKey: ["schools", "majors", q],
    queryFn: () => getMajors(q),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
