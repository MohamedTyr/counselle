import type { Profile } from "@/api/workspace/types";
import type {
  DistributionBucket,
  DistributionValue,
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

import {
  CHANCES_FACT_KEYS,
  type ChancesFactKey,
  hasAcceptedDistributionScale,
} from "./school-chances-contract";

export type ChancesMetric = "gpa" | "sat" | "act";
export type SchoolValueState =
  | "school_value"
  | "distribution_unscaled"
  | "not_reported"
  | "not_fetched"
  | "not_published"
  | "not_collected"
  | "malformed";
export type SchoolValueModel = {
  state: SchoolValueState;
  /** Server-owned wording for an absent endpoint; never locally re-authored. */
  display: string | null;
  reportedPeriod: string | null;
};
/**
 * The field-level distribution verdict. `school` remains an aggregate
 * availability summary because a band or average may independently be usable.
 */
export type DistributionStateModel = {
  state: SchoolValueState;
  usable: boolean;
  /** Server-owned wording for an unavailable or unscaled distribution. */
  display: string | null;
  reportedPeriod: string | null;
};
/** The middle-50% verdict, independent from any usable distribution. */
export type BandStateModel = {
  state: SchoolValueState;
  usable: boolean;
  /** Exact fact wording, including the server's absence grammar. */
  display: string | null;
  reportedPeriod: string | null;
};
export type ProfileValueState =
  "value" | "missing_profile_value" | "incompatible_profile_value";
export type GpaComparisonState =
  | "in_bucket"
  | "below_reported_buckets"
  | "above_reported_buckets"
  | "unplaceable_profile_value";
export type BandComparisonState = "below_band" | "within_band" | "above_band";

type Range = { lo: number; hi: number; upperInclusive: boolean };
type DistributionResult = {
  state: SchoolValueState;
  model: DistributionModel | null;
  geometricallyValid: boolean;
  display: string | null;
  reportedPeriod: string | null;
};
type BandResult = {
  model: BandModel | null;
  malformed: boolean;
  state: SchoolValueState;
  display: string | null;
  reportedPeriod: string | null;
};

export type ChanceBucket = {
  label: string;
  pct: number | null;
  absence: DistributionBucket["absence"] | null;
  absenceDisplay: string | null;
  range: Range | null;
};

export type DistributionModel = {
  buckets: ChanceBucket[];
  omittedBuckets: { label: string; display: string }[];
  sumsTo: number | null;
  reportedPeriod: string | null;
};

export type BandModel = {
  p25: number;
  p75: number;
  min: number;
  max: number;
  reportedPeriod: string | null;
};

export type ScalarModel = {
  value: number | string;
  display: string;
  reportedPeriod: string | null;
} | null;

/** A reported GPA average is school-only text: its scale is not contracted. */
export type GpaAverageModel = {
  display: string;
  reportedPeriod: string | null;
} | null;

export type GpaProfileModel = {
  state: ProfileValueState;
  display: string | null;
  value: number | null;
  comparison: { state: GpaComparisonState; label: string | null } | null;
};

export type ScoreProfileModel = {
  state: ProfileValueState;
  display: number | null;
  value: number | null;
  comparison: { state: BandComparisonState } | null;
};

/**
 * Session-local explorer inputs. The caller owns step-grid validation; this
 * pure model only preserves a valid entered value and derives its position.
 */
export type ChancesScenarioInput = {
  gpa?: number | null;
  sat?: { math?: number | null; ebrw?: number | null } | null;
  act?: { composite?: number | null } | null;
};

export type GpaScenarioModel = {
  value: number;
  comparison: { state: GpaComparisonState; label: string | null } | null;
} | null;

export type ScoreScenarioModel = {
  value: number;
  comparison: { state: BandComparisonState } | null;
} | null;

export type ScoreLaneModel = {
  key: "math" | "ebrw" | "composite";
  school: SchoolValueModel;
  distribution: DistributionModel | null;
  distributionState: DistributionStateModel;
  band: BandModel | null;
  bandState: BandStateModel;
  average: ScalarModel;
  profile: ScoreProfileModel;
  scenario: ScoreScenarioModel;
};

export type GpaModel = {
  distribution: DistributionModel | null;
  distributionState: DistributionStateModel;
  /** Which field supplies the aggregate school value, if one does. */
  schoolSource: "distribution" | "average_fallback" | null;
  average: GpaAverageModel;
  profile: GpaProfileModel;
  scenario: GpaScenarioModel;
};

export type SchoolChancesModel = {
  metric: ChancesMetric;
  freshnessLine: string | null;
  testPolicy: ScalarModel;
  school: SchoolValueModel;
  gpa: GpaModel | null;
  sat: {
    totalContext: { value: number; display: number } | null;
    lanes: ScoreLaneModel[];
  } | null;
  act: ScoreLaneModel | null;
};

export type CollectedChancesFacts = {
  facts: Record<ChancesFactKey, Fact | null>;
  duplicateKeys: ChancesFactKey[];
};

const INITIAL_FACTS = (): Record<ChancesFactKey, Fact | null> =>
  Object.fromEntries(CHANCES_FACT_KEYS.map((key) => [key, null])) as Record<
    ChancesFactKey,
    Fact | null
  >;

const SCORE_DOMAINS = {
  math: { min: 200, max: 800 },
  ebrw: { min: 200, max: 800 },
  composite: { min: 1, max: 36 },
} as const;

/** Extract only the frozen contract's facts. Duplicate keys are unsafe facts. */
export function collectChancesFacts(
  response: SchoolFactsResponse,
): CollectedChancesFacts {
  const facts = INITIAL_FACTS();
  const duplicates = new Set<ChancesFactKey>();

  for (const section of response.sections) {
    for (const group of section.groups) {
      for (const fact of group.facts) {
        if (!(CHANCES_FACT_KEYS as readonly string[]).includes(fact.key))
          continue;
        const key = fact.key as ChancesFactKey;
        if (facts[key] !== null || duplicates.has(key)) {
          facts[key] = null;
          duplicates.add(key);
        } else {
          facts[key] = fact;
        }
      }
    }
  }

  return { facts, duplicateKeys: [...duplicates].sort() };
}

/** Purely derives literal school/profile comparison data. */
export function buildSchoolChancesModel(
  response: SchoolFactsResponse,
  profile: Profile | null | undefined,
  metric: ChancesMetric,
  scenario: ChancesScenarioInput = {},
): SchoolChancesModel {
  const collected = collectChancesFacts(response);
  const facts = collected.facts;
  const duplicate = (key: ChancesFactKey) =>
    collected.duplicateKeys.includes(key);
  const testPolicy = scalar(facts["admissions.test_policy_sat_or_act"]);

  if (metric === "gpa") {
    const distributionFact = facts["class_profile.gpa_distribution"];
    const distributionResult = distribution(
      distributionFact,
      "gpa",
      "class_profile.gpa_distribution",
      duplicate("class_profile.gpa_distribution"),
    );
    const average = gpaAverage(facts["class_profile.average_gpa"]);
    const school = gpaSchoolState(
      distributionResult,
      average,
      duplicate("class_profile.average_gpa"),
    );
    const gpa = {
      distribution: distributionResult.model,
      distributionState: distributionState(distributionResult),
      schoolSource: gpaSchoolSource(
        distributionResult,
        average,
        duplicate("class_profile.average_gpa"),
      ),
      average,
      profile: gpaProfile(profile, distributionResult, school.state),
      scenario: gpaScenario(scenario.gpa, distributionResult, school.state),
    };
    return {
      metric,
      freshnessLine: response.freshness_line,
      testPolicy,
      school,
      gpa,
      sat: null,
      act: null,
    };
  }

  if (metric === "sat") {
    const math = scoreLane(
      "math",
      facts["class_profile.sat_math"],
      facts["class_profile.sat_math_avg"],
      facts["class_profile.sat_math_distribution"],
      profile?.testing?.sat?.math,
      scenario.sat?.math,
      duplicate("class_profile.sat_math") ||
        duplicate("class_profile.sat_math_avg") ||
        duplicate("class_profile.sat_math_distribution"),
    );
    const ebrw = scoreLane(
      "ebrw",
      facts["class_profile.sat_ebrw"],
      facts["class_profile.sat_ebrw_avg"],
      facts["class_profile.sat_ebrw_distribution"],
      profile?.testing?.sat?.ebrw,
      scenario.sat?.ebrw,
      duplicate("class_profile.sat_ebrw") ||
        duplicate("class_profile.sat_ebrw_avg") ||
        duplicate("class_profile.sat_ebrw_distribution"),
    );
    return {
      metric,
      freshnessLine: response.freshness_line,
      testPolicy,
      school: {
        state: combineSchoolStates([math.school.state, ebrw.school.state]),
        display: null,
        reportedPeriod: null,
      },
      gpa: null,
      sat: {
        /* SAT totals are profile context only. No school-side total is derived. */
        totalContext: validScore(profile?.testing?.sat?.total, 400, 1600)
          ? {
              value: profile!.testing!.sat!.total!,
              display: profile!.testing!.sat!.total!,
            }
          : null,
        lanes: [math, ebrw],
      },
      act: null,
    };
  }

  const act = scoreLane(
    "composite",
    facts["class_profile.act_composite"],
    facts["class_profile.act_composite_avg"],
    facts["class_profile.act_composite_distribution"],
    profile?.testing?.act?.composite,
    scenario.act?.composite,
    duplicate("class_profile.act_composite") ||
      duplicate("class_profile.act_composite_avg") ||
      duplicate("class_profile.act_composite_distribution"),
  );
  return {
    metric,
    freshnessLine: response.freshness_line,
    testPolicy,
    school: act.school,
    gpa: null,
    sat: null,
    act,
  };
}

function scoreLane(
  key: ScoreLaneModel["key"],
  bandFact: Fact | null,
  averageFact: Fact | null,
  distributionFact: Fact | null,
  profileValue: number | null | undefined,
  scenarioValue: number | null | undefined,
  duplicate: boolean,
): ScoreLaneModel {
  const domain = SCORE_DOMAINS[key];
  const distributionKey = {
    math: "class_profile.sat_math_distribution",
    ebrw: "class_profile.sat_ebrw_distribution",
    composite: "class_profile.act_composite_distribution",
  }[key] as Extract<ChancesFactKey, `${string}_distribution`>;
  const distributionResult = distribution(
    distributionFact,
    key,
    distributionKey,
    duplicate,
  );
  const bandResult = band(bandFact, domain);
  const school = scoreSchoolState(distributionResult, bandResult, duplicate);
  const profile = scoreProfile(profileValue, domain, bandResult.model);
  return {
    key,
    school,
    distribution: distributionResult.model,
    distributionState: distributionState(distributionResult),
    band: bandResult.model,
    bandState: bandState(bandResult),
    average: scoreAverage(averageFact, domain),
    profile,
    scenario: scoreScenario(scenarioValue, domain, bandResult.model),
  };
}

function distribution(
  fact: Fact | null,
  kind: "gpa" | ScoreLaneModel["key"],
  expectedKey: Extract<ChancesFactKey, `${string}_distribution`>,
  duplicate: boolean,
): DistributionResult {
  if (duplicate) return distributionResult("malformed");
  if (fact === null) return distributionResult("not_reported");
  if (fact.state !== "value") return distributionResult(fact.state, null, fact);
  if (fact.kind !== "distribution" || !isDistributionValue(fact.value)) {
    return distributionResult("malformed", null, fact);
  }

  const value = fact.value;
  const baseValid =
    fact.key === expectedKey &&
    fact.unit === "percent" &&
    hasAcceptedDistributionScale(fact) &&
    value.buckets.some((bucket) => finite(bucket.pct)) &&
    value.buckets.every(
      (bucket) =>
        bucket.pct === undefined ||
        (finite(bucket.pct) && bucket.pct >= 0 && bucket.pct <= 100),
    ) &&
    (value.sums_to === null ||
      (finite(value.sums_to) && value.sums_to >= 0 && value.sums_to <= 100.5));
  const parser =
    kind === "gpa"
      ? parseGpaRange
      : (bucket: DistributionBucket) =>
          parseScoreRange(bucket, SCORE_DOMAINS[kind], kind === "composite");
  const parsed = value.buckets.map(parser);
  const buckets = value.buckets.map((bucket, index) =>
    bucketModel(bucket, parsed[index] ?? null),
  );
  const model: DistributionModel = {
    buckets:
      kind === "gpa" ? orderedBuckets(buckets) : buckets.map(cloneBucket),
    omittedBuckets: value.omitted_buckets.map((bucket) => ({ ...bucket })),
    sumsTo: value.sums_to,
    reportedPeriod: fact.reported_period,
  };
  if (value.buckets.every((bucket) => bucket.pct === undefined)) {
    return distributionResult("not_reported", model, fact);
  }
  if (!baseValid)
    return distributionResult("distribution_unscaled", model, fact);
  if (kind === "gpa") {
    /* An unknown categorical label remains a usable printed bar. It only
     * withholds placement; it must not erase the school's reported data. */
    if (value.buckets.some(isMalformedGpaBucket))
      return distributionResult("malformed", model, fact);
    return rangesDoNotOverlap(
      parsed.filter((range): range is Range => range !== null),
    )
      ? {
          ...distributionResult("school_value", model, fact),
          geometricallyValid: true,
        }
      : distributionResult("malformed", model, fact);
  }
  const plotted = value.buckets.filter((bucket) => finite(bucket.pct));
  const plottedRanges = plotted.map(parser);
  return plottedRanges.every((range) => range !== null) &&
    rangesDoNotOverlap(plottedRanges)
    ? {
        ...distributionResult("school_value", model, fact),
        geometricallyValid: true,
      }
    : distributionResult("distribution_unscaled", model, fact);
}

function gpaSchoolState(
  result: ReturnType<typeof distribution>,
  average: GpaAverageModel,
  duplicateAverage: boolean,
): SchoolValueModel {
  if (result.state === "school_value")
    return schoolValue("school_value", result);
  if (average !== null && !duplicateAverage)
    return {
      state: "school_value",
      display: average.display,
      reportedPeriod: average.reportedPeriod,
    };
  return schoolValue(duplicateAverage ? "malformed" : result.state, result);
}

function gpaSchoolSource(
  result: ReturnType<typeof distribution>,
  average: GpaAverageModel,
  duplicateAverage: boolean,
): GpaModel["schoolSource"] {
  if (result.state === "school_value") return "distribution";
  return average !== null && !duplicateAverage ? "average_fallback" : null;
}

function scoreSchoolState(
  distributionResult: ReturnType<typeof distribution>,
  bandResult: ReturnType<typeof band>,
  duplicate: boolean,
): SchoolValueModel {
  if (duplicate) return schoolValue("malformed", distributionResult);
  if (distributionResult.state === "school_value")
    return schoolValue("school_value", distributionResult);
  if (bandResult.model !== null) return schoolValue("school_value", bandResult);
  if (distributionResult.state === "distribution_unscaled")
    return schoolValue("distribution_unscaled", distributionResult);
  if (bandResult.malformed) return schoolValue("malformed", bandResult);
  return distributionResult.state === "not_reported"
    ? schoolValue(bandResult.state, bandResult)
    : schoolValue(distributionResult.state, distributionResult);
}

function gpaProfile(
  profile: Profile | null | undefined,
  result: ReturnType<typeof distribution>,
  schoolState: SchoolValueState,
): GpaProfileModel {
  const display = profile?.academics?.gpa_unweighted;
  const scale = profile?.academics?.gpa_scale;
  if (typeof display !== "string" || display.length === 0) {
    return {
      state: "missing_profile_value",
      display: null,
      value: null,
      comparison: null,
    };
  }
  const value = decimal(display);
  const numericScale = decimal(scale);
  if (
    value === null ||
    numericScale === null ||
    numericScale <= 0 ||
    value < 0 ||
    value > numericScale ||
    numericScale !== 4
  ) {
    return {
      state: "incompatible_profile_value",
      display,
      value: null,
      comparison: null,
    };
  }
  return {
    state: "value",
    display,
    value,
    comparison: gpaComparison(value, result, schoolState),
  };
}

function gpaScenario(
  input: number | null | undefined,
  result: ReturnType<typeof distribution>,
  schoolState: SchoolValueState,
): GpaScenarioModel {
  if (!validFiniteValue(input, 0, 4)) return null;
  return {
    value: input,
    comparison: gpaComparison(input, result, schoolState),
  };
}

function gpaComparison(
  value: number,
  result: ReturnType<typeof distribution>,
  schoolState: SchoolValueState,
): GpaProfileModel["comparison"] {
  if (
    result.model === null ||
    !result.geometricallyValid ||
    schoolState !== "school_value"
  ) {
    return null;
  }
  const valid = result.model.buckets.filter((bucket) => bucket.range !== null);
  /* An unparseable source label has no trustworthy boundary. Even if another
   * bucket appears to match, the value could belong to that unknown label. */
  if (valid.length !== result.model.buckets.length)
    return { state: "unplaceable_profile_value", label: null };
  const matching = [...valid]
    .sort((a, b) => b.range!.lo - a.range!.lo)
    .find((bucket) => contains(bucket.range!, value));
  if (matching) {
    return { state: "in_bucket", label: matching.label };
  }
  const lo = Math.min(...valid.map((bucket) => bucket.range!.lo));
  const hi = Math.max(...valid.map((bucket) => bucket.range!.hi));
  return {
    state:
      value < lo
        ? "below_reported_buckets"
        : value > hi
          ? "above_reported_buckets"
          : "unplaceable_profile_value",
    label: null,
  };
}

function scoreProfile(
  input: number | null | undefined,
  domain: { min: number; max: number },
  bandModel: BandModel | null,
): ScoreProfileModel {
  if (input === null || input === undefined) {
    return {
      state: "missing_profile_value",
      display: null,
      value: null,
      comparison: null,
    };
  }
  if (!validScore(input, domain.min, domain.max)) {
    return {
      state: "incompatible_profile_value",
      display: input,
      value: null,
      comparison: null,
    };
  }
  return {
    state: "value",
    display: input,
    value: input,
    comparison: bandComparison(input, bandModel),
  };
}

function scoreScenario(
  input: number | null | undefined,
  domain: { min: number; max: number },
  bandModel: BandModel | null,
): ScoreScenarioModel {
  if (!validFiniteValue(input, domain.min, domain.max)) return null;
  return {
    value: input,
    comparison: bandComparison(input, bandModel),
  };
}

function bandComparison(
  value: number,
  bandModel: BandModel | null,
): ScoreProfileModel["comparison"] {
  if (bandModel === null) return null;
  return {
    state:
      value < bandModel.p25
        ? "below_band"
        : value > bandModel.p75
          ? "above_band"
          : "within_band",
  };
}

function band(
  fact: Fact | null,
  domain: { min: number; max: number },
): BandResult {
  if (
    fact === null ||
    fact.state !== "value" ||
    fact.kind !== "band" ||
    !isBandValue(fact.value)
  ) {
    return {
      model: null,
      malformed: fact !== null && fact.state === "value",
      state:
        fact === null
          ? "not_reported"
          : fact.state === "value"
            ? "malformed"
            : fact.state,
      display: fact?.display ?? null,
      reportedPeriod: fact?.reported_period ?? null,
    };
  }
  const { p25, p75, min, max } = fact.value;
  if (
    !finite(p25) ||
    !finite(p75) ||
    !finite(min) ||
    !finite(max) ||
    min !== domain.min ||
    max !== domain.max ||
    p25 < min ||
    p25 > p75 ||
    p75 > max
  ) {
    return {
      model: null,
      malformed: true,
      state: "malformed",
      display: fact.display,
      reportedPeriod: fact.reported_period,
    };
  }
  return {
    model: { p25, p75, min, max, reportedPeriod: fact.reported_period },
    malformed: false,
    state: "school_value",
    display: fact.display,
    reportedPeriod: fact.reported_period,
  };
}

function bandState(result: BandResult): BandStateModel {
  return {
    state: result.state,
    usable: result.model !== null,
    display: result.display,
    reportedPeriod: result.reportedPeriod,
  };
}

function scalar(fact: Fact | null): ScalarModel {
  if (fact === null || fact.state !== "value" || fact.kind !== "scalar")
    return null;
  if (typeof fact.value !== "number" && typeof fact.value !== "string")
    return null;
  return {
    value: fact.value,
    display: fact.display,
    reportedPeriod: fact.reported_period,
  };
}

function gpaAverage(fact: Fact | null): GpaAverageModel {
  if (
    fact === null ||
    fact.state !== "value" ||
    fact.kind !== "scalar" ||
    !finite(fact.value) ||
    fact.value < 0
  ) {
    return null;
  }
  return {
    display: fact.display,
    reportedPeriod: fact.reported_period,
  };
}

function scoreAverage(
  fact: Fact | null,
  domain: { min: number; max: number },
): ScalarModel {
  return scalarWithinDomain(fact, domain.min, domain.max);
}

function scalarWithinDomain(
  fact: Fact | null,
  min: number,
  max: number,
): ScalarModel {
  if (
    fact === null ||
    fact.state !== "value" ||
    fact.kind !== "scalar" ||
    !validFiniteValue(fact.value, min, max)
  ) {
    return null;
  }
  return {
    value: fact.value,
    display: fact.display,
    reportedPeriod: fact.reported_period,
  };
}

function bucketModel(
  bucket: DistributionBucket,
  range: Range | null,
): ChanceBucket {
  return {
    label: bucket.label,
    pct: finite(bucket.pct) ? bucket.pct : null,
    absence: bucket.absence ?? null,
    absenceDisplay: bucket.absence_display ?? null,
    range: range ? { ...range } : null,
  };
}

function cloneBucket(bucket: ChanceBucket): ChanceBucket {
  return { ...bucket, range: bucket.range ? { ...bucket.range } : null };
}

function orderedBuckets(buckets: ChanceBucket[]): ChanceBucket[] {
  const parseable = buckets.filter(
    (bucket): bucket is ChanceBucket & { range: Range } =>
      bucket.range !== null,
  );
  if (parseable.length < 2) return buckets.map(cloneBucket);
  const isHighToLow =
    parseable[0]!.range.lo > parseable[parseable.length - 1]!.range.lo;
  return (isHighToLow ? [...buckets].reverse() : buckets).map(cloneBucket);
}

function parseGpaRange(bucket: DistributionBucket): Range | null {
  if (
    finite(bucket.lo) &&
    finite(bucket.hi) &&
    bucket.lo >= 0 &&
    bucket.hi <= 4 &&
    bucket.lo <= bucket.hi
  ) {
    return { lo: bucket.lo, hi: bucket.hi, upperInclusive: true };
  }
  const above = /^\s*(\d+(?:\.\d+)?)\s+and\s+above\s*$/i.exec(bucket.label);
  if (above && gpaBoundary(Number(above[1])))
    return {
      lo: Number(above[1]),
      hi: Number.POSITIVE_INFINITY,
      upperInclusive: true,
    };
  const below = /^\s*below\s+(\d+(?:\.\d+)?)\s*$/i.exec(bucket.label);
  if (below && gpaBoundary(Number(below[1])) && Number(below[1]) > 0)
    return {
      lo: Number.NEGATIVE_INFINITY,
      hi: Number(below[1]),
      upperInclusive: false,
    };
  const closed = closedRange(bucket.label, true);
  return closed !== null && closed.lo >= 0 && closed.hi <= 4 ? closed : null;
}

/** A category we cannot parse is honest to retain; a recognisable GPA range
 * outside the chart's 0–4 contract is not. */
function isMalformedGpaBucket(bucket: DistributionBucket): boolean {
  if (finite(bucket.lo) && finite(bucket.hi))
    return bucket.lo < 0 || bucket.hi > 4 || bucket.lo > bucket.hi;
  const closed = /^\s*(?:\d+(?:\.\d+)?)\s*[-–]\s*(?:\d+(?:\.\d+)?)\s*$/.test(
    bucket.label,
  );
  const open =
    /^\s*(?:\d+(?:\.\d+)?)\s+and\s+above\s*$/i.test(bucket.label) ||
    /^\s*below\s+(?:\d+(?:\.\d+)?)\s*$/i.test(bucket.label);
  return (closed || open) && parseGpaRange(bucket) === null;
}

function parseScoreRange(
  bucket: DistributionBucket,
  domain: { min: number; max: number },
  allowBelow: boolean,
): Range | null {
  let range: Range | null;
  if (
    finite(bucket.lo) &&
    finite(bucket.hi) &&
    Number.isInteger(bucket.lo) &&
    Number.isInteger(bucket.hi)
  ) {
    range = { lo: bucket.lo, hi: bucket.hi, upperInclusive: true };
  } else {
    const below =
      allowBelow &&
      /^\s*score\s+of\s+(\d+)\s+or\s+below\s*$/i.exec(bucket.label);
    if (below)
      range = { lo: domain.min, hi: Number(below[1]), upperInclusive: true };
    else
      range = closedRange(
        bucket.label.replace(/^\s*score\s+of\s+/i, ""),
        false,
      );
  }
  return range !== null && range.lo >= domain.min && range.hi <= domain.max
    ? range
    : null;
}

function closedRange(label: string, decimalAllowed: boolean): Range | null {
  const number = decimalAllowed ? "\\d+(?:\\.\\d+)?" : "\\d+";
  const match = new RegExp(
    `^\\s*(${number})\\s*[-–]\\s*(${number})\\s*$`,
    "i",
  ).exec(label);
  if (!match) return null;
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  return finite(lo) && finite(hi) && lo <= hi
    ? { lo, hi, upperInclusive: true }
    : null;
}

function rangesDoNotOverlap(ranges: Array<Range | null>): boolean {
  if (ranges.some((range) => range === null)) return false;
  const ordered = (ranges as Range[]).slice().sort((a, b) => a.lo - b.lo);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.lo < previous.hi) return false;
  }
  return true;
}

