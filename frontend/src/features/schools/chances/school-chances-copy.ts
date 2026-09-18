import type {
  ChancesMetric,
  GpaModel,
  ScoreLaneModel,
} from "./school-chances-model";

export const CHANCES_TRUTH_FOOTER =
  "Reported entering-class data — not a cutoff or a chance.";

/** Where a class percentile (0..1) sits, in words a student reads at a glance. */
export function classStanding(classPercentile: number): string {
  if (classPercentile >= 0.9) return "above most of this school's students";
  if (classPercentile >= 0.65) return "in the upper part of this school's class";
  if (classPercentile >= 0.35) return "right around the typical student here";
  if (classPercentile >= 0.1) return "in the lower part of this school's class";
  return "below most of this school's students";
}

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
  if (model.profile.state === "missing_profile_value") {
    /* Whole-plan close-out review, GPA wording consolidation: this used to
     * read "Add your unweighted GPA to place yourself on this chart." —
     * `GpaComparison.tsx`'s own caption for the same fact said "on a 4.0
     * scale" too, and duplicated it. The caption is now suppressed
     * whenever this verdict fires (it always does for a missing GPA), so
     * this sentence — the one that survives — carries the richer of the
     * two wordings rather than the thinner one. */
    const absence =
      "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.";
    /* Defect 2 fix (whole-plan close-out review): the plot stays
     * interactive for a missing value (only `incompatible_profile_value`
     * disables it), so a student with nothing saved can still scrub a
     * scenario — plan §5 says the verdict updates live for that too. Show
     * both facts, never one instead of the other: the hypothetical the
     * student is exploring, and the plain statement that nothing is saved
     * yet. Dropping the absence sentence here would be exactly the
     * "papers over" defect the guard above already exists to prevent. */
    return model.scenario
      ? `${gpaScenarioInterpretation(model.scenario)} ${absence}`
      : absence;
  }
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
  if (lane.profile.state === "missing_profile_value") {
    const absence = `Add your ${subject} to place yourself on this chart.`;
    /* Defect 2 fix — same "both facts, same screen" contract as
     * `gpaInterpretation` above: a missing value keeps the plot
     * interactive, so a scrubbed scenario must describe the hypothetical
     * without ever dropping the absence disclosure. */
    return lane.scenario
      ? `${scoreScenarioInterpretation(subject, lane.scenario)} ${absence}`
      : absence;
  }
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
 *
 * Whole-plan close-out review, defect 2: also carries each lane's own
 * absence disclosure when that lane has no saved value — the same
 * "both facts, same screen" contract `scoreInterpretation` applies to a
 * single lane, extended here so two simultaneous drags can't drop one
 * lane's absence just because the other lane happens to be saved.
 */
function bothScoreScenarioInterpretation(
  math: ScoreLaneModel,
  ebrw: ScoreLaneModel,
  mathScenario: NonNullable<ScoreLaneModel["scenario"]>,
  ebrwScenario: NonNullable<ScoreLaneModel["scenario"]>,
): string {
  const sentence =
    mathScenario.comparison &&
    ebrwScenario.comparison &&
    mathScenario.comparison.state === ebrwScenario.comparison.state
      ? `A hypothetical SAT Math score of ${mathScenario.value} and Reading and Writing score of ${ebrwScenario.value} would both sit ${bandVerb(mathScenario.comparison.state)} the reported middle 50%.`
      : `${scoreScenarioInterpretation(scoreSubject("math"), mathScenario)} ${scoreScenarioInterpretation(scoreSubject("ebrw"), ebrwScenario)}`;
  const absences = [
    math.profile.state === "missing_profile_value"
      ? `Add your ${scoreSubject("math")} to place yourself on this chart.`
      : null,
    ebrw.profile.state === "missing_profile_value"
      ? `Add your ${scoreSubject("ebrw")} to place yourself on this chart.`
      : null,
  ].filter((text): text is string => text !== null);
  return [sentence, ...absences].join(" ");
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
   * this — the two-lane and single-lane "which saved lane are we actively
   * dragging" branches of `satVerdict` — once `scoreInterpretation`'s own
   * `state === "value"` case is the one in play for that lane. A
   * `missing_profile_value` lane's scenario is handled by `satVerdict`'s
   * own both-missing branch below, which calls `scoreInterpretation`
   * directly rather than routing through this gate — that function is what
   * carries the "both facts, same screen" hypothetical-plus-absence
   * contract (defect 2), so it must run on the lane's true state, not a
   * pre-narrowed one. */
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
    return bothScoreScenarioInterpretation(math, ebrw, mathScenario, ebrwScenario);
  /* Whole-plan close-out review, defect 1 fix: this read the raw
   * `math.scenario` / `ebrw.scenario` fields instead of the gated
   * `mathScenario` / `ebrwScenario` parameters already computed above by
   * `satInterpretation` — so scrubbing a lane with no saved value (which
   * stays interactive; only `incompatible_profile_value` disables it)
   * could pick that lane here even though its scenario is not "active" by
   * this gate, silently erasing the other, saved lane's correct,
   * still-current verdict. Use the same gated values the two-lane branch
   * above already uses. */
  const scenarioLane = mathScenario ? math : ebrwScenario ? ebrw : null;
  if (scenarioLane) return scoreInterpretation(scenarioLane);
  if (
    math.profile.state === "missing_profile_value" &&
    ebrw.profile.state === "missing_profile_value"
  ) {
    /* Whole-plan close-out review, defect 2 fix: both lanes have no saved
     * value, so neither is "active" by the value-only gate above — but the
     * plot stays interactive for a missing value, and §5 says the verdict
     * updates live for it same as GPA/ACT. Read the lanes' own (ungated)
     * scenarios here and let `scoreInterpretation`/
     * `bothScoreScenarioInterpretation` supply the hypothetical-plus-
     * absence sentence; only fall back to the plain absence line when
     * neither lane has been scrubbed yet. */
    if (math.scenario && ebrw.scenario)
      return bothScoreScenarioInterpretation(math, ebrw, math.scenario, ebrw.scenario);
    if (math.scenario) return scoreInterpretation(math);
    if (ebrw.scenario) return scoreInterpretation(ebrw);
    return "Add your SAT section scores to place yourself on these charts.";
  }
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
