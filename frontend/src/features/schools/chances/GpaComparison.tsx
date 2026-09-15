import { Bar, BarChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import { cn } from "@/lib/utils";

import {
  calloutLayout,
  useMeasuredPlotWidth,
  type CalloutLayout,
} from "./academic-comparison-geometry";
import type { GpaModel } from "./school-chances-model";

const CHART_CONFIG = {
  reported: {
    label: "Reported entering-class distribution",
    color: "var(--school-chances-mark)",
  },
} as const;

export function GpaComparison({
  model,
  availableWidth,
}: {
  model: GpaModel;
  /** Deterministic measurement seam for visual tests. */
  availableWidth?: number;
}): React.ReactElement {
  const [plotRef, measuredWidth] =
    useMeasuredPlotWidth<HTMLDivElement>(availableWidth);
  const distribution = model.distribution;
  const changed =
    model.scenario !== null && model.scenario.value !== model.profile.value;
  const profileMarker = profileMarkerLabel(model, changed);
  const scenarioMarker =
    changed && model.scenario ? scenarioMarkerLabel(model) : null;
  const summary = gpaSummary(model, profileMarker, scenarioMarker);

  if (!distribution || model.distributionState.state !== "school_value") {
    return <GpaFallback model={model} summary={summary} />;
  }

  const data = distribution.buckets.map((bucket) => ({
    label: bucket.label,
    /* A reported zero gets a visible tick; an absent bucket stays a gap. */
    plotPct: bucket.pct === null ? 0 : bucket.pct === 0 ? 0.5 : bucket.pct,
  }));
  const callouts = gpaCallouts(
    distribution.buckets.map((bucket) => bucket.label),
    profileMarker,
    scenarioMarker,
    model,
  );
  const layout = calloutLayout(
    callouts.map((callout) => callout.position),
    measuredWidth,
  );
  return (
    <ChartFigure summary={summary}>
      <div
        className={cn("flex flex-col gap-3")}
        data-slot="gpa-comparison"
        ref={plotRef}
      >
        <div className={cn("relative")} data-slot="gpa-comparison-plot">
          <GpaMarkerRail callouts={callouts} layout={layout} />
          <div className={cn("relative")}>
            <ChartContainer
              className={cn("h-44 min-h-44 w-full")}
              config={CHART_CONFIG}
              data-slot="gpa-comparison-chart"
            >
              <BarChart
                data={data}
                margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
              >
                <XAxis dataKey="label" hide />
                <YAxis domain={[0, 100]} hide />
                <Bar
                  dataKey="plotPct"
                  fill="var(--school-chances-mark)"
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
                <GpaChartMarker
                  model={model}
                  variant={changed ? "profile" : "you"}
                />
                <GpaChartMarker model={model} variant="scenario" />
              </BarChart>
            </ChartContainer>
            <GpaEdgeTicks callouts={callouts} />
          </div>
        </div>
        <div
          className={cn("grid gap-2 sm:grid-cols-3")}
          data-slot="gpa-comparison-buckets"
        >
          {[
            ...distribution.buckets,
            ...distribution.omittedBuckets.map((bucket) => ({
              ...bucket,
              pct: null,
              absenceDisplay: bucket.display,
            })),
          ].map((bucket) => (
            <div
              className={cn(
                "border-t border-[var(--school-chances-divider)] pt-1.5 text-xs",
              )}
              key={bucket.label}
            >
              <p className={cn("font-medium text-foreground")}>
                {bucket.label}
              </p>
              <p
                className={cn("text-[var(--school-fact-caveat)] tabular-nums")}
              >
                {bucket.pct === null
                  ? `${bucket.label}: ${bucket.absenceDisplay ?? "Not reported"}`
                  : `${bucket.pct}%`}
              </p>
            </div>
          ))}
        </div>
        {gpaProfileMessage(model) ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            {gpaProfileMessage(model)}
          </p>
        ) : null}
        {distribution.reportedPeriod ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            Reported {distribution.reportedPeriod}
          </p>
        ) : null}
        {distribution.sumsTo !== null &&
        Math.abs(distribution.sumsTo - 100) > 0.5 ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            Reported buckets total {distribution.sumsTo}%; missing buckets are
            not treated as zero.
          </p>
        ) : null}
      </div>
    </ChartFigure>
  );
}

