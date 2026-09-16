import type {
  ChancesMetric,
  GpaModel,
  ScoreLaneModel,
} from "./school-chances-model";

export const CHANCES_TRUTH_FOOTER =
  "Reported entering-class data — not a cutoff or a chance.";

export function gpaInterpretation(
  model: GpaModel,
  gpaScale?: string | null,
): string {
  if (model.profile.state === "missing_profile_value")
    return "Add your unweighted GPA to place yourself on this chart.";
  if (model.profile.state === "incompatible_profile_value") {
    if (gpaScale) {
      return `Your GPA is saved on a ${gpaScale} scale, so it cannot be placed on this 4.0-scale chart.`;
    }
    return "Your GPA has no saved scale, so it cannot be placed on this 4.0-scale chart.";
  }
  const comparison = model.profile.comparison;
  if (!comparison || !model.profile.display)
    return schoolComparisonUnavailable(model.distributionState.display);
  if (comparison.state === "in_bucket" && comparison.label)
    return `Your ${model.profile.display} GPA sits in the ${comparison.label} reported band.`;
  if (comparison.state === "below_reported_buckets")
    return `Your ${model.profile.display} GPA is below the reported buckets.`;
  if (comparison.state === "above_reported_buckets")
    return `Your ${model.profile.display} GPA is above the reported buckets.`;
  return "Your GPA cannot be placed in the school's published bucket labels.";
}

export function scoreInterpretation(lane: ScoreLaneModel): string {
  const subject =
    lane.key === "math"
      ? "SAT Math score"
      : lane.key === "ebrw"
        ? "SAT Reading and Writing score"
        : "ACT composite";
  if (lane.profile.state === "missing_profile_value")
    return `Add your ${subject} to place yourself on this chart.`;
  if (lane.profile.state === "incompatible_profile_value")
    return `Your ${subject} cannot be placed on this chart.`;
  if (!lane.bandState.usable)
    return lane.distributionState.usable
      ? "Middle 50% unavailable"
      : "Data could not be compared.";
  if (!lane.profile.comparison)
    return schoolComparisonUnavailable(lane.school.display);
  const state = lane.profile.comparison.state;
  return `Your ${subject} is ${state === "within_band" ? "within" : state === "below_band" ? "below" : "above"} the reported middle 50%.`;
}

export function metricInterpretation(
  metric: ChancesMetric,
  model: {
    gpa: GpaModel | null;
    sat: { lanes: ScoreLaneModel[] } | null;
    act: ScoreLaneModel | null;
  },
  gpaScale?: string | null,
): string {
  if (metric === "gpa") return gpaInterpretation(model.gpa!, gpaScale);
  if (metric === "act") return scoreInterpretation(model.act!);
  const [math, ebrw] = model.sat!.lanes;
  if (
    math!.profile.state === "missing_profile_value" &&
    ebrw!.profile.state === "missing_profile_value"
  )
    return "Add your SAT section scores to place yourself on these charts.";
  return scoreInterpretation(math!.profile.state === "value" ? math! : ebrw!);
}

export function scenarioLabel(metric: ChancesMetric, lane?: "math" | "ebrw") {
  if (metric === "gpa") return "GPA";
  if (metric === "act") return "ACT composite";
  return lane === "math" ? "SAT Math" : "SAT Reading and Writing";
}

export function scenarioSetCopy(
  metric: ChancesMetric,
  value: number,
  lane?: "math" | "ebrw",
) {
  const display = metric === "gpa" ? value.toFixed(2) : String(value);
  return `Scenario set to ${display} ${scenarioLabel(metric, lane)}.`;
}

function schoolComparisonUnavailable(display: string | null): string {
  return display ?? "Data could not be compared.";
}

/**
 * The reported period most of a metric's own fields share, scoped to
 * whichever fields are actually on screen for that metric — not a
 * response-wide vote. A period only becomes the baseline once it is
 * genuinely redundant, i.e. shared by two or more of the compared fields;
 * a field that is the *only* source for its number has nothing to be
 * redundant with, so it is never treated as colliding with itself. A full
 * tie (every value distinct, as when a school reports several fields from
 * different years) has no baseline at all, so every field is treated as
 * diverging (plan §6).
 */
export function dominantReportedPeriod(
  periods: (string | null | undefined)[],
): string | null {
  const counts = new Map<string, number>();
  for (const period of periods) {
    if (!period) continue;
    counts.set(period, (counts.get(period) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let max = 1;
  for (const [period, count] of counts) {
    if (count > max) {
      dominant = period;
      max = count;
    }
  }
  return dominant;
}

/**
 * A per-field reported period only prints beside its own number when it
 * diverges from the metric's dominant period — otherwise repeating it next
 * to every number is exactly the "says everything twice" defect the header
 * freshness line already covers (plan §6).
 */
export function divergentPeriod(
  period: string | null | undefined,
  baseline: string | null,
): string | null {
  if (!period) return null;
  return period === baseline ? null : period;
}
