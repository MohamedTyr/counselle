import { ComposedChart, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import { cn } from "@/lib/utils";

import {
  calloutLayout,
  endpointLabelLayout,
  scoreDomain,
  scorePosition,
  useMeasuredPlotWidth,
  type CalloutLayout,
} from "./academic-comparison-geometry";
import {
  ScorePlotMarks,
  type ScorePlotMarker,
} from "./academic-comparison-marks";
import type { ScalarModel, ScoreLaneModel } from "./school-chances-model";

type AcademicComparisonPlotProps = {
  lane: ScoreLaneModel;
  title: string;
  testPolicy?: ScalarModel;
  /** Deterministic measurement seam for visual tests. */
  availableWidth?: number;
};

const CHART_CONFIG = {
  band: { label: "Reported middle 50%", color: "var(--school-chances-band)" },
  mark: { label: "Reported distribution", color: "var(--school-chances-mark)" },
} as const;
const POINT = [{ position: 0.5 }];

export function AcademicComparisonPlot({
  lane,
  title,
  testPolicy,
  availableWidth,
}: AcademicComparisonPlotProps): React.ReactElement {
  const [plotRef, measuredWidth] =
    useMeasuredPlotWidth<HTMLDivElement>(availableWidth);
  const markers = scoreMarkers(lane);
  const layout = markerLayout(markers, lane, measuredWidth);
  const summary = scoreSummary(title, lane, markers, testPolicy);

  if (!hasScoreGeometry(lane))
    return <UnavailableScorePlot lane={lane} summary={summary} title={title} />;

  return (
    <ChartFigure summary={summary}>
      <div
        className={cn("flex flex-col gap-2")}
        data-slot="academic-comparison-plot"
        ref={plotRef}
      >
        <div
          className={cn("flex items-baseline justify-between gap-3")}
          data-slot="academic-comparison-heading"
        >
          <h3 className={cn("font-medium text-foreground")}>{title}</h3>
          <span
            className={cn(
              "text-xs text-[var(--school-fact-caveat)] tabular-nums",
            )}
          >
            {scoreDomain(lane).min}–{scoreDomain(lane).max} scale
          </span>
        </div>
        <ScoreCalloutRail lane={lane} layout={layout} markers={markers} />
        <ChartContainer
          className={cn("h-32 min-h-32 w-full sm:h-28 sm:min-h-28")}
          config={CHART_CONFIG}
          data-slot="academic-comparison-chart"
        >
          <ComposedChart
            data={POINT}
            margin={{ top: 8, right: 0, bottom: 8, left: 0 }}
          >
            <XAxis dataKey="position" domain={[0, 1]} hide type="number" />
            <YAxis domain={[0, 100]} hide type="number" />
            <ScorePlotMarks lane={lane} markers={markers} />
          </ComposedChart>
        </ChartContainer>
        <ScoreValueRow
          lane={lane}
          layout={layout}
          markers={markers}
          plotWidth={measuredWidth}
        />
        <ScoreBreakdown lane={lane} />
      </div>
    </ChartFigure>
  );
}

function ScoreCalloutRail({
  lane,
  layout,
  markers,
}: {
  lane: ScoreLaneModel;
  layout: CalloutLayout;
  markers: ScorePlotMarker[];
}): React.ReactElement | null {
  if (!markers.length || layout === "value-row") return null;
  const domain = scoreDomain(lane);
  return (
    <div
      className={cn("relative h-14")}
      data-callout-layout={layout}
      data-slot="academic-comparison-callout-rail"
    >
      <svg
        aria-hidden="true"
        className={cn("absolute inset-0 h-full w-full")}
        data-slot="academic-comparison-callout-leaders"
        preserveAspectRatio="none"
        viewBox="0 0 100 56"
      >
        {layout === "rail"
          ? markers.map((marker, index) => {
              const left =
                scorePosition(marker.value, domain.min, domain.max) * 100;
              const y = index === 0 ? 14 : 38;
              return (
                <path
                  d={`M 50 ${y} H ${left} V 56`}
                  fill="none"
                  key={`${marker.variant}-${marker.value}`}
                  stroke="var(--school-chances-profile-outline)"
                  strokeWidth="1"
                />
              );
            })
          : null}
      </svg>
      {markers.map((marker, index) => {
        const left = scorePosition(marker.value, domain.min, domain.max) * 100;
        return (
          <span
            className={cn(
              "absolute text-xs font-medium tabular-nums",
              layout === "rail" &&
                (index === 0 ? "left-1/2 top-0" : "left-1/2 top-6"),
              layout === "rail" && "-translate-x-1/2",
            )}
            key={`${marker.variant}-${marker.value}`}
            style={
              layout === "separate" ? scoreCalloutStyle(left / 100) : undefined
            }
          >
            {marker.label} {marker.value}
          </span>
        );
      })}
    </div>
  );
}

function scoreCalloutStyle(position: number): React.CSSProperties {
  if (position <= 0) return { left: "0%", transform: "translateX(0)" };
  if (position >= 1) return { left: "100%", transform: "translateX(-100%)" };
  return { left: `${position * 100}%`, transform: "translateX(-50%)" };
}

function ScoreValueRow({
  lane,
  layout,
  markers,
  plotWidth,
}: {
  lane: ScoreLaneModel;
  layout: CalloutLayout;
  markers: ScorePlotMarker[];
  plotWidth: number;
}): React.ReactElement {
  const placement = profilePlacementMessage(lane);
  return (
    <div
      className={cn(
        "grid gap-1 text-xs text-[var(--school-fact-caveat)] sm:grid-cols-[minmax(0,1fr)_auto]",
      )}
      data-slot="academic-comparison-values"
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums",
        )}
        data-slot="academic-comparison-keyed-values"
      >
        <span>{scoreDomain(lane).min}</span>
        {lane.band ? (
          <ScoreBandEndpoints lane={lane} plotWidth={plotWidth} />
        ) : (
          <BandUnavailable lane={lane} />
        )}
        {lane.bandState.reportedPeriod ? (
          <span>Reported {lane.bandState.reportedPeriod}</span>
        ) : null}
        <span>{scoreDomain(lane).max}</span>
        {lane.average ? (
          <>
            <span>Average {lane.average.display}</span>
            {lane.average.reportedPeriod ? (
              <span>Reported {lane.average.reportedPeriod}</span>
            ) : null}
          </>
        ) : null}
      </div>
      {layout === "value-row" ? (
        <div
          className={cn("flex flex-wrap gap-x-3 gap-y-1 tabular-nums")}
          data-callout-layout={layout}
          data-slot="academic-comparison-markers"
        >
          {markers.map((marker) => (
            <span key={`${marker.variant}-${marker.value}`}>
              {marker.label} {marker.value}
            </span>
          ))}
        </div>
      ) : (
        <div
          className={cn("hidden text-xs tabular-nums")}
          data-callout-layout="value-row"
          data-slot="academic-comparison-markers"
          data-value={markers
            .map((marker) => `${marker.label} ${marker.value}`)
            .join(" · ")}
        />
      )}
      {placement ? <p className={cn("sm:col-span-2")}>{placement}</p> : null}
    </div>
  );
}