function GpaChartMarker({
  model,
  variant,
}: {
  model: GpaModel;
  variant: "profile" | "scenario" | "you";
}): React.ReactElement | null {
  const comparison =
    variant === "scenario"
      ? model.scenario?.comparison
      : model.profile.comparison;
  /* Out-of-span values are callouts at a true plot edge, never bucket centres. */
  if (
    comparison?.state === "below_reported_buckets" ||
    comparison?.state === "above_reported_buckets"
  )
    return null;
  const category = comparison?.label;
  if (!category) return null;
  return (
    <ReferenceLine
      ifOverflow="extendDomain"
      stroke="var(--school-chances-profile-outline)"
      strokeDasharray={variant === "profile" ? "3 2" : undefined}
      strokeWidth={variant === "profile" ? 2 : 3}
      x={category}
    />
  );
}

function GpaFallback({
  model,
  summary,
}: {
  model: GpaModel;
  summary: string;
}): React.ReactElement {
  const display = model.average
    ? `Reported average ${model.average.display}`
    : (model.distributionState.display ?? "No reported GPA comparison data.");
  return (
    <ChartFigure summary={summary}>
      <div
        className={cn("flex flex-col gap-1")}
        data-slot="gpa-comparison-unavailable"
      >
        <p
          className={cn("text-sm text-[var(--school-fact-absent)]")}
          data-school-state={model.distributionState.state}
        >
          {display}
        </p>
        {(model.average?.reportedPeriod ??
        model.distributionState.reportedPeriod) ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            Reported{" "}
            {model.average?.reportedPeriod ??
              model.distributionState.reportedPeriod}
          </p>
        ) : null}
        {model.profile.state === "incompatible_profile_value" ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            Your GPA uses a different scale and cannot be placed on this
            4.0-scale chart.
          </p>
        ) : null}
      </div>
    </ChartFigure>
  );
}

type GpaCallout = {
  label: string;
  position: number;
  placement: "below-edge" | "above-edge" | undefined;
  variant: "profile" | "scenario" | "you";
};

function GpaMarkerRail({
  callouts,
  layout,
}: {
  callouts: GpaCallout[];
  layout: CalloutLayout;
}): React.ReactElement | null {
  if (!callouts.length) return null;
  return (
    <div
      className={cn(
        "relative text-xs font-medium tabular-nums",
        layout === "value-row"
          ? "flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--school-chances-divider)] pt-2"
          : "h-14",
      )}
      data-callout-layout={layout}
      data-slot="gpa-comparison-markers"
      data-testid="gpa-marker-rail"
    >
      {layout === "rail" ? (
        <svg
          aria-hidden="true"
          className={cn("absolute inset-0 h-full w-full")}
          data-slot="gpa-comparison-callout-leaders"
          preserveAspectRatio="none"
          viewBox="0 0 100 56"
        >
          {callouts.map((callout, index) => (
            <path
              d={`M 50 ${index === 0 ? 14 : 38} H ${callout.position * 100} V 56`}
              fill="none"
              key={`${callout.variant}-${callout.label}`}
              stroke="var(--school-chances-profile-outline)"
              strokeWidth="1"
            />
          ))}
        </svg>
      ) : null}
      {callouts.map((callout, index) => (
        <span
          className={cn(
            layout === "separate" && "absolute",
            layout === "rail" &&
              (index === 0
                ? "absolute left-1/2 top-0 -translate-x-1/2"
                : "absolute left-1/2 top-6 -translate-x-1/2"),
          )}
          data-placement={callout.placement}
          key={`${callout.variant}-${callout.label}`}
          style={
            layout === "separate" ? calloutStyle(callout.position) : undefined
          }
        >
          {callout.label}
        </span>
      ))}
    </div>
  );
}

/** Outside values live at a true edge rather than a neighboring bucket. */
function GpaEdgeTicks({
  callouts,
}: {
  callouts: GpaCallout[];
}): React.ReactElement | null {
  const edges = callouts.filter((callout) => callout.placement !== undefined);
  if (!edges.length) return null;
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0")}
      data-slot="gpa-comparison-edge-marks"
    >
      {edges.map((callout) => (
        <span
          className={cn(
            "absolute inset-y-0 border-l border-[var(--school-chances-profile-outline)]",
            callout.placement === "below-edge" ? "left-0" : "right-0",
            callout.variant === "profile" && "border-dashed",
            callout.variant === "scenario" && "border-l-2",
          )}
          data-placement={callout.placement}
          key={`${callout.variant}-${callout.label}`}
        />
      ))}
    </div>
  );
}

