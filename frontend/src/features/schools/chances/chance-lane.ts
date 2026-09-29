import { estimateChance, normalCdf, type ChanceEstimate } from "./admit-chance-model";
import { monotoneInterpolator, type Knot } from "./monotone-cubic";
import type {
  BandModel,
  DistributionModel,
  SchoolChancesModel,
  ScoreLaneModel,
} from "./school-chances-model";

/*
 * One explorable axis of the chance screen: a score scale, where the saved
 * profile sits on it, and how any score on it ranks within the school's
 * enrolled class. The rank is the only thing the chance model consumes
 * (`admit-chance-model.ts`), so everything about reading a school's
 * published data lives here and nothing about admission does.
 */

export type ChanceLane = {
  noun: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  /** The share (0..1) of the enrolled class at or below `value`. */
  classPercentile: (value: number) => number;
  /** The score at the middle of the enrolled class. */
  typical: number;
  saved: number | null;
};

export type ChancePoint = ChanceEstimate & { value: number };

/** A reported distribution that leaves this much of the class unplaced
 * cannot rank a student within it. */
const MIN_REPORTED_SHARE = 90;
/** How far an open-ended bucket ("Below 2.00") is taken to reach. */
const OPEN_BUCKET_SPAN: Record<"gpa" | "score", number> = { gpa: 0.5, score: 100 };
/** SAT Math and Reading & Writing move together; their total is narrower
 * than two independent sections would be and wider than one doubled. */
const SAT_SECTION_CORRELATION = 0.75;
/** Interquartile range of a normal, in standard deviations. */
const IQR_IN_SD = 1.349;
/** The class's outermost 1% at each end is left off the drawn scale. */
const FOCUS_TAIL = 0.01;
const FOCUS_PADDING = 0.2;
/** How many steps below a tie its half-share is eased in over. */
const TIE_RAMP_STEPS = 12;

const GPA_SCALE = { min: 2, max: 4, step: 0.01 };

export function buildChanceLane(model: SchoolChancesModel): ChanceLane | null {
  if (model.metric === "gpa") return gpaLane(model);
  if (model.metric === "act") return model.act ? actLane(model.act) : null;
  return model.sat ? satLane(model.sat) : null;
}

export function chanceAt(
  lane: ChanceLane,
  value: number,
  model: Pick<SchoolChancesModel, "admitRate" | "control">,
): ChancePoint | null {
  if (model.admitRate === null) return null;
  return {
    value,
    ...estimateChance(lane.classPercentile(value), model.admitRate, model.control),
  };
}

function gpaLane(model: SchoolChancesModel): ChanceLane | null {
  const gpa = model.gpa;
  if (!gpa?.distribution || !gpa.distributionState.usable) return null;
  const classPercentile = bucketPercentile(gpa.distribution, GPA_SCALE, "gpa");
  if (classPercentile === null) return null;
  const saved = gpa.profile.state === "value" ? gpa.profile.value : null;
  return {
    noun: "GPA",
    ...focusOn(classPercentile, GPA_SCALE, saved),
    format: (value) => value.toFixed(2),
    classPercentile,
    typical: medianOf(classPercentile, GPA_SCALE),
    saved,
  };
}

function actLane(lane: ScoreLaneModel): ChanceLane | null {
  const scale = { min: 10, max: 36, step: 1 };
  const classPercentile = scorePercentile(lane, scale);
  if (classPercentile === null) return null;
  return {
    noun: "ACT",
    ...focusOn(classPercentile, scale, lane.profile.value),
    format: (value) => String(Math.round(value)),
    classPercentile,
    typical: medianOf(classPercentile, scale),
    saved: lane.profile.value,
  };
}

