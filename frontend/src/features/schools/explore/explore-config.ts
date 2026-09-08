import type { Option } from "@/domain/shared";
import type {
  Control,
  Gender,
  NumericRange,
  RangeKey,
  ScoreFit,
  SizeBucket,
  SortKey,
  StudentProfile,
  TestPolicy,
} from "@/features/schools/explore/explore-types";
import type { ExploreFilters } from "@/features/schools/explore/explore-types";

/*
 * One source of truth for the Explore filter set's static shape: labels,
 * bounds, and the closed-enum option lists. The metrics themselves --
 * which values a range or facet actually holds -- are computed server-side
 * (`app/facts/service_explore.py`), including `SIZE_BUCKETS`'s boundaries:
 * this file keeps only `value`/`label` for the size filter, never the
 * min/max the backend owns (the single-owner rule, plan §5.3).
 */

/* ---- ranges ---- */

export type RangeDescriptor = {
  key: RangeKey;
  /** Shown on the filter control and the sort menu. The exclusion chip's
   *  own noun phrase (`metric_label`) rides the wire instead -- see
   *  `Exclusion.metric_label` -- so it is never duplicated here. */
  label: string;
  /** A muted one-line disclosure under the control, for the two metrics
   *  that are Counselle's own calculation rather than a printed figure. */
  description?: string;
  unit: "percent" | "currency" | "ratio";
  /** Only the two Tier-1 ranges take both bounds; the rest take one. */
  bounds: "both" | "min" | "max";
  max?: number;
  step?: number;
};