function BandUnavailable({
  lane,
}: {
  lane: ScoreLaneModel;
}): React.ReactElement {
  return (
    <span data-band-state={lane.bandState.state}>
      {lane.bandState.display ?? "Middle 50% unavailable"}
    </span>
  );
}

function ScoreBandEndpoints({
  lane,
  plotWidth,
}: {
  lane: ScoreLaneModel;
  plotWidth: number;
}): React.ReactElement {
  const band = lane.band!;
  const p25Position = scorePosition(band.p25, band.min, band.max);
  const p75Position = scorePosition(band.p75, band.min, band.max);
  const layout = endpointLabelLayout(p25Position, p75Position, plotWidth);
  return (
    <span
      className={cn("relative h-4 min-w-full")}
      data-band-layout={layout}
      data-slot="academic-comparison-band-endpoints"
    >
      {layout === "middle" ? (
        <span className={cn("absolute left-1/2 -translate-x-1/2")}>
          Middle 50% {band.p25}–{band.p75}
        </span>
      ) : (
        <>
          <span
            className={cn("absolute w-6")}
            data-band-endpoint="p25"
            style={{ left: `${p25Position * 100}%` }}
          >
            {band.p25}
          </span>
          <span
            className={cn("absolute w-6 -translate-x-full text-right")}
            data-band-endpoint="p75"
            style={{ left: `${p75Position * 100}%` }}
          >
            {band.p75}
          </span>
        </>
      )}
    </span>
  );
}