function profileMarkerLabel(model: GpaModel, changed: boolean): string | null {
  if (model.profile.state !== "value" || model.profile.value === null)
    return null;
  if (model.profile.comparison?.state === "unplaceable_profile_value")
    return null;
  if (model.profile.comparison?.state === "below_reported_buckets")
    return "Below reported buckets";
  if (model.profile.comparison?.state === "above_reported_buckets")
    return "Above reported buckets";
  return `${changed ? "Your profile" : "You"} ${model.profile.display}`;
}

function scenarioMarkerLabel(model: GpaModel): string | null {
  if (
    !model.scenario ||
    model.scenario.comparison?.state === "unplaceable_profile_value"
  )
    return null;
  if (model.scenario.comparison?.state === "below_reported_buckets")
    return "Scenario below reported buckets";
  if (model.scenario.comparison?.state === "above_reported_buckets")
    return "Scenario above reported buckets";
  return `Scenario ${model.scenario.value}`;
}

function gpaCallouts(
  bucketLabels: string[],
  profile: string | null,
  scenario: string | null,
  model: GpaModel,
): GpaCallout[] {
  const callout = (
    label: string | null,
    comparison: GpaModel["profile"]["comparison"],
    variant: GpaCallout["variant"],
  ): GpaCallout | null => {
    if (!label || !comparison) return null;
    const placement = edgePlacement(label);
    if (placement === "below-edge")
      return { label, position: 0, placement, variant };
    if (placement === "above-edge")
      return { label, position: 1, placement, variant };
    const index = bucketLabels.indexOf(comparison.label ?? "");
    if (index < 0) return null;
    return {
      label,
      position: (index + 0.5) / bucketLabels.length,
      placement,
      variant,
    };
  };
  return [
    callout(
      profile,
      model.profile.comparison,
      profile?.startsWith("You ") ? "you" : "profile",
    ),
    callout(scenario, model.scenario?.comparison ?? null, "scenario"),
  ].filter((value): value is GpaCallout => value !== null);
}

function calloutStyle(position: number): React.CSSProperties {
  if (position <= 0) return { left: "0%" };
  if (position >= 1) return { left: "100%", transform: "translateX(-100%)" };
  return { left: `${position * 100}%`, transform: "translateX(-50%)" };
}

function gpaSummary(
  model: GpaModel,
  profile: string | null,
  scenario: string | null,
): string {
  const buckets =
    model.distribution?.buckets
      .map(
        (bucket) =>
          `${bucket.label}: ${bucket.pct === null ? (bucket.absenceDisplay ?? "not reported") : `${bucket.pct}%`}`,
      )
      .concat(
        model.distribution.omittedBuckets.map(
          (bucket) => `${bucket.label}: ${bucket.display}`,
        ),
      )
      .join("; ") ?? "No reported GPA distribution.";
  const placement =
    model.profile.comparison?.state === "unplaceable_profile_value"
      ? "Your GPA cannot be placed in the school's published bucket labels."
      : profile
        ? `${profile}.`
        : (gpaProfileMessage(model) ?? "No compatible student GPA is plotted.");
  const average =
    model.schoolSource === "average_fallback" && model.average
      ? ` Reported average fallback: ${model.average.display}${model.average.reportedPeriod ? ` (reported ${model.average.reportedPeriod})` : ""}.`
      : "";
  const distributionCaveat =
    model.distributionState.state !== "school_value"
      ? ` Distribution: ${model.distributionState.display ?? "unavailable"} (${model.distributionState.state}).`
      : "";
  const total =
    model.distribution?.sumsTo !== null &&
    model.distribution &&
    Math.abs(model.distribution.sumsTo - 100) > 0.5
      ? ` Reported buckets total ${model.distribution.sumsTo}%; missing buckets are not treated as zero.`
      : "";
  return `GPA comparison. ${placement} ${scenario ? `${scenario}.` : ""} Profile comparison: ${model.profile.comparison?.state ?? model.profile.state}. Reported buckets: ${buckets}.${model.distribution?.reportedPeriod ? ` Reported distribution period: ${model.distribution.reportedPeriod}.` : ""}${total}${average}${distributionCaveat}`;
}

function edgePlacement(label: string): "below-edge" | "above-edge" | undefined {
  const normalized = label.toLowerCase();
  return normalized.includes("below reported buckets")
    ? "below-edge"
    : normalized.includes("above reported buckets")
      ? "above-edge"
      : undefined;
}

function gpaProfileMessage(model: GpaModel): string | null {
  if (model.profile.state === "missing_profile_value")
    return "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.";
  if (model.profile.state === "incompatible_profile_value")
    return "Your GPA uses a different scale and cannot be placed on this 4.0-scale chart.";
  return null;
}
