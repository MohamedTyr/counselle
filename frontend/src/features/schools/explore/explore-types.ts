import type {
  CampusSettingFamily,
  Control,
  Gender,
  RangeKey,
  ScoreFit,
  SizeBucket,
  SortDirection,
  SortKey,
  TestPolicy,
} from "@/api/schools/explore";

/*
 * The Explore filter/UI types. The read model itself -- one school's ~60
 * metric columns -- is `ExploreFields` in `@/api/schools/explore` (the wire
 * contract); this file holds only what the client adds on top: filter
 * state and URL-local Explore assumptions. Saved Profile data and the fit
 * verdict are server-owned wire values in `@/api/schools/explore`.
 *
 * Every metric field on the wire is nullable, and null is a first-class
 * render path rather than an error path (SchoolResultCard's "not
 * available" treatment). Never default one of these to 0 anywhere.
 */

export type {
  CampusSettingFamily,
  Control,
  Gender,
  RangeKey,
  ScoreFit,
  SizeBucket,
  SortDirection,
  SortKey,
  TestPolicy,
};

export type NumericRange = { min: number | null; max: number | null };

/*
 * The Explore preview strip. Load-bearing: it picks which tuition row and
 * which score band every card shows, so it lives in the results header at
 * the point of consequence rather than in settings. `scoreFit` (in
 * ExploreFilters, not here) is the only thing that FILTERS -- these three
 * scores only pick what a card displays until the student opts in.
 */
export type ExploreAssumptions = {
  homeState: string | null;
  satMath: number | null;
  satEbrw: number | null;
  act: number | null;
};

/* ---- filters ---- */

/**
 * Every range filter is keyed here. The key does three jobs: it is the URL
 * param, the exclusion-disclosure label lookup, and the `include` opt-out
 * token -- which is what keeps coverage disclosure from drifting out of
 * sync with the filters that cause it.
 */
export type ExploreFilters = {
  query: string;
  states: string[];
  region: string[];
  sizeBucket: SizeBucket[];
  control: Control | "any";
  testPolicy: TestPolicy | "any";
  campusSetting: CampusSettingFamily[];
  /** A specific affiliation name, or the two frontend-authored sentinels
   *  (plan §5.3): "any_affiliated" | "none_on_file". */
  religiousAffiliation: string | null;
  gender: Gender | "any";
  hbcu: boolean;
  hsi: boolean;
  tribal: boolean;
  landGrant: boolean;
  entranceDifficulty: string | null;
  calendar: string | null;
  major: string | null;
  noApplicationFee: boolean;
  offersEarlyDecision: boolean;
  offersEarlyAction: boolean;
  rollingAdmission: boolean;
  includeRolling: boolean;
  /** ISO `yyyy-mm-dd`, or null. */
  deadlineBefore: string | null;
  scoreFit: ScoreFit;
  ranges: Record<RangeKey, NumericRange>;
  /** Range keys the user has chosen to keep missing-metric schools in. */
  includeMissing: RangeKey[];
};
