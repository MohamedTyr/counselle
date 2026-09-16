import * as React from "react";

import { useProfile } from "@/api/workspace/hooks/profile";
import type { Profile } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ActComparison } from "./ActComparison";
import { GpaComparison } from "./GpaComparison";
import { SatComparison } from "./SatComparison";
import { ScenarioExplorer } from "./ScenarioExplorer";
import {
  CHANCES_TRUTH_FOOTER,
  dominantReportedPeriod,
  divergentPeriod,
  metricInterpretation,
} from "./school-chances-copy";
import { NOT_AVAILABLE } from "./score-plot-copy";
import {
  buildSchoolChancesModel,
  type ChancesMetric,
  type ChancesScenarioInput,
  type SchoolChancesModel,
} from "./school-chances-model";
import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";

const METRICS = ["gpa", "sat", "act"] as const;
const METRIC_OPTIONS = [
  { value: "gpa", label: "GPA" },
  { value: "sat", label: "SAT" },
  { value: "act", label: "ACT" },
] as const;

export function SchoolChancesPanel({
  data,
  metricParam,
  onMetricChange,
  profile: profileOverride,
}: {
  data: SchoolFactsResponse;
  metricParam?: string | null;
  onMetricChange?: (metric: ChancesMetric) => void;
  /** Test-only composition seam; production reads the established lazy query. */
  profile?: Profile | null;
}): React.ReactElement {
  const profileQuery = useProfile();
  const isOverride = profileOverride !== undefined;
  const isPending = !isOverride && profileQuery.isPending;
  const isError = !isOverride && profileQuery.isError;
  const profile = isOverride ? profileOverride : profileQuery.data;
  const [scenarios, setScenarios] = React.useState<ChancesScenarioInput>({});
  const visitedMetrics = React.useRef(new Set<ChancesMetric>());
  const markMetricVisited = React.useCallback((metric: ChancesMetric) => {
    visitedMetrics.current.add(metric);
  }, []);
  const defaultMetric = defaultMetricFor(data, profile);
  /* The URL prop is authoritative. When it is absent or invalid the pure
   * default is deterministic; there is deliberately no stale local metric. */
  const metric = isMetric(metricParam) ? metricParam : defaultMetric;
  const model = buildSchoolChancesModel(data, profile, metric, scenarios);

  if (isPending) return <SchoolChancesSkeleton />;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--school-facts-panel-border)] bg-[var(--school-chances-panel-surface)] shadow-[var(--elevation-1)]",
      )}
      data-slot="school-chances-panel"
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4",
        )}
        data-slot="school-chances-header"
      >
        <SegmentedControl
          className={cn("w-full bg-[var(--surface-inset)] sm:w-fit")}
          label="Academic comparison metric"
          onValueChange={(next) => {
            onMetricChange?.(next as ChancesMetric);
          }}
          options={METRIC_OPTIONS}
          value={metric}
        />
        {/* One metadata line: the page's freshness stamp, plus the testing
         * policy beside it (moved out of the body, plan §3). Both are the
         * same 12px muted caveat weight — neither outranks the other. */}
        <div className={cn("flex flex-col items-end gap-0.5 text-right")}>
          {data.freshness_line ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              {data.freshness_line}
            </p>
          ) : null}
          {model.testPolicy ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Testing policy: {model.testPolicy.display}
              {model.testPolicy.reportedPeriod
                ? ` · Reported ${model.testPolicy.reportedPeriod}`
                : ""}
            </p>
          ) : null}
        </div>
      </header>
      <div
        className={cn("flex flex-col gap-4 p-4")}
        data-slot="school-chances-content"
      >
        {isError ? (
          <div
            className={cn("flex flex-wrap items-center justify-between gap-2")}
            role="alert"
          >
            <p className={cn("text-sm text-destructive")}>
              Could not load your profile. The school comparison remains
              available.
            </p>
            <Button
              onClick={() => void profileQuery.refetch()}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {/* The only prose on the screen (plan §3): everything else is either
         * a number or the shape itself. */}
        <p
          className={cn(
            "max-w-[48ch] text-[17px] text-foreground leading-[1.45] text-pretty",
          )}
          data-slot="school-chances-interpretation"
        >
          {metricInterpretation(metric, model, profile?.academics?.gpa_scale)}
        </p>
        {metric === "gpa" ? <NumberRow cells={gpaNumberCells(model)} /> : null}
        {metric === "act" ? <NumberRow cells={actNumberCells(model)} /> : null}
        <MetricPlotReveal
          key={metric}
          metric={metric}
          onRendered={markMetricVisited}
          visitedMetrics={visitedMetrics}
        >
          <ComparisonGraphic metric={metric} model={model} />
        </MetricPlotReveal>
      </div>
      {!isError && hasExplorer(metric, model) ? (
        <ScenarioExplorer
          metric={metric}
          model={model}
          onScenarioChange={setScenarios}
          profile={profileScenario(model)}
          scenario={scenarios}
        />
      ) : null}
      <footer
        className={cn(
          "border-t border-[var(--school-chances-divider)] px-4 py-3 text-xs text-[var(--school-fact-caveat)]",
        )}
        data-slot="school-chances-footer"
      >
        {footerTruth(metric, data, model)}
      </footer>
    </section>
  );
}

