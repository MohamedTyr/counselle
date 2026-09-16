import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import { cn } from "@/lib/utils";

import {
  AxisEndpointLabels,
  ClassShape,
  CLASS_SHAPE_HEIGHT,
  selectClassShapeKind,
  YOU_MARK_PILL_CLEARANCE,
} from "./ClassShape";
import { ScrubAffordanceHint, ScrubbablePlot } from "./ScrubbablePlot";
import { YouMark } from "./YouMark";
import { plotWindow, type PlotWindowMetric } from "./academic-comparison-geometry";
import {
  laneConfigs,
  offGridCopy,
  onGrid,
  profileValue,
  withChangedLane,
  withoutLane,
  type ScenarioLane,
} from "./scenario-explorer-model";
import {
  dominantReportedPeriod,
  divergentPeriod,
  scenarioSetCopy,
} from "./school-chances-copy";
import {
  isSumsToMaterial,
  partialDistributionSummaryText,
  profilePlacementMessage,
  schoolFactDisplay,
} from "./score-plot-copy";
import {
  SCORE_DOMAINS,
  type ChancesMetric,
  type ChancesScenarioInput,
  type ScalarModel,
  type ScoreLaneModel,
} from "./school-chances-model";

type AcademicComparisonPlotProps = {
  lane: ScoreLaneModel;
  title: string;
  testPolicy?: ScalarModel;
  /** The dominant reported period across every lane on this screen — SAT
   * passes one shared baseline computed across both lanes (plan §6); ACT
   * (one lane) leaves it unset and this file derives it from its own three
   * fields, which is equivalent to a single-lane baseline. */
  periodBaseline?: string | null;
  /** Panel-level scenario plumbing (plan §5) — this lane's own `ScrubbablePlot`
   * reads and writes through these, exactly as `ScenarioExplorer` used to for
   * the whole metric at once. Optional so `UnavailableScorePlot`'s early
   * return (no geometry at all) never has to thread them through. */
  metric: ChancesMetric;
  profile: ChancesScenarioInput;
  scenario: ChancesScenarioInput;
  onScenarioChange: (next: ChancesScenarioInput) => void;
};

