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
  metricInterpretation,
} from "./school-chances-copy";
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
        <div className={cn("flex min-w-0 flex-col gap-3")}>
          <h2 className={cn("text-lg font-semibold text-foreground")}>
            How your academics compare
          </h2>
          <SegmentedControl
            className={cn("w-full sm:w-fit")}
            label="Academic comparison metric"
            onValueChange={(next) => {
              onMetricChange?.(next as ChancesMetric);
            }}
            options={METRIC_OPTIONS}
            value={metric}
          />
        </div>
        {data.freshness_line ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            {data.freshness_line}
          </p>
        ) : null}
      </header>
      <div
        className={cn(
          "flex flex-col gap-4 border-t border-[var(--school-chances-divider)] p-4",
        )}
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
        <p
          className={cn("text-sm text-foreground")}
          data-slot="school-chances-interpretation"
        >
          {metricInterpretation(metric, model, profile?.academics?.gpa_scale)}
        </p>
        <ComparisonLedger metric={metric} model={model} />
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

function ComparisonLedger({
  metric,
  model,
}: {
  metric: ChancesMetric;
  model: SchoolChancesModel;
}) {
  const entries =
    metric === "gpa"
      ? gpaLedger(model)
      : metric === "sat"
        ? satLedger(model)
        : actLedger(model);
  return (
    <dl
      className={cn("grid gap-x-4 gap-y-3 text-sm sm:grid-cols-3")}
      data-slot="school-chances-ledger"
    >
      {entries.map((entry) => (
        <div className={cn("flex min-w-0 flex-col gap-0.5")} key={entry.label}>
          <dt className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            {entry.label}
          </dt>
          <dd className={cn("font-medium text-foreground tabular-nums")}>
            {entry.value}
          </dd>
          {entry.period ? (
            <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
              Reported {entry.period}
            </p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function gpaLedger(model: SchoolChancesModel) {
  const gpa = model.gpa!;
  const bucket = gpa.profile.comparison?.label;
  const percentage = bucket
    ? gpa.distribution?.buckets.find((item) => item.label === bucket)?.pct
    : null;
  return [
    {
      label: "You",
      value: gpa.profile.display
        ? gpa.profile.state === "value"
          ? `${gpa.profile.display} on a 4.0 scale`
          : gpa.profile.scale
            ? `${gpa.profile.display} on a ${gpa.profile.scale} scale`
            : gpa.profile.display
        : "Not added",
      period: null,
    },
    {
      label: "Reported band",
      value: bucket ?? gpa.distributionState.display ?? "Not available",
      period:
        gpa.distribution?.reportedPeriod ??
        gpa.distributionState.reportedPeriod,
    },
    ...(percentage === null || percentage === undefined
      ? []
      : [{ label: "In this band", value: `${percentage}%`, period: null }]),
  ];
}

function satLedger(model: SchoolChancesModel) {
  const sat = model.sat!;
  const [math, ebrw] = sat.lanes;
  return [
    {
      label: "Your SAT",
      value: sat.totalContext
        ? `${sat.totalContext.display} shown for context`
        : "Not added",
      period: null,
    },
    {
      label: "Math",
      value: math!.profile.display ?? "Not added",
      period: null,
    },
    {
      label: "Reading and Writing",
      value: ebrw!.profile.display ?? "Not added",
      period: null,
    },
    { label: "Comparison", value: "Compared by section", period: null },
  ];
}

function actLedger(model: SchoolChancesModel) {
  const act = model.act!;
  return [
    { label: "You", value: act.profile.display ?? "Not added", period: null },
    {
      label: "Middle 50%",
      value: act.band
        ? `${act.band.p25}–${act.band.p75}`
        : (act.bandState.display ?? "Not available"),
      period: act.band?.reportedPeriod ?? act.bandState.reportedPeriod,
    },
    ...(act.average
      ? [
          {
            label: "Reported average",
            value: act.average.display,
            period: act.average.reportedPeriod,
          },
        ]
      : []),
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
      <Skeleton className={cn("h-6 w-56")} />
      <Skeleton className={cn("h-9 w-full sm:w-52")} />
      <Skeleton className={cn("h-5 w-3/4")} />
      <Skeleton className={cn("h-36 w-full")} />
      <Skeleton className={cn("h-11 w-full")} />
    </section>
  );
}