function ScoreBreakdown({
  lane,
}: {
  lane: ScoreLaneModel;
}): React.ReactElement | null {
  const entries = [
    ...(lane.distribution?.buckets ?? []),
    ...(lane.distribution?.omittedBuckets.map((bucket) => ({
      ...bucket,
      pct: null,
      absenceDisplay: bucket.display,
    })) ?? []),
  ];
  if (!entries.length) return null;
  return (
    <div
      className={cn("flex flex-col gap-1")}
      data-slot="academic-comparison-breakdown"
    >
      <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
        Reported breakdown
        {lane.distributionState.state === "distribution_unscaled"
          ? " — not plotted to scale"
          : ""}
      </p>
      <ul className={cn("flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums")}>
        {entries.map((bucket) => (
          <li key={bucket.label}>
            {bucket.label}:{" "}
            {bucket.pct === null
              ? (bucket.absenceDisplay ?? "Not reported")
              : `${bucket.pct}%`}
          </li>
        ))}
      </ul>
      {lane.distribution?.reportedPeriod ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Reported {lane.distribution.reportedPeriod}
        </p>
      ) : null}
    </div>
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
    <ChartFigure summary={summary}>
      <div
        className={cn("flex flex-col gap-2")}
        data-slot="academic-comparison-unavailable"
      >
        <h3 className={cn("font-medium text-foreground")}>{title}</h3>
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
            <BandUnavailable lane={lane} />
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
  );
}

function scoreMarkers(lane: ScoreLaneModel): ScorePlotMarker[] {
  const profile = lane.profile.value;
  const scenario = lane.scenario?.value ?? null;
  if (scenario !== null && scenario !== profile)
    return [
      ...(profile === null
        ? []
        : [
            {
              label: "Your profile",
              value: profile,
              variant: "profile" as const,
            },
          ]),
      { label: "Scenario", value: scenario, variant: "scenario" },
    ];
  return profile === null
    ? []
    : [{ label: "You", value: profile, variant: "you" }];
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
    ? markers.map((marker) => `${marker.label} ${marker.value}.`).join(" ")
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
  const comparison = lane.profile.comparison
    ? ` Profile comparison: ${lane.profile.comparison.state}.`
    : "";
  return `${title}. ${band} ${average} ${student}${comparison} Reported breakdown: ${distribution}.${period}${distributionCaveat}${policy}`;
}

function hasScoreGeometry(lane: ScoreLaneModel): boolean {
  return (
    lane.band !== null || lane.average !== null || lane.distributionState.usable
  );
}
function markerLayout(
  markers: ScorePlotMarker[],
  lane: ScoreLaneModel,
  plotWidth: number,
): CalloutLayout {
  const domain = scoreDomain(lane);
  return calloutLayout(
    markers.map((marker) =>
      scorePosition(marker.value, domain.min, domain.max),
    ),
    plotWidth,
  );
}
function schoolFactDisplay(lane: ScoreLaneModel, fallback: string): string {
  return lane.school.display ?? lane.distributionState.display ?? fallback;
}
function profilePlacementMessage(lane: ScoreLaneModel): string | null {
  const label =
    lane.key === "composite"
      ? "ACT composite"
      : lane.key === "ebrw"
        ? "SAT Reading and Writing score"
        : "SAT Math score";
  if (lane.profile.state === "missing_profile_value")
    return `Add your ${label} to place yourself on this chart.`;
  if (lane.profile.state === "incompatible_profile_value")
    return `Your ${label} cannot be placed on this ${scoreDomain(lane).min}–${scoreDomain(lane).max} chart.`;
  return null;
}
