import type { Option } from "@/domain/shared";
import type {
  CalendarFilter,
  ControlFilter,
  DataWindow,
  ExploreFilters,
  ExploreSchool,
  GenderFilter,
  GreekFilter,
  NumericRange,
  RangeKey,
  SizeBucket,
  SortKey,
  StudentProfile,
  TestFitPreset,
  TestPolicyFilter,
} from "@/features/schools/explore/explore-types";

/*
 * One source of truth for the Explore filter set. Every filter's label,
 * URL key, control shape, and matching rule is declared here so the filter
 * bar, the panel, the active count, the URL codec, and the coverage
 * disclosure all read the same list instead of four hand-kept copies.
 *
 * Which metrics are allowed to back a filter at all is decided in
 * plans/schools-explore-filters.md — that document owns the four gates and
 * the banned list. This file only encodes what survived them.
 */

/* ---- ranges ---- */

export type RangeDescriptor = {
  key: RangeKey;
  /** Shown on the filter control. */
  label: string;
  /** Shown in the exclusion chip: "38 hidden — no {metricLabel}". */
  metricLabel: string;
  unit: "percent" | "currency" | "ratio";
  /** Null means the school did not publish it. Never 0. */
  read: (school: ExploreSchool, profile: StudentProfile) => number | null;
  /** Only the two Tier-1 ranges take both bounds; the rest take one. */
  bounds: "both" | "min" | "max";
  max?: number;
  step?: number;
};

export const rangeDescriptors: RangeDescriptor[] = [
  {
    key: "admit",
    label: "Admit rate",
    metricLabel: "admit rate",
    unit: "percent",
    bounds: "both",
    max: 100,
    read: (school) => school.admitRate?.value ?? null,
  },
  {
    key: "cost",
    label: "Your cost",
    metricLabel: "published cost",
    unit: "currency",
    bounds: "both",
    max: 100_000,
    step: 1_000,
    read: (school) => school.cost?.amount ?? null,
  },
  {
    key: "needMet",
    label: "Need fully met, at least",
    metricLabel: "need-met figure",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.needMet,
  },
  {
    key: "meritAid",
    label: "Got merit aid, at least",
    metricLabel: "merit-aid figure",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.meritAid,
  },
  {
    key: "gradRate",
    label: "Graduates in 6 years, at least",
    metricLabel: "graduation rate",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.gradSixYear,
  },
  {
    key: "retention",
    label: "First-year retention, at least",
    metricLabel: "retention rate",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.retention,
  },
  {
    key: "ratio",
    label: "Students per faculty, at most",
    metricLabel: "student-faculty ratio",
    unit: "ratio",
    bounds: "max",
    max: 40,
    read: (school) => school.studentsPerFaculty,
  },
  {
    key: "housing",
    label: "Lives on campus, at least",
    metricLabel: "on-campus housing figure",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.housingPercent,
  },
  {
    key: "outOfState",
    label: "From out of state, at least",
    metricLabel: "out-of-state share",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.outOfStatePercent,
  },
  {
    key: "international",
    label: "International students, at least",
    metricLabel: "international share",
    unit: "percent",
    bounds: "min",
    max: 100,
    read: (school) => school.internationalPercent,
  },
];

export const rangeDescriptorByKey: Record<RangeKey, RangeDescriptor> =
  Object.fromEntries(
    rangeDescriptors.map((descriptor) => [descriptor.key, descriptor]),
  ) as Record<RangeKey, RangeDescriptor>;

export const emptyRange: NumericRange = { min: null, max: null };

/* ---- enum options ---- */

export const sizeBucketOptions: (Option<SizeBucket> & {
  min: number;
  max: number | null;
})[] = [
  { value: "lt2k", label: "Under 2,000", min: 0, max: 2_000 },
  { value: "2k-10k", label: "2,000 – 10,000", min: 2_000, max: 10_000 },
  { value: "10k-25k", label: "10,000 – 25,000", min: 10_000, max: 25_000 },
  { value: "gt25k", label: "25,000 and up", min: 25_000, max: null },
];

