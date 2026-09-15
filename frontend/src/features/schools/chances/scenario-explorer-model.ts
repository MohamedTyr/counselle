import { scenarioLabel } from "./school-chances-copy";
import type {
  ChancesMetric,
  ChancesScenarioInput,
  SchoolChancesModel,
} from "./school-chances-model";

export type ScenarioLane = "gpa" | "math" | "ebrw" | "composite";
export type LaneConfig = {
  key: ScenarioLane;
  label: string;
  min: number;
  max: number;
  step: number;
  seed: number | null;
};

export function laneConfigs(
  metric: ChancesMetric,
  profile: ChancesScenarioInput,
  scenario: ChancesScenarioInput,
): LaneConfig[] {
  const configs: Omit<LaneConfig, "seed">[] =
    metric === "gpa"
      ? [{ key: "gpa", label: "GPA", min: 0, max: 4, step: 0.01 }]
      : metric === "sat"
        ? [
            { key: "math", label: "Math", min: 200, max: 800, step: 10 },
            {
              key: "ebrw",
              label: "Reading and Writing",
              min: 200,
              max: 800,
              step: 10,
            },
          ]
        : [
            {
              key: "composite",
              label: "ACT composite",
              min: 1,
              max: 36,
              step: 1,
            },
          ];
  return configs.map((config) => ({
    ...config,
    seed:
      profileValue(metric, config.key, scenario) ??
      seeded(metric, config.key, profile, config),
  }));
}

export function profileValue(
  metric: ChancesMetric,
  key: ScenarioLane,
  value: ChancesScenarioInput,
): number | null {
  if (metric === "gpa") return value.gpa ?? null;
  if (metric === "act") return value.act?.composite ?? null;
  return key === "math" ? (value.sat?.math ?? null) : (value.sat?.ebrw ?? null);
}

export function withChangedLane(
  current: ChancesScenarioInput,
  profile: ChancesScenarioInput,
  metric: ChancesMetric,
  key: ScenarioLane,
  value: number,
): ChancesScenarioInput {
  return profileValue(metric, key, profile) === value
    ? withoutLane(current, key)
    : withLane(current, key, value);
}

export function withoutMetric(
  metric: ChancesMetric,
  current: ChancesScenarioInput,
): ChancesScenarioInput {
  if (metric === "gpa") return withoutLane(current, "gpa");
  if (metric === "act") return withoutLane(current, "composite");
  return withoutLane(withoutLane(current, "math"), "ebrw");
}

export function hasChangedMetricScenario(
  metric: ChancesMetric,
  profile: ChancesScenarioInput,
  scenario: ChancesScenarioInput,
): boolean {
  const keys: ScenarioLane[] =
    metric === "gpa"
      ? ["gpa"]
      : metric === "sat"
        ? ["math", "ebrw"]
        : ["composite"];
  return keys.some((key) => {
    const value = profileValue(metric, key, scenario);
    return value !== null && value !== profileValue(metric, key, profile);
  });
}

export function laneIsComparable(
  metric: ChancesMetric,
  key: ScenarioLane,
  model: SchoolChancesModel,
) {
  if (metric === "gpa") return model.gpa!.distributionState.usable;
  const lane =
    metric === "act"
      ? model.act!
      : model.sat!.lanes.find((candidate) => candidate.key === key);
  return Boolean(lane?.distributionState.usable || lane?.bandState.usable);
}

/** Scenario copy comes from the scenario comparison, never saved-profile copy. */
export function scenarioPosition(
  metric: ChancesMetric,
  key: ScenarioLane,
  model: SchoolChancesModel,
): string | null {
  if (metric === "gpa") {
    const scenario = model.gpa!.scenario;
    if (!scenario?.comparison) return null;
    if (scenario.comparison.state === "in_bucket")
      return `A scenario of ${scenario.value} GPA sits in the ${scenario.comparison.label} reported band.`;
    if (scenario.comparison.state === "below_reported_buckets")
      return `A scenario of ${scenario.value} GPA is below the reported buckets.`;
    if (scenario.comparison.state === "above_reported_buckets")
      return `A scenario of ${scenario.value} GPA is above the reported buckets.`;
    return "This GPA scenario cannot be placed in the school's published bucket labels.";
  }
  const lane =
    metric === "act"
      ? model.act!
      : model.sat!.lanes.find((candidate) => candidate.key === key);
  const scenario = lane?.scenario;
  if (!scenario?.comparison) return null;
  const label =
    metric === "act"
      ? "ACT composite"
      : scenarioLabel("sat", key as "math" | "ebrw");
  const position =
    scenario.comparison.state === "within_band"
      ? "within"
      : scenario.comparison.state === "below_band"
        ? "below"
        : "above";
  return `A scenario of ${scenario.value} ${label} is ${position} the reported middle 50%.`;
}

export function onGrid(
  value: number,
  lane: Pick<LaneConfig, "min" | "max" | "step">,
) {
  return (
    Number.isFinite(value) &&
    value >= lane.min &&
    value <= lane.max &&
    Math.abs(
      (value - lane.min) / lane.step -
        Math.round((value - lane.min) / lane.step),
    ) < 1e-8
  );
}

export function formatValue(value: number, step: number) {
  return step < 1 ? value.toFixed(2) : String(value);
}

export function errorCopy(lane: Pick<LaneConfig, "step">) {
  if (lane.step === 0.01) return "Use increments of 0.01";
  if (lane.step === 10) return "Use 10-point increments";
  return "Use whole numbers";
}

export function offGridCopy(metric: ChancesMetric, step: number) {
  if (metric === "gpa")
    return "Your saved GPA is more precise than this 0.01 explorer. Enter a two-decimal scenario to start.";
  if (metric === "sat") return "This explorer moves in 10-point steps.";
  return `This explorer moves in ${step}-point steps.`;
}

function seeded(
  metric: ChancesMetric,
  key: ScenarioLane,
  profile: ChancesScenarioInput,
  config: Omit<LaneConfig, "seed">,
) {
  const value = profileValue(metric, key, profile);
  return value !== null && onGrid(value, config) ? value : null;
}

function withLane(
  current: ChancesScenarioInput,
  key: ScenarioLane,
  value: number,
): ChancesScenarioInput {
  if (key === "gpa") return { ...current, gpa: value };
  if (key === "composite")
    return { ...current, act: { ...current.act, composite: value } };
  return { ...current, sat: { ...current.sat, [key]: value } };
}

function withoutLane(
  current: ChancesScenarioInput,
  key: ScenarioLane,
): ChancesScenarioInput {
  if (key === "gpa") {
    const next = { ...current };
    delete next.gpa;
    return next;
  }
  if (key === "composite") {
    const act = { ...current.act };
    delete act.composite;
    return { ...current, act: Object.keys(act).length ? act : undefined };
  }
  const sat = { ...current.sat };
  delete sat[key];
  return { ...current, sat: Object.keys(sat).length ? sat : undefined };
}
