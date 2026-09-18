import type { SchoolIdentity } from "@/features/schools/facts/school-facts-types";

/*
 * The admission-chance estimate: a threshold selection model.
 *
 * An applicant has an academic strength `z`, standardised within the school's
 * applicant pool. The school admits on a hidden index
 * `rho * z + sqrt(1 - rho^2) * noise` — the noise is everything this page
 * cannot see (essays, activities, hooks, major) — and takes everyone above a
 * cutoff `t`. The published admit rate fixes `t`, so
 *
 *   P(admit | z) = Phi((rho * z - t) / sqrt(1 - rho^2))
 *
 * averages to exactly the admit rate over the applicant pool. The same model
 * gives the distribution of `z` among admitted students, which is what lets a
 * student be placed from the only distribution a school publishes — its
 * enrolled class: their percentile within the class maps to the `z` at that
 * same percentile of the model's admitted distribution. Placement is by rank,
 * never by raw score, so a class with 75% of its students in the top GPA
 * bucket needs no assumption about the shape of GPA itself.
 *
 * `rho` — how much academics drive the decision — is the one quantity no
 * school publishes. It was fitted against the only public admit-rate-by-
 * academic-strength tables found: Harvard and UNC (in- and out-of-state) by
 * academic-index decile (Arcidiacono, Kinsler & Ransom, "What the Students
 * for Fair Admissions Cases Reveal About Racial Preferences", Table 4) and
 * UCLA's fall-2019 freshman profile by GPA band. One `rho` per school
 * reproduced every published decile to within about a percentage point:
 * 0.42 Harvard, 0.65 UNC out-of-state, 0.67 UCLA, 0.85 UNC in-state. The
 * rule below interpolates those anchors; its uncertainty is carried to the
 * student as the low/high range, never hidden inside a single number.
 *
 * The estimate describes a typical applicant. Recruited athletes, legacies,
 * major-specific and residency-specific admission are all outside it.
 */

export type ChanceEstimate = { chance: number; low: number; high: number };

/** Plausible error on a school's `rho`, given four calibration anchors. */
const RHO_UNCERTAINTY = 0.1;
const RHO_FLOOR = 0.2;
const RHO_CEILING = 0.9;
/** A single measure (GPA alone, or one test) tracks the decision less
 * closely than the GPA-plus-test composite the anchors were fitted on:
 * `sqrt((1 + c) / 2)` for two equally weighted measures correlated `c = 0.5`. */
const SINGLE_MEASURE_FACTOR = Math.sqrt(0.75);

type RhoAnchor = { admitRate: number; rho: number };
const PUBLIC_ANCHORS: RhoAnchor[] = [
  { admitRate: 0.11, rho: 0.65 },
  { admitRate: 0.5, rho: 0.85 },
];
/** Holistic private admission: Harvard is the one fitted anchor; the upper
 * end converges on the public curve as selectivity (and with it the room for
 * holistic review to reorder applicants) falls away. */
const PRIVATE_ANCHORS: RhoAnchor[] = [
  { admitRate: 0.05, rho: 0.42 },
  { admitRate: 0.5, rho: 0.8 },
];

function interpolate(anchors: RhoAnchor[], admitRate: number): number {
  const [first, last] = [anchors[0]!, anchors[anchors.length - 1]!];
  if (admitRate <= first.admitRate) return first.rho;
  if (admitRate >= last.admitRate) return last.rho;
  const share = (admitRate - first.admitRate) / (last.admitRate - first.admitRate);
  return first.rho + share * (last.rho - first.rho);
}

/** How strongly one academic measure drives this school's decision. */
export function academicWeight(
  admitRate: number,
  control: SchoolIdentity["control"],
): number {
  const composite =
    control === "public"
      ? interpolate(PUBLIC_ANCHORS, admitRate)
      : control === null
        ? (interpolate(PUBLIC_ANCHORS, admitRate) +
            interpolate(PRIVATE_ANCHORS, admitRate)) /
          2
        : interpolate(PRIVATE_ANCHORS, admitRate);
  return composite * SINGLE_MEASURE_FACTOR;
}

/* ---- the standard normal ------------------------------------------------ */

/** Abramowitz & Stegun 7.1.26 — absolute error below 1.5e-7. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) * Math.SQRT1_2);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

function normalPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Acklam's rational approximation — relative error below 1.15e-9. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/* ---- the selection model ------------------------------------------------ */

const GRID_LO = -7;
const GRID_HI = 7;
const GRID_STEP = 0.02;

function admitProbability(z: number, rho: number, cutoff: number): number {
  return normalCdf((rho * z - cutoff) / Math.sqrt(1 - rho * rho));
}

type Placement = { zs: number[]; cdf: number[] };
const placementCache = new Map<string, Placement>();

/** The model's admitted-class distribution of `z`, as a cumulative table. */
function placement(rho: number, admitRate: number): Placement {
  const key = `${rho.toFixed(4)}|${admitRate.toFixed(4)}`;
  const cached = placementCache.get(key);
  if (cached) return cached;
  const cutoff = normalQuantile(1 - admitRate);
  const zs: number[] = [];
  const cdf: number[] = [];
  let mass = 0;
  for (let z = GRID_LO; z <= GRID_HI; z += GRID_STEP) {
    mass += normalPdf(z) * admitProbability(z, rho, cutoff) * GRID_STEP;
    zs.push(z);
    cdf.push(mass);
  }
  const built = { zs, cdf: cdf.map((value) => value / mass) };
  placementCache.set(key, built);
  return built;
}

function strengthAtClassPercentile(percentile: number, table: Placement): number {
  let lo = 0;
  let hi = table.cdf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.cdf[mid]! < percentile) lo = mid;
    else hi = mid;
  }
  const span = table.cdf[hi]! - table.cdf[lo]!;
  const share = span > 0 ? (percentile - table.cdf[lo]!) / span : 0;
  return table.zs[lo]! + share * (table.zs[hi]! - table.zs[lo]!);
}

const PERCENTILE_FLOOR = 0.002;

function chanceAtRho(classPercentile: number, rho: number, admitRate: number): number {
  const bounded = Math.min(1 - PERCENTILE_FLOOR, Math.max(PERCENTILE_FLOOR, classPercentile));
  const z = strengthAtClassPercentile(bounded, placement(rho, admitRate));
  return admitProbability(z, rho, normalQuantile(1 - admitRate));
}

/**
 * The chance of admission for a student at `classPercentile` (0..1) of the
 * school's enrolled class, with the range `rho`'s uncertainty implies.
 */
export function estimateChance(
  classPercentile: number,
  admitRate: number,
  control: SchoolIdentity["control"],
): ChanceEstimate {
  const rate = Math.min(0.995, Math.max(0.005, admitRate));
  const rho = academicWeight(rate, control);
  const bound = (value: number) => Math.min(RHO_CEILING, Math.max(RHO_FLOOR, value));
  const chance = chanceAtRho(classPercentile, bound(rho), rate);
  const a = chanceAtRho(classPercentile, bound(rho - RHO_UNCERTAINTY), rate);
  const b = chanceAtRho(classPercentile, bound(rho + RHO_UNCERTAINTY), rate);
  return {
    chance,
    low: Math.min(a, b, chance),
    high: Math.max(a, b, chance),
  };
}
