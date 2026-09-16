import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import { cn } from "@/lib/utils";

import {
  AxisEndpointLabels,
  ClassShape,
  CLASS_SHAPE_HEIGHT,
  selectClassShapeKind,
  YOU_MARK_PILL_CLEARANCE,
} from "./ClassShape";
import { YouMark } from "./YouMark";
import { plotWindow, type PlotWindowMetric } from "./academic-comparison-geometry";
import { ScoreBreakdown } from "./ScoreBreakdown";
import {
  partialDistributionCaveat,
  profilePlacementMessage,
  schoolFactDisplay,
} from "./score-plot-copy";
import {
  SCORE_DOMAINS,
  type ScalarModel,
  type ScoreLaneModel,
} from "./school-chances-model";

type AcademicComparisonPlotProps = {
  lane: ScoreLaneModel;
  title: string;
  testPolicy?: ScalarModel;
};

export function AcademicComparisonPlot({
  lane,
  title,
  testPolicy,
}: AcademicComparisonPlotProps): React.ReactElement {
  const markers = scoreMarkers(lane);
  const summary = scoreSummary(title, lane, markers, testPolicy);

  if (!hasScoreGeometry(lane))
    return <UnavailableScorePlot lane={lane} summary={summary} title={title} />;

  const domain = SCORE_DOMAINS[lane.key];
  const metric: PlotWindowMetric = lane.key === "composite" ? "act" : "sat";
  const window = plotWindow(
    metric,
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
      <ChartFigure summary={summary}>
        <div className={cn("flex flex-col gap-2")} data-slot="academic-comparison-plot">
          {/* FIX 4: reserves the room `YouMark`'s pill escapes into above the
           * plot box, so it lands in empty space instead of the heading
           * above. The plot box itself keeps its exact `plotHeight`. */}
          <div style={{ paddingTop: YOU_MARK_PILL_CLEARANCE }}>
            <div className={cn("relative")} style={{ height: plotHeight }}>
              <ClassShape
                average={lane.average ? { value: Number(lane.average.value) } : null}
                band={lane.band}
                distribution={lane.distribution}
                distributionUsable={lane.distributionState.usable}
                metric={metric}
                window={window}
              />
              {markers.map((marker) => (
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
          <ScoreBreakdown lane={lane} />
          {/* Visible restatement of what `ChartFigure`'s sr-only summary
           * already says — DESIGN.md §15.5 requires an absent or
           * incompatible value to state its absence on screen, not only to
           * a screen reader. Mirrors `GpaComparison.tsx`'s
           * `gpaProfileMessage` treatment so the two paths stay symmetric. */}
          {lane.band === null ? (
            <p
              className={cn("text-xs text-[var(--school-fact-absent)]")}
              data-band-state={lane.bandState.state}
            >
              {lane.bandState.display ?? "Middle 50% unavailable"}
            </p>
          ) : null}
          {lane.band?.reportedPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported band {lane.band.reportedPeriod}
            </p>
          ) : null}
          {lane.average?.reportedPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported average {lane.average.reportedPeriod}
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

function UnavailableScorePlot({
  lane,
  title,
  summary,
}: AcademicComparisonPlotProps & { summary: string }): React.ReactElement {
  const fallback = `No reported ${title === "Composite" ? "ACT" : title} comparison data.`;
  const display = schoolFactDisplay(lane, fallback);
  const showBandStatus =
    lane.band === null && lane.bandState.display !== display;
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
      <ChartFigure summary={summary}>
        <div
          className={cn("flex flex-col gap-2")}
          data-slot="academic-comparison-unavailable"
        >
          <p
            className={cn("text-sm text-[var(--school-fact-absent)]")}
            data-school-state={lane.school.state}
          >
            {display}
          </p>
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
              {lane.bandState.display ?? "Middle 50% unavailable"}
            </p>
          ) : null}
          {showBandStatus && lane.bandState.reportedPeriod ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {lane.bandState.reportedPeriod}
            </p>
          ) : null}
          <ScoreBreakdown lane={lane} />
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

function scoreSummary(
  title: string,
  lane: ScoreLaneModel,
  markers: ScorePlotMarker[],
  testPolicy?: ScalarModel,
): string {
  const distribution =
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
      .join("; ") ?? "No reported breakdown.";
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
  const partialDistribution = partialDistributionCaveat(lane);
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