export function AcademicComparisonPlot({
  lane,
  title,
  testPolicy,
  periodBaseline,
  metric,
  profile,
  scenario,
  onScenarioChange,
}: AcademicComparisonPlotProps): React.ReactElement {
  const markers = scoreMarkers(lane);
  const summary = scoreSummary(title, lane, markers, testPolicy);
  /* ACT is the sole lane with its own number row (`actNumberCells` in
   * SchoolChancesPanel.tsx, always rendered alongside this component for
   * the ACT tab); SAT's two lanes have no equivalent row yet (plan §4). */
  const isSingleLane = lane.key === "composite";
  const baseline =
    periodBaseline !== undefined ? periodBaseline : lanePeriodBaseline(lane);
  const bandPeriod = divergentPeriod(lane.band?.reportedPeriod, baseline);
  const distributionPeriod = divergentPeriod(
    lane.distribution?.reportedPeriod,
    baseline,
  );
  const averagePeriod = divergentPeriod(lane.average?.reportedPeriod, baseline);

  if (!hasScoreGeometry(lane)) {
    return <UnavailableScorePlot lane={lane} summary={summary} title={title} />;
  }

  const domain = SCORE_DOMAINS[lane.key];
  const plotMetric: PlotWindowMetric = lane.key === "composite" ? "act" : "sat";
  const window = plotWindow(
    plotMetric,
    domain,
    drawnValues(lane),
    lane.scenario?.value ?? lane.profile.value ?? null,
  );
  const kind = selectClassShapeKind({
    distributionUsable: lane.distributionState.usable,
    band: lane.band,
    average: lane.average ? { value: Number(lane.average.value) } : null,
  });
  const plotHeight = kind ? CLASS_SHAPE_HEIGHT[kind] : CLASS_SHAPE_HEIGHT.rail;
  const sumsTo = lane.distribution?.sumsTo;
  /* The plot is a slider only where there is something honest to compare
   * against (plan §5's "no comparison scale" guard) — an average alone was
   * already excluded from the old `ScenarioExplorer`'s `laneIsComparable`,
   * and stays excluded here. */
  const comparable = lane.distributionState.usable || lane.bandState.usable;
  /* The control is interactive only where a scenario COULD land on this
   * chart. `comparable` alone lets an incompatible saved value (a score
   * outside the instrument's own domain) still get a working `role="slider"`
   * that scrubs freely while the verdict sentence never moves — see
   * `GpaComparison.tsx`'s identical `interactive` guard for the GPA lane's
   * own version of this. */
  const interactive =
    comparable && lane.profile.state !== "incompatible_profile_value";
  const laneKey: ScenarioLane = lane.key;
  const laneConfig = laneConfigs(metric, profile, scenario).find(
    (candidate) => candidate.key === laneKey,
  );
  const savedValue = profileValue(metric, laneKey, profile);
  const scenarioValue = profileValue(metric, laneKey, scenario);
  /* The mark shows the raw saved or scenario value, off-grid or not — never
   * `laneConfig.seed`, which exists purely to seed on-grid interaction and
   * silently drops an off-grid saved value (e.g. a 3.825 GPA) to `null`.
   * `GpaComparison.tsx`'s FIX 1 made this same call for the old static
   * marks; the interactive mark keeps it. */
  const displayValue = scenarioValue ?? savedValue;
  const offGrid =
    displayValue !== null && laneConfig ? !onGrid(displayValue, laneConfig) : false;
  const secondaryMarkers = comparable
    ? markers.filter((marker) => marker.variant === "saved")
    : markers;
  const ariaLabel =
    lane.key === "composite"
      ? "ACT composite"
      : lane.key === "math"
        ? "SAT Math"
        : "SAT Reading and Writing";

  return (
    <section
      aria-labelledby={`score-lane-${lane.key}`}
      data-slot="academic-comparison-lane"
    >
      <h3
        className={cn("font-medium text-foreground")}
        id={`score-lane-${lane.key}`}
      >
        {title}
      </h3>
      <div className={cn("relative flex flex-col gap-2")} data-slot="academic-comparison-plot">
        <ChartFigure summary={summary}>
          <div className={cn("flex flex-col gap-2")}>
            {/* FIX 4: reserves the room `YouMark`'s pill escapes into above
             * the plot box, so it lands in empty space instead of the
             * heading above. The plot box itself keeps its exact
             * `plotHeight`. */}
            <div style={{ paddingTop: YOU_MARK_PILL_CLEARANCE }}>
              <div className={cn("relative")} style={{ height: plotHeight }}>
                <ClassShape
                  average={lane.average ? { value: Number(lane.average.value) } : null}
                  band={lane.band}
                  distribution={lane.distribution}
                  distributionUsable={lane.distributionState.usable}
                  metric={plotMetric}
                  window={window}
                />
                {secondaryMarkers.map((marker) => (
                  <YouMark
                    display={String(marker.value)}
                    key={`${marker.variant}-${marker.value}`}
                    value={marker.value}
                    variant={marker.variant}
                    window={window}
                  />
                ))}
              </div>
            </div>
            <AxisEndpointLabels window={window} />
          </div>
        </ChartFigure>
        {/* The interactive layer sits OUTSIDE `ChartFigure`'s aria-hidden
         * decorative box (plan §5): a `role="slider"` control has to be
         * reachable by keyboard and assistive tech, which `ChartFigure`
         * deliberately hides everything inside from (its sr-only
         * `figcaption` is the accessible channel for the shape). Positioned
         * to land exactly over the same plot box `ClassShape` drew above. */}
        {interactive && laneConfig ? (
          <div
            className={cn("absolute inset-x-0")}
            style={{ top: YOU_MARK_PILL_CLEARANCE, height: plotHeight }}
          >
            <ScrubbablePlot
              ariaLabel={ariaLabel}
              ariaValueText={(next) =>
                scenarioSetCopy(
                  metric,
                  next,
                  laneKey === "math" || laneKey === "ebrw" ? laneKey : undefined,
                )
              }
              formatDisplay={String}
              height={plotHeight}
              lane={laneConfig}
              onScenarioChange={(next) =>
                onScenarioChange(
                  next === null
                    ? withoutLane(scenario, laneKey)
                    : withChangedLane(scenario, profile, metric, laneKey, next),
                )
              }
              savedValue={savedValue}
              value={displayValue}
              window={window}
            />
          </div>
        ) : null}
        <div className={cn("flex flex-col gap-2")}>
          {interactive ? <ScrubAffordanceHint /> : null}
          {interactive && offGrid ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              {offGridCopy(metric, laneConfig!.step)}
            </p>
          ) : null}
          {/* Visible restatement of what `ChartFigure`'s sr-only summary
           * already says — DESIGN.md §15.5 requires an absent or
           * incompatible value to state its absence on screen, not only to
           * a screen reader. Mirrors `GpaComparison.tsx`'s
           * `gpaProfileMessage` treatment so the two paths stay symmetric.
           * FIX 2: for ACT (the one lane with its own number row) this is
           * pure duplication of the row's "Middle 50%" cell, so it is
           * skipped there; SAT has no number row of its own, so it stays
           * the only place this fact is stated visibly. */}
          {lane.band === null && !isSingleLane ? (
            <p
              className={cn("text-xs text-[var(--school-fact-absent)]")}
              data-band-state={lane.bandState.state}
            >
              {lane.bandState.display ?? "Middle 50% not available"}
            </p>
          ) : null}
          {/* A per-field period only prints when it diverges from what the
           * rest of this screen reports — plan §6's differing-period
           * exception. The common case (every field on the same reporting
           * cycle) collapses into the one header freshness line instead. */}
          {bandPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported band {bandPeriod}
            </p>
          ) : null}
          {distributionPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {distributionPeriod}
            </p>
          ) : null}
          {averagePeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported average {averagePeriod}
            </p>
          ) : null}
          {isSumsToMaterial(sumsTo) ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              {partialDistributionSummaryText(sumsTo)}
            </p>
          ) : null}
          {profilePlacementMessage(lane) ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              {profilePlacementMessage(lane)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function UnavailableScorePlot({
  lane,
  title,
  summary,
}: Pick<AcademicComparisonPlotProps, "lane" | "title"> & {
  summary: string;
}): React.ReactElement {
  /* FIX 2: ACT is the sole lane with its own number row, which already
   * states both "Middle 50%" and "Reported average" as absent when this
   * whole-lane fallback fires — so its own copy of the same fact, and the
   * fourth naming of "ACT" the heading added on top of the tab, the verdict
   * sentence and the row's cell labels, are both dropped here. SAT has no
   * number row and no lane heading is redundant with anything else, so
   * neither change applies there. */
  const isSingleLane = lane.key === "composite";
  const fallback = `No reported ${title === "Composite" ? "ACT" : title} comparison data.`;
  const display = schoolFactDisplay(lane, fallback);
  const showBandStatus =
    !isSingleLane && lane.band === null && lane.bandState.display !== display;
  return (
    <section
      aria-labelledby={isSingleLane ? undefined : `score-lane-${lane.key}`}
      data-slot="academic-comparison-lane"
    >
      {isSingleLane ? null : (
        <h3
          className={cn("font-medium text-foreground")}
          id={`score-lane-${lane.key}`}
        >
          {title}
        </h3>
      )}
      <ChartFigure summary={summary}>
        <div
          className={cn("flex flex-col gap-2")}
          data-slot="academic-comparison-unavailable"
        >
          {isSingleLane ? null : (
            <p
              className={cn("text-sm text-[var(--school-fact-absent)]")}
              data-school-state={lane.school.state}
            >
              {display}
            </p>
          )}
          {/* Nothing else is reported for this lane, so there is nothing to
           * diverge from or collapse into — this stays unconditional. */}
          {lane.school.reportedPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {lane.school.reportedPeriod}
            </p>
          ) : null}
          {showBandStatus ? (
            <p
              className={cn("text-xs text-[var(--school-fact-absent)]")}
              data-band-state={lane.bandState.state}
            >
              {lane.bandState.display ?? "Middle 50% not available"}
            </p>
          ) : null}
          {showBandStatus && lane.bandState.reportedPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {lane.bandState.reportedPeriod}
            </p>
          ) : null}
          {profilePlacementMessage(lane) ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              {profilePlacementMessage(lane)}
            </p>
          ) : null}
        </div>
      </ChartFigure>
    </section>
  );
}

