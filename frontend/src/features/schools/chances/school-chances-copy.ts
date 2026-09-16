import type {
  ChancesMetric,
  GpaModel,
  ScoreLaneModel,
} from "./school-chances-model";

export const CHANCES_TRUTH_FOOTER =
  "Reported entering-class data — not a cutoff or a chance.";

/** The two SAT lane labels (plan §4) — the short form used as the
 * per-lane inline label, distinct from `scenarioLabel`'s "SAT Math" /
 * "SAT Reading and Writing" (spoken form, prefixed with the instrument). */
export function satLaneTitle(lane: "math" | "ebrw"): string {
  return lane === "math" ? "Math" : "Reading and Writing";
}

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
  if (model.scenario) return gpaScenarioInterpretation(model.scenario);
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

/**
 * Describes an active scenario drag (plan §5: "the verdict update live").
 * Only reached once `gpaInterpretation`'s two absence guards above have
 * already passed — a scenario never papers over "you haven't entered a
 * GPA" or an incompatible saved scale. Every sentence is phrased as a
 * hypothetical ("if your GPA were", "a hypothetical N GPA would") so it can
 * never be mistaken for a statement about the student's actual saved
 * record — `GpaModel["scenario"]` is only non-null once `ScrubbablePlot`'s
 * own commit has already confirmed the dragged value differs from the
 * saved one (see `ScrubbablePlot.tsx`'s `commit`).
 */
function gpaScenarioInterpretation(scenario: NonNullable<GpaModel["scenario"]>): string {
  const display = scenario.value.toFixed(2);
  const comparison = scenario.comparison;
  if (!comparison)
    return `A hypothetical ${display} GPA can't be compared to this school's data.`;
  if (comparison.state === "in_bucket" && comparison.label)
    return `If your GPA were ${display}, it would sit in the ${comparison.label} reported band.`;
  if (comparison.state === "below_reported_buckets")
    return `A hypothetical ${display} GPA would be below the reported buckets.`;
  if (comparison.state === "above_reported_buckets")
    return `A hypothetical ${display} GPA would be above the reported buckets.`;
  return `A hypothetical ${display} GPA can't be placed in the school's published bucket labels.`;
}

function scoreSubject(key: ScoreLaneModel["key"]): string {
  return key === "math"
    ? "SAT Math score"
    : key === "ebrw"
      ? "SAT Reading and Writing score"
      : "ACT composite";
}

export function scoreInterpretation(lane: ScoreLaneModel): string {
  const subject = scoreSubject(lane.key);
  if (lane.profile.state === "missing_profile_value")
    return `Add your ${subject} to place yourself on this chart.`;
  if (lane.profile.state === "incompatible_profile_value")
    return `Your ${subject} cannot be placed on this chart.`;
  if (lane.scenario) return scoreScenarioInterpretation(subject, lane.scenario);
  if (!lane.bandState.usable)
    return lane.distributionState.usable
      ? "Middle 50% unavailable."
      : "Data could not be compared.";
  if (!lane.profile.comparison)
    return schoolComparisonUnavailable(lane.school.display);
  return `Your ${subject} is ${bandVerb(lane.profile.comparison.state)} the reported middle 50%.`;
}

function bandVerb(state: "within_band" | "below_band" | "above_band"): string {
  return state === "within_band" ? "within" : state === "below_band" ? "below" : "above";
}

/** SAT/ACT counterpart to `gpaScenarioInterpretation` above — same absence
 * priority (the two `lane.profile.state` guards in `scoreInterpretation`
 * run first) and the same unmistakably-hypothetical phrasing. */
function scoreScenarioInterpretation(
  subject: string,
  scenario: NonNullable<ScoreLaneModel["scenario"]>,
): string {
  if (!scenario.comparison)
    return `A hypothetical ${subject} of ${scenario.value} can't be compared to this school's data.`;
  return `A hypothetical ${subject} of ${scenario.value} would be ${bandVerb(scenario.comparison.state)} the reported middle 50%.`;
}