export const rangeDescriptors: RangeDescriptor[] = [
  { key: "admit", label: "Admit rate", unit: "percent", bounds: "both", max: 100 },
  {
    key: "cost",
    label: "Your cost",
    unit: "currency",
    bounds: "both",
    max: 100_000,
    step: 1_000,
  },
  {
    key: "needMet",
    label: "Average share of need met, at least",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
  {
    key: "needFullyMet",
    label: "Students whose need was fully met, at least",
    description: "Counselle's calculation from the school's own counts.",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
  { key: "meritAid", label: "Got merit aid, at least", unit: "percent", bounds: "min", max: 100 },
  {
    key: "gradFour",
    label: "Graduates in 4 years, at least",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
  {
    key: "gradSix",
    label: "Graduates in 6 years, at least",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
  {
    key: "retention",
    label: "First-year retention, at least",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
  {
    key: "ratio",
    label: "Undergraduates per full-time faculty member, at most",
    description: "Counselle's own calculation, not the ratio the school publishes.",
    unit: "ratio",
    bounds: "max",
    max: 40,
  },
  { key: "housing", label: "Lives on campus, at least", unit: "percent", bounds: "min", max: 100 },
  {
    key: "international",
    label: "International students, at least",
    unit: "percent",
    bounds: "min",
    max: 100,
  },
];

export const rangeDescriptorByKey: Record<RangeKey, RangeDescriptor> = Object.fromEntries(
  rangeDescriptors.map((descriptor) => [descriptor.key, descriptor]),
) as Record<RangeKey, RangeDescriptor>;

export const emptyRange: NumericRange = { min: null, max: null };

/* ---- enum options ----
 *
 * `sizeBucket`, `control`, `testPolicy` and `gender` are closed CHECK-set
 * enums (plan §5.3) -- their members are code, not data, so they keep a
 * frontend option list rather than riding `filter_options`.
 */

export const sizeBucketOptions: Option<SizeBucket>[] = [
  { value: "lt2k", label: "Under 2,000" },
  { value: "2k-10k", label: "2,000 – 10,000" },
  { value: "10k-25k", label: "10,000 – 25,000" },
  { value: "gt25k", label: "25,000 and up" },
];

export const controlOptions: Option<Control | "any">[] = [
  { value: "any", label: "Any" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private (nonprofit)" },
  { value: "private_for_profit", label: "Private (for-profit)" },
];

export const testPolicyOptions: Option<TestPolicy | "any">[] = [
  { value: "any", label: "Any" },
  { value: "required", label: "Required" },
  { value: "considered", label: "Considered but not required" },
  { value: "not_required", label: "Not required" },
  { value: "not_reported", label: "No policy on file" },
];

export const genderOptions: Option<Gender | "any">[] = [
  { value: "any", label: "Any" },
  { value: "coed", label: "Coed" },
  { value: "women", label: "Women's" },
  { value: "men", label: "Men's" },
];

export const scoreFitOptions: Option<ScoreFit>[] = [
  { value: "any", label: "Any" },
  { value: "at_or_above_p75", label: "At or above the 75th percentile" },
  { value: "inside_band", label: "Inside the band" },
  { value: "at_or_above_p25", label: "At or above the 25th percentile" },
];

/**
 * `entrance_difficulty` and `calendar` hold no DB CHECK in the shipped
 * schema (unlike the four enums above) -- both are slugified verbatim from
 * whatever CollegeData prints, so nothing here structurally guarantees the
 * crawl can never emit a new one. Live-verified against the running crawl
 * (2026-09-08, 910/2,587 schools): every row so far is one of these five /
 * six values. A value outside this list simply fails to match any option
 * -- it is never coerced into a neighbour -- so a future new slug shows up
 * as "the filter matched nothing" rather than a wrong answer. See this
 * unit's final report: `filter_options` should grow these two server-side,
 * the same way it already derives region/campus_setting/religious_affiliation.
 */
export const entranceDifficultyOptions: Option<string>[] = [
  { value: "most_difficult", label: "Most difficult" },
  { value: "very_difficult", label: "Very difficult" },
  { value: "moderately_difficult", label: "Moderately difficult" },
  { value: "minimally_difficult", label: "Minimally difficult" },
  { value: "noncompetitive", label: "Noncompetitive" },
];

export const calendarOptions: Option<string>[] = [
  { value: "semester", label: "Semester" },
  { value: "quarter", label: "Quarter" },
  { value: "trimester", label: "Trimester" },
  { value: "4_1_4", label: "4-1-4" },
  { value: "continuous", label: "Continuous" },
  { value: "other", label: "Other" },
];

export const sortOptions: Option<SortKey>[] = [
  { value: "name", label: "Name" },
  { value: "admit", label: "Admit rate" },
  { value: "cost", label: "Your cost" },
  { value: "undergraduates", label: "Size" },
  { value: "needMet", label: "Share of need met" },
  { value: "gradFour", label: "4-year graduation rate" },
  { value: "gradSix", label: "6-year graduation rate" },
  { value: "retention", label: "Retention rate" },
  { value: "deadline", label: "Next deadline" },
];

/**
 * `school_explore.state` has no `filter_options` entry on the wire (only
 * region/campus_setting/religious_affiliation are server-derived, plan
 * §5.3) -- this is a plain 51-jurisdiction list rather than data this unit
 * can query. Every entry is a real IPEDS jurisdiction, so the gap is never
 * an option matching zero schools, only a possible option for a state the
 * crawl has not reached yet on the current filter set (the same shape as
 * `exclusions`, already disclosed there). See this unit's final report.
 */
export const US_STATES: string[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY", "PR", "VI", "GU", "AS", "MP",
];

export const defaultProfile: StudentProfile = {
  act: null,
  homeState: null,
  satEbrw: null,
  satMath: null,
};

export const defaultFilters: ExploreFilters = {
  calendar: null,
  campusSetting: [],
  control: "any",
  deadlineBefore: null,
  entranceDifficulty: null,
  gender: "any",
  hbcu: false,
  hsi: false,
  includeMissing: [],
  includeRolling: false,
  landGrant: false,
  major: null,
  noApplicationFee: false,
  offersEarlyAction: false,
  offersEarlyDecision: false,
  query: "",
  ranges: Object.fromEntries(
    rangeDescriptors.map((descriptor) => [descriptor.key, emptyRange]),
  ) as ExploreFilters["ranges"],
  region: [],
  religiousAffiliation: null,
  rollingAdmission: false,
  scoreFit: "any",
  sizeBucket: [],
  states: [],
  testPolicy: "any",
  tribal: false,
};

export const defaultSortKey: SortKey = "name";

/* ---- Tier-2 panel groups ----
 * Grouped by the question they answer, not by CDS domain. Six groups so
 * the grid is a clean 3x2 -- the data-quality lens from the CDS-era plan
 * is retired (`dataWindow` had no v3 backing field), so the footer is now
 * just the active-count / clear-all / done row.
 */
export type PanelGroupId = "money" | "rounds" | "testing" | "outcomes" | "campus" | "body";

export const panelGroups: { id: PanelGroupId; label: string }[] = [
  { id: "money", label: "Money" },
  { id: "rounds", label: "Rounds & deadlines" },
  { id: "testing", label: "Testing" },
  { id: "outcomes", label: "Outcomes" },
  { id: "campus", label: "Campus" },
  { id: "body", label: "Student body" },
];
