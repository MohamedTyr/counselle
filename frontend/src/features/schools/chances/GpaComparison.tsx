import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import { cn } from "@/lib/utils";

import {
  AxisEndpointLabels,
  AxisOnly,
  ClassShape,
  CLASS_SHAPE_HEIGHT,
  YOU_MARK_PILL_CLEARANCE,
} from "./ClassShape";
import { YouMark } from "./YouMark";
import { plotWindow } from "./academic-comparison-geometry";
import type { GpaModel } from "./school-chances-model";

/** GPA has one fixed instrument scale — the 4.0 scale this whole tab is
 * scoped to (school-chances-model.ts's `gpaProfile` rejects anything else). */
const GPA_DOMAIN = { min: 0, max: 4 };

export function GpaComparison({
  model,
}: {
  model: GpaModel;
}): React.ReactElement {
  const distribution = model.distribution;
  const changed =
    model.scenario !== null && model.scenario.value !== model.profile.value;
  const profileMarker = profileMarkerLabel(model, changed);
  const scenarioMarker =
    changed && model.scenario ? scenarioMarkerLabel(model) : null;
  const summary = gpaSummary(model, profileMarker, scenarioMarker);

  if (!distribution || !model.distributionState.usable) {
    return <GpaFallback model={model} summary={summary} />;
  }

  const window = plotWindow(
    "gpa",
    GPA_DOMAIN,
    drawnValues(distribution),
    model.scenario?.value ?? model.profile.value ?? null,
  );
  const markers = gpaMarkers(model);

  return (
    <ChartFigure summary={summary}>
      <div className={cn("flex flex-col gap-3")} data-slot="gpa-comparison">
        {/* FIX 4: reserves the room `YouMark`'s pill escapes into above the
         * plot box, so it lands in empty space instead of the heading
         * above. The plot box itself keeps its exact stepped height. */}
        <div style={{ paddingTop: YOU_MARK_PILL_CLEARANCE }}>
          <div className={cn("relative")} style={{ height: CLASS_SHAPE_HEIGHT.stepped }}>
            <ClassShape
              band={null}
              distribution={distribution}
              distributionUsable={model.distributionState.usable}
              metric="gpa"
              window={window}
            />
            {markers.map((marker) => (
              <YouMark
                display={marker.display}
                key={marker.variant}
                value={marker.value}
                variant={marker.variant}
                window={window}
              />
            ))}
          </div>
        </div>
        <AxisEndpointLabels format={(value) => value.toFixed(2)} window={window} />
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

type GpaPlotMarker = {
  value: number;
  display: string;
  variant: "you" | "scenario" | "saved";
};

/**
 * Positions the student's mark directly by its numeric GPA value on the
 * continuous windowed axis — simpler than, and a strict improvement on, the
 * old bucket-label lookup this replaces: it places a value even when the
 * value falls outside every reported bucket, which the old system could only
 * render as an edge callout.
 */
function gpaMarkers(model: GpaModel): GpaPlotMarker[] {
  const profile = model.profile.value;
  const scenario = model.scenario?.value ?? null;
  if (scenario !== null && scenario !== profile) {
    return [
      ...(profile === null
        ? []
        : [{ value: profile, display: model.profile.display ?? String(profile), variant: "saved" as const }]),
      { value: scenario, display: String(scenario), variant: "scenario" as const },
    ];
  }
  return profile === null
    ? []
    : [{ value: profile, display: model.profile.display ?? String(profile), variant: "you" as const }];
}

function drawnValues(distribution: NonNullable<GpaModel["distribution"]>): number[] {
  const values: number[] = [];
  for (const bucket of distribution.buckets) {
    if (bucket.pct === null || bucket.range === null) continue;
    if (Number.isFinite(bucket.range.lo)) values.push(bucket.range.lo);
    if (Number.isFinite(bucket.range.hi)) values.push(bucket.range.hi);
  }
  return values;
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
        <AxisOnly />
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
      : model.profile.comparison?.state === "below_reported_buckets" &&
          model.profile.display
        ? `Your ${model.profile.display} GPA is below the reported buckets.`
        : model.profile.comparison?.state === "above_reported_buckets" &&
            model.profile.display
          ? `Your ${model.profile.display} GPA is above the reported buckets.`
          : profile
            ? `${profile}.`
            : (gpaProfileMessage(model) ??
              "No compatible student GPA is plotted.");
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
  // FIX 5: same mitigation as the score lanes' `scoreSummary` — the windowed
  // axis is only permissible because the accessible summary always states
  // the real, uncropped instrument scale. Additive.
  const fullScale = ` On the ${GPA_DOMAIN.min}–${GPA_DOMAIN.max} GPA scale.`;
  return `GPA comparison. ${placement} ${scenario ? `${scenario}.` : ""} Profile comparison: ${model.profile.comparison?.state ?? model.profile.state}. Reported buckets: ${buckets}.${model.distribution?.reportedPeriod ? ` Reported distribution period: ${model.distribution.reportedPeriod}.` : ""}${total}${average}${distributionCaveat}${fullScale}`;
}

function gpaProfileMessage(model: GpaModel): string | null {
  if (model.profile.state === "missing_profile_value")
    return "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.";
  if (model.profile.state === "incompatible_profile_value")
    return "Your GPA uses a different scale and cannot be placed on this 4.0-scale chart.";
  return null;
}

function profileMarkerLabel(model: GpaModel, changed: boolean): string | null {
  if (
    model.profile.state !== "value" ||
    model.profile.value === null ||
    model.profile.comparison?.state === "unplaceable_profile_value"
  )
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