function contains(range: Range, value: number): boolean {
  return (
    value >= range.lo &&
    (value < range.hi || (range.upperInclusive && value === range.hi))
  );
}

function combineSchoolStates(states: SchoolValueState[]): SchoolValueState {
  if (states.includes("school_value")) return "school_value";
  if (states.includes("distribution_unscaled")) return "distribution_unscaled";
  if (states.includes("malformed")) return "malformed";
  return states[0] ?? "not_reported";
}

function distributionResult(
  state: SchoolValueState,
  model: DistributionModel | null = null,
  fact: Fact | null = null,
): DistributionResult {
  return {
    state,
    model,
    geometricallyValid: state === "school_value",
    display: fact?.display ?? null,
    reportedPeriod: fact?.reported_period ?? null,
  };
}

function distributionState(result: DistributionResult): DistributionStateModel {
  return {
    state: result.state,
    usable: result.state === "school_value",
    display: result.display,
    reportedPeriod: result.reportedPeriod,
  };
}

function schoolValue(
  state: SchoolValueState,
  result:
    | Pick<DistributionResult, "display" | "reportedPeriod">
    | Pick<BandResult, "display" | "reportedPeriod">,
): SchoolValueModel {
  return {
    state,
    display: result.display,
    reportedPeriod: result.reportedPeriod,
  };
}

function decimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))
    return null;
  const parsed = Number(value);
  return finite(parsed) ? parsed : null;
}

function validScore(value: unknown, min: number, max: number): value is number {
  return (
    finite(value) && Number.isInteger(value) && value >= min && value <= max
  );
}

function validFiniteValue(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return finite(value) && value >= min && value <= max;
}

function gpaBoundary(value: number): boolean {
  return finite(value) && value >= 0 && value <= 4;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDistributionValue(value: unknown): value is DistributionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as DistributionValue).buckets) &&
    Array.isArray((value as DistributionValue).omitted_buckets)
  );
}

function isBandValue(
  value: unknown,
): value is { p25: unknown; p75: unknown; min: unknown; max: unknown } {
  return typeof value === "object" && value !== null;
}