function satLane(sat: NonNullable<SchoolChancesModel["sat"]>): ChanceLane | null {
  const [math, ebrw] = [lane(sat, "math"), lane(sat, "ebrw")];
  if (math?.band && ebrw?.band) return satTotalLane(sat, math.band, ebrw.band);
  const section = [math, ebrw].find(
    (candidate) => candidate && scorePercentile(candidate, SECTION_SCALE) !== null,
  );
  if (!section) return null;
  const classPercentile = scorePercentile(section, SECTION_SCALE)!;
  return {
    noun: section.key === "math" ? "SAT Math" : "SAT Reading & Writing",
    ...focusOn(classPercentile, SECTION_SCALE, section.profile.value),
    format: (value) => String(Math.round(value)),
    classPercentile,
    typical: medianOf(classPercentile, SECTION_SCALE),
    saved: section.profile.value,
  };
}

const SECTION_SCALE = { min: 200, max: 800, step: 10 };
const TOTAL_SCALE = { min: 600, max: 1600, step: 10 };

function satTotalLane(
  sat: NonNullable<SchoolChancesModel["sat"]>,
  math: BandModel,
  ebrw: BandModel,
): ChanceLane {
  const [mathFit, ebrwFit] = [normalFit(math), normalFit(ebrw)];
  const mean = mathFit.mean + ebrwFit.mean;
  const sd = Math.sqrt(
    mathFit.sd ** 2 +
      ebrwFit.sd ** 2 +
      2 * SAT_SECTION_CORRELATION * mathFit.sd * ebrwFit.sd,
  );
  const sections = sat.lanes.map((candidate) => candidate.profile.value);
  const fromSections = sections.every((value) => value !== null)
    ? sections.reduce<number>((sum, value) => sum + value!, 0)
    : null;
  const classPercentile = (value: number) => normalCdf((value - mean) / sd);
  const saved = fromSections ?? sat.totalContext?.value ?? null;
  return {
    noun: "SAT",
    ...focusOn(classPercentile, TOTAL_SCALE, saved),
    format: (value) => String(Math.round(value)),
    classPercentile,
    typical: Math.round(mean / TOTAL_SCALE.step) * TOTAL_SCALE.step,
    saved,
  };
}

function lane(
  sat: NonNullable<SchoolChancesModel["sat"]>,
  key: ScoreLaneModel["key"],
): ScoreLaneModel | undefined {
  return sat.lanes.find((candidate) => candidate.key === key);
}

/** A reported middle 50% is finer than 100-point buckets, so it wins. */
function scorePercentile(
  lane: ScoreLaneModel,
  scale: { min: number; max: number; step: number },
): ((value: number) => number) | null {
  if (lane.band) {
    const { mean, sd } = normalFit(lane.band);
    return (value) => normalCdf((value - mean) / sd);
  }
  if (lane.distribution && lane.distributionState.usable)
    return bucketPercentile(lane.distribution, scale, "score");
  return null;
}

function normalFit(band: BandModel): { mean: number; sd: number } {
  return {
    mean: (band.p25 + band.p75) / 2,
    sd: Math.max((band.p75 - band.p25) / IQR_IN_SD, Number.EPSILON),
  };
}

/**
 * The class's cumulative share as a smooth monotone curve through the one
 * thing a bucket states exactly: how much of the class lies below each of
 * its edges. A bucket with no width ("4.00 and Above" on a 4.0 scale) is a
 * tie, so a student on it ranks at the middle of everyone sharing it.
 */