/** A single lane's own dominant period, used only when the caller (ACT, one
 * lane) doesn't pass a cross-lane baseline — the same three fact sources
 * `AcademicComparisonPlot`'s own has-geometry branch compares. */
function lanePeriodBaseline(lane: ScoreLaneModel): string | null {
  return dominantReportedPeriod([
    lane.band?.reportedPeriod,
    lane.distribution?.reportedPeriod,
    lane.average?.reportedPeriod,
  ]);
}

type ScorePlotMarker = {
  value: number;
  variant: "you" | "scenario" | "saved";
};

/**
 * The marks to draw over the shape: the saved profile alone when there is no
 * differing scenario, or the scenario as the primary mark plus the saved
 * value as a dashed reference when there is (plan §2.2) — three marks on the
 * plot at most, down from five.
 */
function scoreMarkers(lane: ScoreLaneModel): ScorePlotMarker[] {
  const profile = lane.profile.value;
  const scenario = lane.scenario?.value ?? null;
  if (scenario !== null && scenario !== profile) {
    return [
      ...(profile === null ? [] : [{ value: profile, variant: "saved" as const }]),
      { value: scenario, variant: "scenario" as const },
    ];
  }
  return profile === null ? [] : [{ value: profile, variant: "you" as const }];
}

/** Every value the shape actually draws, folded into the axis window. */
function drawnValues(lane: ScoreLaneModel): number[] {
  const values: number[] = [];
  if (lane.distributionState.usable && lane.distribution) {
    for (const bucket of lane.distribution.buckets) {
      if (bucket.pct === null || bucket.range === null) continue;
      if (Number.isFinite(bucket.range.lo)) values.push(bucket.range.lo);
      if (Number.isFinite(bucket.range.hi)) values.push(bucket.range.hi);
    }
  }
  if (lane.band) values.push(lane.band.p25, lane.band.p75);
  if (lane.average) values.push(Number(lane.average.value));
  if (lane.profile.value !== null) values.push(lane.profile.value);
  return values;
}

