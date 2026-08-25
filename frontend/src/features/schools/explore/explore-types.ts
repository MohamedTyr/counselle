import type { ListType } from "@/domain/school";

/*
 * The Explore read model.
 *
 * Every metric field is nullable, and null is a first-class render path
 * rather than an error path — see SchoolResultCard's `not published`
 * treatment. Do not default any of these to 0 anywhere: a blank cell reads
 * as zero, and zero is a lie (AGENTS.md principle 3).
 *
 * Shaped as the eventual query result so swapping fixtures for a real read
 * is a one-line change in ExplorePanel.
 */

export type Control = "public" | "private";

export type AdmitRateBasis = "overall" | "in-state" | "out-of-state";

export type TestPolicy = "required" | "optional" | "blind";

export type GenderModel = "coed" | "women" | "men";

export type AcademicCalendar = "semester" | "quarter" | "trimester";

export type RoundOffer = {
  /** ED / ED2 / REA / EA / RD / Rolling — matches domain/school's Round. */
  code: string;
  deadline: string | null;
  /** REA/SCEA constrain the whole round plan, so they're marked. */
  restrictive?: boolean;
};

export type ExploreSchool = {
  unitid: string;
  name: string;
  city: string;
  state: string;
  websiteUrl: string | null;
  control: Control;
  undergraduates: number | null;
  admitRate: { value: number; basis: AdmitRateBasis } | null;
  testBand: {
    p25: number;
    p75: number;
    /** Trap 1: below 50% the band describes the top third of the class. */
    submittedPercent: number | null;
  } | null;
  cost: { amount: number; basis: string } | null;
  /** Derived h2_h / h2_c, never the printed h2_i (trap 3). */
  needMet: number | null;
  meritAid: number | null;
  gradFourYear: number | null;
  gradSixYear: number | null;
  retention: number | null;
  applicationFee: number | null;
  testPolicy: TestPolicy | null;
  studentsPerFaculty: number | null;
  housingPercent: number | null;
  greekPercent: number | null;
  /** Trap 9: excludes international from both sides — not additive. */
  outOfStatePercent: number | null;
  internationalPercent: number | null;
  genderModel: GenderModel | null;
  calendar: AcademicCalendar | null;
  rounds: RoundOffer[];
  /** The CDS edition this row was read from, for the data-quality lens. */
  cdsYear: number | null;
  onList: boolean;
};

/*
 * The personalization strip. Load-bearing: it picks which tuition row and
 * which admit rate every card shows, so it lives in the results header at
 * the point of consequence rather than in settings.
 */
export type StudentProfile = {
  homeState: string | null;
  satScore: number | null;
};

/* ---- the verdict ---- */

/**
 * "Unknown" is a fourth state, not a fourth tier: it means no admit rate was
 * published, so we decline to classify. It is never rendered as a guess.
 */
export type FitCategory = ListType | "Unknown";

export type FitVerdict = {
  category: FitCategory;
  /** One sentence naming the evidence the category rests on. */
  reason: string;
  /**
   * True only when the student's own score was compared against a test band
   * we trust (>=50% submitted). Never a probability — see METRICS-KEEP.md:
   * the chancing consumer classifies risk, it never emits a fake number.
   */
  usedScore: boolean;
};

/* ---- filters ---- */

export type SizeBucket = "lt2k" | "2k-10k" | "10k-25k" | "gt25k";

export type ControlFilter = "any" | Control;

export type TestFitPreset = "any" | "middle50" | "above25" | "above75";

export type TestPolicyFilter = "any" | TestPolicy;

export type GreekFilter = "any" | "little" | "substantial";

export type GenderFilter = "any" | GenderModel;

export type CalendarFilter = "any" | AcademicCalendar;

/** The data-quality lens — a property of our data, not of a school. */
export type DataWindow = "any" | "recent" | "current";

export type NumericRange = { min: number | null; max: number | null };

/**
 * Every range filter is keyed here. The key does three jobs: it is the URL
 * param, the exclusion-disclosure label lookup, and the `include` opt-out
 * token — which is what keeps coverage disclosure from drifting out of sync
 * with the filters that cause it.
 */
export type RangeKey =
  | "admit"
  | "cost"
  | "needMet"
  | "meritAid"
  | "gradRate"
  | "retention"
  | "ratio"
  | "housing"
  | "outOfState"
  | "international";

export type ExploreFilters = {
  query: string;
  states: string[];
  sizes: SizeBucket[];
  control: ControlFilter;
  testFit: TestFitPreset;
  testPolicy: TestPolicyFilter;
  greek: GreekFilter;
  gender: GenderFilter;
  calendar: CalendarFilter;
  noApplicationFee: boolean;
  offersEarlyDecision: boolean;
  offersEarlyAction: boolean;
  excludeRestrictiveEarlyAction: boolean;
  rollingAdmission: boolean;
  dataWindow: DataWindow;
  ranges: Record<RangeKey, NumericRange>;
  /** Range keys the user has chosen to keep missing-metric schools in. */
  includeMissing: RangeKey[];
};

export type SortKey =
  "admit" | "name" | "cost" | "size" | "gradRate" | "deadline";

/** One entry per range filter that hid rows purely for missing data. */
export type Exclusion = {
  key: RangeKey;
  metricLabel: string;
  count: number;
};

export type ExploreResult = {
  schools: ExploreSchool[];
  exclusions: Exclusion[];
  /** Facet counts for the enum filters. Enums only, never ranges. */
  controlCounts: Record<Control, number>;
  /** The filter that removed the most rows — names the culprit on empty,
   *  and carries the key needed to relax exactly that one filter. */
  narrowest: NarrowestFilter | null;
};

export type NarrowestFilter = {
  key: RangeKey | "states" | "sizes";
  label: string;
  remainingWithoutIt: number;
};