/**
 * This is deliberately mounted only with an actual graphic, never with the
 * Profile skeleton. The metric key makes an unseen metric's one-time reveal a
 * fresh mount while a return, refetch, or scenario edit keeps it inert.
 */
function MetricPlotReveal({
  children,
  metric,
  onRendered,
  visitedMetrics,
}: {
  children: React.ReactNode;
  metric: ChancesMetric;
  onRendered: (metric: ChancesMetric) => void;
  visitedMetrics: React.RefObject<Set<ChancesMetric>>;
}): React.ReactElement {
  // Snapshot this once per metric mount. The visited ref is shared by the
  // panel, but must not be allowed to interrupt the active animation when a
  // scenario, refetch, or other parent update rerenders the plot.
  const [shouldReveal] = React.useState(
    () =>
      !visitedMetrics.current.has(metric) &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  React.useEffect(() => {
    onRendered(metric);
  }, [metric, onRendered]);

  return (
    <div
      className={cn(
        shouldReveal &&
          "motion-safe:animate-in motion-safe:fade-in duration-200 ease-out",
      )}
      data-reveal-state={shouldReveal ? "first-visit" : "visited"}
      data-slot="school-chances-plot-reveal"
      data-testid="school-chances-plot-reveal"
    >
      {children}
    </div>
  );
}

function ComparisonGraphic({
  metric,
  model,
}: {
  metric: ChancesMetric;
  model: SchoolChancesModel;
}) {
  if (metric === "gpa") return <GpaComparison model={model.gpa!} />;
  if (metric === "sat")
    return <SatComparison model={model.sat!} testPolicy={model.testPolicy} />;
  return <ActComparison model={model.act!} testPolicy={model.testPolicy} />;
}

type NumberCell = {
  label: string;
  value: string;
  /** Renders the DESIGN.md §15.5 absence treatment — 15px in
   * `--school-value-absent`, never blank, never a dash — instead of the
   * 30px hero figure. */
  absent?: boolean;
  /** Only set when this field's own reported period diverges from the rest
   * of the screen (plan §6's differing-period exception). */
  period?: string | null;
};

/**
 * The three-number row (plan §3): what used to be `ComparisonLedger`'s
 * `<dl>`, now the screen's second-loudest thing after the verdict sentence.
 * Exactly three, no icons, no accent colour on the digits, no cards around
 * them — these numbers *are* the data the screen exists to deliver, not a
 * decorative SaaS hero (plan §3's note on the `impeccable` hero-metric ban).
 * SAT has no equivalent row here: its own two-lane redesign is a later
 * phase (plan §4), so its per-lane numbers still live inside
 * `AcademicComparisonPlot`.
 */
function NumberRow({ cells }: { cells: NumberCell[] }): React.ReactElement {
  return (
    <div
      className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3")}
      data-slot="school-chances-numbers"
    >
      {cells.map((cell, index) => (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1",
            index === 2 && "col-span-2 sm:col-span-1",
          )}
          key={cell.label}
        >
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            {cell.label}
          </p>
          {cell.absent ? (
            <p
              className={cn("text-[15px] text-[var(--school-fact-absent)]")}
              data-slot="school-chances-number-absent"
            >
              {cell.value}
            </p>
          ) : (
            <p
              className={cn(
                "font-medium text-[30px] leading-none tracking-[-0.01em] text-foreground tabular-nums",
              )}
            >
              {cell.value}
            </p>
          )}
          {cell.period ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {cell.period}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function gpaNumberCells(model: SchoolChancesModel): NumberCell[] {
  const gpa = model.gpa!;
  const bucket = gpa.profile.comparison?.label;
  const percentage = bucket
    ? gpa.distribution?.buckets.find((item) => item.label === bucket)?.pct
    : null;
  const bandPeriod = gpa.distribution?.reportedPeriod ?? gpa.distributionState.reportedPeriod;
  const baseline = dominantReportedPeriod([bandPeriod, gpa.average?.reportedPeriod]);
  const you = gpa.profile.display
    ? gpa.profile.state === "value"
      ? `${gpa.profile.display} / 4.0`
      : gpa.profile.scale
        ? `${gpa.profile.display} / ${gpa.profile.scale}`
        : gpa.profile.display
    : "Not added";
  /* FIX 1: `distributionState.display` is the distribution's own accounting
   * ("N buckets reported") — it is only ever the right fallback when the
   * distribution itself is unusable. When the distribution is usable but the
   * student's own GPA has no bucket (missing, incompatible scale, or
   * unplaceable), that is a student-side absence, not a distribution-side
   * one — it gets the same local "Not available" word `actNumberCells` (the
   * model to follow) already uses for an absent band or average. */
  const noBucketValue = gpa.distributionState.usable
    ? NOT_AVAILABLE
    : (gpa.distributionState.display ?? NOT_AVAILABLE);
  return [
    { label: "You", value: you, absent: !gpa.profile.display },
    {
      label: "Reported band",
      value: bucket ?? noBucketValue,
      absent: !bucket,
      period: divergentPeriod(bandPeriod, baseline),
    },
    {
      label: "Of the class",
      value:
        percentage === null || percentage === undefined
          ? noBucketValue
          : `${percentage}%`,
      absent: percentage === null || percentage === undefined,
    },
  ];
}

function actNumberCells(model: SchoolChancesModel): NumberCell[] {
  const act = model.act!;
  const bandPeriod = act.band?.reportedPeriod ?? act.bandState.reportedPeriod;
  const baseline = dominantReportedPeriod([bandPeriod, act.average?.reportedPeriod]);
  return [
    {
      label: "You",
      value: act.profile.display !== null ? String(act.profile.display) : "Not added",
      absent: act.profile.display === null,
    },
    {
      label: "Middle 50%",
      value: act.band
        ? `${act.band.p25}–${act.band.p75}`
        : (act.bandState.display ?? NOT_AVAILABLE),
      absent: !act.band,
      period: divergentPeriod(bandPeriod, baseline),
    },
    {
      label: "Reported average",
      value: act.average ? act.average.display : NOT_AVAILABLE,
      absent: !act.average,
      period: act.average
        ? divergentPeriod(act.average.reportedPeriod, baseline)
        : null,
    },
  ];
}

function defaultMetricFor(
  data: SchoolFactsResponse,
  profile: Profile | null | undefined,
): ChancesMetric {
  const models = METRICS.map(
    (metric) =>
      [metric, buildSchoolChancesModel(data, profile, metric)] as const,
  );
  const comparable = models.find(([, model]) => isComparable(model));
  if (comparable) return comparable[0];
  const either = models.find(([, model]) => hasAnySide(model));
  return either?.[0] ?? "gpa";
}

function isComparable(model: SchoolChancesModel) {
  if (model.gpa)
    return (
      model.gpa.profile.state === "value" &&
      model.gpa.distributionState.usable &&
      model.school.state === "school_value"
    );
  if (model.act)
    return (
      model.act.profile.state === "value" &&
      model.school.state === "school_value"
    );
  return model.sat!.lanes.some(
    (lane) =>
      lane.profile.state === "value" && lane.school.state === "school_value",
  );
}

function hasAnySide(model: SchoolChancesModel) {
  if (model.gpa)
    return (
      model.gpa.profile.state === "value" ||
      model.school.state === "school_value"
    );
  if (model.act)
    return (
      model.act.profile.state === "value" ||
      model.school.state === "school_value"
    );
  return model.sat!.lanes.some(
    (lane) =>
      lane.profile.state === "value" || lane.school.state === "school_value",
  );
}

function hasExplorer(metric: ChancesMetric, model: SchoolChancesModel) {
  /* The explorer is a local ruler, not a second data claim. It remains useful
   * only alongside a usable distribution or middle-50% band. An average on
   * its own is explicitly not a comparison scale. */
  if (metric === "gpa") return model.gpa!.distributionState.usable;
  if (metric === "act") {
    return model.act!.distributionState.usable || model.act!.bandState.usable;
  }
  return model.sat!.lanes.some(
    (lane) => lane.distributionState.usable || lane.bandState.usable,
  );
}

function profileScenario(model: SchoolChancesModel): ChancesScenarioInput {
  const gpa =
    model.gpa?.profile.state === "value" ? model.gpa.profile.value : null;
  const sat = model.sat?.lanes;
  const act = model.act;
  return {
    gpa,
    sat: {
      math:
        sat?.find((lane) => lane.key === "math")?.profile.state === "value"
          ? sat.find((lane) => lane.key === "math")!.profile.value
          : null,
      ebrw:
        sat?.find((lane) => lane.key === "ebrw")?.profile.state === "value"
          ? sat.find((lane) => lane.key === "ebrw")!.profile.value
          : null,
    },
    act: {
      composite: act?.profile.state === "value" ? act.profile.value : null,
    },
  };
}

function isMetric(value: string | null | undefined): value is ChancesMetric {
  return value === "gpa" || value === "sat" || value === "act";
}

function footerTruth(
  metric: ChancesMetric,
  response: SchoolFactsResponse,
  model: SchoolChancesModel,
) {
  if (metric === "gpa") return CHANCES_TRUTH_FOOTER;
  const usableBandKeys =
    metric === "sat"
      ? new Set(
          model
            .sat!.lanes.filter((lane) => lane.bandState.usable)
            .map((lane) => `class_profile.sat_${lane.key}`),
        )
      : model.act!.bandState.usable
        ? new Set(["class_profile.act_composite"])
        : new Set<string>();
  if (!usableBandKeys.size) return CHANCES_TRUTH_FOOTER;
  const foot = response.sections
    .flatMap((section) => section.groups)
    .find(
      (group) =>
        group.foot && group.facts.some((fact) => usableBandKeys.has(fact.key)),
    )?.foot;
  return foot ? `${CHANCES_TRUTH_FOOTER} ${foot}` : CHANCES_TRUTH_FOOTER;
}

function SchoolChancesSkeleton() {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-[var(--school-facts-panel-border)] bg-[var(--school-chances-panel-surface)] p-4 shadow-[var(--elevation-1)]",
      )}
      data-slot="school-chances-skeleton"
    >
      <Skeleton className={cn("h-9 w-full sm:w-52")} />
      <Skeleton className={cn("h-5 w-3/4")} />
      <Skeleton className={cn("h-16 w-full")} />
      <Skeleton className={cn("h-36 w-full")} />
      <Skeleton className={cn("h-11 w-full")} />
    </section>
  );
}