/**
 * Defect 2 fix: when both SAT lanes carry an active scenario, the old
 * `metricInterpretation` picked math unconditionally and never mentioned a
 * Reading and Writing drag the student was actively looking at — nothing
 * false, but a silent omission is exactly how this panel would mislead.
 * Addresses both lanes; collapses to one natural sentence when they land
 * in the same place relative to the band, otherwise two short sentences
 * (fix brief) rather than one that has to hedge two different verbs at
 * once.
 */
function bothScoreScenarioInterpretation(
  math: NonNullable<ScoreLaneModel["scenario"]>,
  ebrw: NonNullable<ScoreLaneModel["scenario"]>,
): string {
  if (math.comparison && ebrw.comparison && math.comparison.state === ebrw.comparison.state) {
    return `A hypothetical SAT Math score of ${math.value} and Reading and Writing score of ${ebrw.value} would both sit ${bandVerb(math.comparison.state)} the reported middle 50%.`;
  }
  return `${scoreScenarioInterpretation(scoreSubject("math"), math)} ${scoreScenarioInterpretation(scoreSubject("ebrw"), ebrw)}`;
}

type SatInterpretationModel = {
  lanes: ScoreLaneModel[];
  /** The saved SAT total, when one exists — plan §4 deletes this from its
   * own floating caption and folds it into the verdict sentence instead: it
   * is the one number on the SAT screen that isn't compared to anything, so
   * it earns a place in the sentence rather than a caption of its own. */
  totalContext: { value: number; display: number } | null;
};

export function metricInterpretation(
  metric: ChancesMetric,
  model: {
    gpa: GpaModel | null;
    sat: SatInterpretationModel | null;
    act: ScoreLaneModel | null;
  },
  gpaScale?: string | null,
): string {
  if (metric === "gpa") return gpaInterpretation(model.gpa!, gpaScale);
  if (metric === "act") return scoreInterpretation(model.act!);
  return satInterpretation(model.sat!);
}

function satInterpretation(sat: SatInterpretationModel): string {
  const [math, ebrw] = sat.lanes;
  /* Same guard-mirroring rationale as `gpaNumberCells`'s `activeGpaScenario`
   * (SchoolChancesPanel.tsx): a lane's scenario only counts as "active" for
   * this sentence once `scoreInterpretation`'s own profile-absence guards
   * for that lane have already passed — otherwise a lane the verdict would
   * still be reporting as absent could get counted as active here. */
  const mathScenario = math!.profile.state === "value" ? math!.scenario : null;
  const ebrwScenario = ebrw!.profile.state === "value" ? ebrw!.scenario : null;
  const sentence = satVerdict(math!, ebrw!, mathScenario, ebrwScenario);
  return sat.totalContext
    ? `${sentence} Your SAT ${sat.totalContext.display} shown for context.`
    : sentence;
}

function satVerdict(
  math: ScoreLaneModel,
  ebrw: ScoreLaneModel,
  mathScenario: ScoreLaneModel["scenario"],
  ebrwScenario: ScoreLaneModel["scenario"],
): string {
  /* Defect 2 fix: both lanes actively scrubbed at once must both be
   * described — see `bothScoreScenarioInterpretation` above. */
  if (mathScenario && ebrwScenario)
    return bothScoreScenarioInterpretation(mathScenario, ebrwScenario);
  /* Whichever lane has an active scenario is the one the student is
   * actually dragging right now — describe that one live, rather than
   * always favoring math's static comparison while an ebrw drag goes
   * unreflected in the verdict (plan §5). */
  const scenarioLane = math.scenario ? math : ebrw.scenario ? ebrw : null;
  if (scenarioLane) return scoreInterpretation(scenarioLane);
  if (
    math.profile.state === "missing_profile_value" &&
    ebrw.profile.state === "missing_profile_value"
  )
    return "Add your SAT section scores to place yourself on these charts.";
  return scoreInterpretation(math.profile.state === "value" ? math : ebrw);
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