/** The literal, unscaled bucket-by-bucket breakdown sentence — every
 * reported and omitted bucket by label, exactly as `gpaSummary` does for the
 * GPA tab. Its own function only because `scoreSummary` ran over the 50-line
 * budget; behaviour is unchanged, this is a straight extraction. */
function formatDistributionBreakdown(lane: ScoreLaneModel): string {
  return (
    lane.distribution?.buckets
      .map(
        (bucket) =>
          `${bucket.label}: ${bucket.pct === null ? (bucket.absenceDisplay ?? "not reported") : `${bucket.pct}%`}`,
      )
      .concat(
        lane.distribution.omittedBuckets.map(
          (bucket) => `${bucket.label}: ${bucket.display}`,
        ),
      )
      .join("; ") ?? "No reported breakdown."
  );
}

function scoreSummary(
  title: string,
  lane: ScoreLaneModel,
  markers: ScorePlotMarker[],
  testPolicy?: ScalarModel,
): string {
  const distribution = formatDistributionBreakdown(lane);
  const band = lane.band
    ? `Middle 50% is ${lane.band.p25} to ${lane.band.p75}${lane.band.reportedPeriod ? ` (reported ${lane.band.reportedPeriod})` : ""}.`
    : `${lane.bandState.display ?? "Middle 50% unavailable"} (${lane.bandState.state}).`;
  const average = lane.average
    ? `Reported average is ${lane.average.display}${lane.average.reportedPeriod ? ` (reported ${lane.average.reportedPeriod})` : ""}.`
    : "No reported average.";
  const student = markers.length
    ? markers.map((marker) => `${markerLabel(marker)} ${marker.value}.`).join(" ")
    : (profilePlacementMessage(lane) ?? "No student score is plotted.");
  const period = lane.distribution?.reportedPeriod
    ? ` Reported distribution period: ${lane.distribution.reportedPeriod}.`
    : "";
  const policy = testPolicy
    ? ` Testing policy: ${testPolicy.display}${testPolicy.reportedPeriod ? ` (reported ${testPolicy.reportedPeriod})` : ""}.`
    : "";
  const distributionCaveat =
    lane.distributionState.state === "distribution_unscaled"
      ? " Reported breakdown is not plotted to scale."
      : lane.distributionState.state !== "school_value"
        ? ` Distribution: ${lane.distributionState.display ?? "unavailable"} (${lane.distributionState.state}).`
        : "";
  const partialDistribution = partialDistributionSummaryText(
    lane.distribution?.sumsTo,
  );
  const partialCaveat = partialDistribution ? ` ${partialDistribution}` : "";
  const comparison = lane.profile.comparison
    ? ` Profile comparison: ${lane.profile.comparison.state}.`
    : "";
  // FIX 5: the axis is windowed to the data (plan §2.4), and the mitigation
  // that permits that crop is that the accessible summary always states the
  // real, uncropped instrument scale — additive, never a replacement for
  // anything above.
  const domain = SCORE_DOMAINS[lane.key];
  const instrument = lane.key === "composite" ? "ACT" : "SAT";
  const fullScale = ` On the ${domain.min}–${domain.max} ${instrument} scale.`;
  return `${title}. ${band} ${average} ${student}${comparison} Reported breakdown: ${distribution}.${period}${partialCaveat}${distributionCaveat}${policy}${fullScale}`;
}

function markerLabel(marker: ScorePlotMarker): string {
  if (marker.variant === "scenario") return "Scenario";
  if (marker.variant === "saved") return "Your profile";
  return "You";
}

function hasScoreGeometry(lane: ScoreLaneModel): boolean {
  return (
    lane.band !== null || lane.average !== null || lane.distributionState.usable
  );
}