export const controlOptions: Option<ControlFilter>[] = [
  { value: "any", label: "Any" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];

/** Presets, not a raw slider: a raw SAT range invites filtering on numbers
 *  that describe submitters only (filters spec §2, #6). */
export const testFitOptions: Option<TestFitPreset>[] = [
  { value: "any", label: "Any" },
  { value: "above75", label: "At or above the 75th percentile" },
  { value: "middle50", label: "Inside the middle 50%" },
  { value: "above25", label: "At or above the 25th percentile" },
];

export const testPolicyOptions: Option<TestPolicyFilter>[] = [
  { value: "any", label: "Any" },
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "blind", label: "Blind" },
];

export const greekOptions: Option<GreekFilter>[] = [
  { value: "any", label: "Any" },
  { value: "little", label: "Little or none" },
  { value: "substantial", label: "Substantial" },
];

export const genderOptions: Option<GenderFilter>[] = [
  { value: "any", label: "Any" },
  { value: "coed", label: "Coed" },
  { value: "women", label: "Women's" },
  { value: "men", label: "Men's" },
];

export const calendarOptions: Option<CalendarFilter>[] = [
  { value: "any", label: "Any" },
  { value: "semester", label: "Semester" },
  { value: "quarter", label: "Quarter" },
  { value: "trimester", label: "Trimester" },
];

export const dataWindowOptions: Option<DataWindow>[] = [
  { value: "any", label: "Any" },
  { value: "recent", label: "Within 2 years" },
  { value: "current", label: "Current only" },
];

export const sortOptions: Option<SortKey>[] = [
  { value: "admit", label: "Admit rate" },
  { value: "name", label: "Name" },
  { value: "cost", label: "Your cost" },
  { value: "size", label: "Size" },
  { value: "gradRate", label: "Graduation rate" },
  { value: "deadline", label: "Next deadline" },
];

/** Greek life: "little or no Greek life" is a common ask, and the joiner
 *  percentages are the only thing the data supports saying about it. */
export const LITTLE_GREEK_MAX_PERCENT = 10;

/** The data-quality lens. `recent` keeps the last two editions. */
export const CURRENT_CDS_YEAR = 2025;
export const RECENT_CDS_YEAR_SPAN = 2;

export const defaultProfile: StudentProfile = {
  homeState: null,
  satScore: null,
};

export const defaultFilters: ExploreFilters = {
  query: "",
  states: [],
  sizes: [],
  control: "any",
  testFit: "any",
  testPolicy: "any",
  greek: "any",
  gender: "any",
  calendar: "any",
  noApplicationFee: false,
  offersEarlyDecision: false,
  offersEarlyAction: false,
  excludeRestrictiveEarlyAction: false,
  rollingAdmission: false,
  dataWindow: "any",
  ranges: Object.fromEntries(
    rangeDescriptors.map((descriptor) => [descriptor.key, emptyRange]),
  ) as ExploreFilters["ranges"],
  includeMissing: [],
};

/* ---- Tier-2 panel groups ----
 * Grouped by the question they answer, not by CDS domain. Six groups so the
 * grid is a clean 3x2 — the data-quality lens docks into the panel footer
 * instead of taking a seventh slot, because it is a lens over the whole
 * result set rather than a property of a school.
 */
export type PanelGroupId =
  "money" | "rounds" | "testing" | "outcomes" | "campus" | "body";

export const panelGroups: { id: PanelGroupId; label: string }[] = [
  { id: "money", label: "Money" },
  { id: "rounds", label: "Rounds & deadlines" },
  { id: "testing", label: "Testing" },
  { id: "outcomes", label: "Outcomes" },
  { id: "campus", label: "Campus" },
  { id: "body", label: "Student body" },
];