function bucketPercentile(
  distribution: DistributionModel,
  scale: { min: number; max: number; step: number },
  kind: "gpa" | "score",
): ((value: number) => number) | null {
  const buckets = distribution.buckets
    .filter((bucket) => bucket.pct !== null && bucket.range !== null)
    .map((bucket) => {
      const { lo, hi } = bucket.range!;
      /* An open low bucket ("Below 2.00") always gets its assumed span, even
       * where that puts its lower edge under the scale's own minimum — the
       * interpolator below is only ever evaluated inside the lane, and
       * clamping it to zero width here would misclassify it as a tie. */
      return {
        lo: Number.isFinite(lo) ? lo : hi - OPEN_BUCKET_SPAN[kind],
        hi: Number.isFinite(hi) ? hi : scale.max,
        pct: bucket.pct!,
      };
    })
    .sort((a, b) => a.lo - b.lo);

  /* The only real tie is the open-ended top bucket ("4.00 and Above"): its
   * lower edge sits at or above the scale's ceiling, so it has no room to
   * report a width. Any other zero-width or inverted bucket is a malformed
   * report, not a shared rank, and is dropped from `ranged` below. */
  const tie = buckets.find((bucket) => bucket.hi <= bucket.lo && bucket.lo >= scale.max);
  const ranged = buckets.filter((bucket) => bucket.hi > bucket.lo);
  const total = ranged.reduce((sum, bucket) => sum + bucket.pct, 0) + (tie?.pct ?? 0);
  if (ranged.length === 0 || total < MIN_REPORTED_SHARE) return null;

  const knots: Knot[] = [{ x: ranged[0]!.lo, y: 0 }];
  let below = 0;
  ranged.forEach((bucket, index) => {
    below += bucket.pct;
    /* "3.50 - 3.74" then "3.75 - 3.99": the labelling seam between two
     * adjacent buckets is not a stretch of the scale with nobody on it. */
    const nextLo = ranged[index + 1]?.lo ?? tie?.lo;
    const edge =
      nextLo !== undefined && nextLo - bucket.hi <= scale.step ? nextLo : bucket.hi;
    /* Never hand the interpolator a knot that would take x backward — a
     * bucket edge should only ever advance the scale. */
    knots.push({ x: Math.max(edge, knots[knots.length - 1]!.x), y: below / total });
  });
  const ranked = monotoneInterpolator(knots);
  if (!tie) return ranked;
  /* The tie's half-share arrives over the last few steps up to it rather
   * than as a cliff on the final one. */
  const rampStart = tie.lo - scale.step * TIE_RAMP_STEPS;
  return (value) => {
    const t = Math.min(1, Math.max(0, (value - rampStart) / (tie.lo - rampStart)));
    return ranked(value) + (tie.pct / 2 / total) * t * t * (3 - 2 * t);
  };
}

/** The slice of the scale worth drawing: the class itself plus breathing
 * room, so the curve's rise fills the plot instead of hiding at one edge —
 * widened so the student's own saved score is always inside it. */
function focusOn(
  classPercentile: (value: number) => number,
  scale: { min: number; max: number; step: number },
  saved: number | null,
): { min: number; max: number; step: number } {
  let lo = scale.max;
  let hi = scale.min;
  for (let value = scale.min; value <= scale.max; value += scale.step) {
    const share = classPercentile(value);
    if (share > FOCUS_TAIL && value < lo) lo = value;
    if (share < 1 - FOCUS_TAIL) hi = value;
  }
  const snap = (value: number) => Number((Math.round(value / scale.step) * scale.step).toFixed(2));
  const focused =
    hi <= lo
      ? scale
      : {
          min: Math.max(scale.min, snap(lo - (hi - lo) * FOCUS_PADDING)),
          max: Math.min(scale.max, snap(hi + (hi - lo) * FOCUS_PADDING)),
          step: scale.step,
        };
  return widenToSaved(focused, saved, scale);
}

/** A saved score outside the class's focused range must still be visible —
 * a student with a 2.20 GPA at a school whose class lane is 2.83-4.00
 * should see their own real score, never one silently clamped into range. */
function widenToSaved(
  range: { min: number; max: number; step: number },
  saved: number | null,
  scale: { min: number; max: number; step: number },
): { min: number; max: number; step: number } {
  if (saved === null) return range;
  const snapDown = (value: number) =>
    Number((Math.floor(value / scale.step) * scale.step).toFixed(2));
  const snapUp = (value: number) =>
    Number((Math.ceil(value / scale.step) * scale.step).toFixed(2));
  const clamped = Math.min(scale.max, Math.max(scale.min, saved));
  return {
    min: Math.max(scale.min, Math.min(range.min, snapDown(clamped))),
    max: Math.min(scale.max, Math.max(range.max, snapUp(clamped))),
    step: range.step,
  };
}

function medianOf(
  classPercentile: (value: number) => number,
  scale: { min: number; max: number; step: number },
): number {
  for (let value = scale.min; value <= scale.max; value += scale.step)
    if (classPercentile(value) >= 0.5) return Number(value.toFixed(2));
  return scale.max;
}
