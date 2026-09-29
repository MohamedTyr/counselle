/* eslint-disable react-refresh/only-export-components -- profileScenario is
 * a test-only export consumed by academic-comparisons.test.tsx alongside the
 * component itself; see ClassShape.tsx for the same precedent. */
import * as React from "react";

import { useProfile } from "@/api/workspace/hooks/profile";
import type { Profile } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ActComparison } from "./ActComparison";
import { buildChanceLane } from "./chance-lane";
import { ChanceScreen } from "./ChanceScreen";
import { GpaComparison } from "./GpaComparison";
import { SatComparison } from "./SatComparison";
import { ScrubbingProvider, useIsScrubbing } from "./ScrubbablePlot";
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

/**
 * FIX 6: `ScrubbingProvider` scopes this panel instance's own `aria-busy`
 * signal (`useIsScrubbing`, read below) to its own plots alone — a thin
 * wrapper rather than folding the provider into the body below, since a
 * component cannot consume the context it establishes in its own render
 * (context only reaches descendants). See `ScrubbablePlot.tsx`'s
 * `ScrubbingProvider` doc comment for the cross-panel leakage this fixes.
 */
export function SchoolChancesPanel(
  props: {
    data: SchoolFactsResponse;
    metricParam?: string | null;
    onMetricChange?: (metric: ChancesMetric) => void;
    /** Test-only composition seam; production reads the established lazy query. */
    profile?: Profile | null;
  },
): React.ReactElement {
  return (
    <ScrubbingProvider>
      <SchoolChancesPanelBody {...props} />
    </ScrubbingProvider>
  );
}

function SchoolChancesPanelBody({
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
  const defaultMetric = defaultMetricFor(data, profile);
  /* The URL prop is authoritative. When it is absent or invalid the pure
   * default is deterministic; there is deliberately no stale local metric. */
  const metric = isMetric(metricParam) ? metricParam : defaultMetric;
  const model = buildSchoolChancesModel(data, profile, metric, scenarios);
  const chanceLane = buildChanceLane(model);
  const showsChance = chanceLane !== null && model.admitRate !== null;
  const interpretation = metricInterpretation(
    metric,
    model,
    profile?.academics?.gpa_scale,
  );

  /* FIX 2 (WCAG 4.1.3): the verdict sentence — carrying the answer ("sits
   * in the top reported band"), where the slider's own aria-valuetext only
   * ever carries the raw number — is the honest thing to announce once a
   * scrub settles. `aria-busy` (not a second, duplicate live region) is the
   * mechanism: WCAG's own live-region guidance sanctions it as the way to
   * suppress in-flight updates ("assistive technologies MAY wait until
   * aria-busy returns to false before reporting changes") without silencing
   * the paragraph's normal reading-order text. `useIsScrubbing` is the
   * cross-plot signal (ScrubbablePlot.tsx, one of up to three plots on
   * screen) that drives it, so this announces once a drag releases — never
   * per pointermove, which WCAG explicitly discourages for a continuous
   * interaction. */
  const isScrubbing = useIsScrubbing();

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
        {showsChance ? null : (
          <>
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
          </>
        )}
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
        {/* With an admit rate and a class to rank against, the screen is the
         * chance estimate. Without either, there is nothing honest to
         * estimate from, and the plain class comparison stands in. */}
        {showsChance ? (
          <MetricPlotReveal key={metric}>
            <ChanceScreen lane={chanceLane!} model={model} />
          </MetricPlotReveal>
        ) : (
          <>
            {/* The only prose on the screen (plan §3): everything else is
             * either a number or the shape itself.
             *
             * FIX 2 (WCAG 4.1.3): this paragraph is also the settled-value
             * announcement — `role="status"` rather than a second, duplicate
             * live region, so the sentence a sighted student reads is exactly
             * the one a screen reader announces. `aria-busy` (see the
             * `isScrubbing` comment above) defers that announcement while a
             * drag is live.
             *
             * The inner `span` is `key`'d to the sentence with its numbers
             * masked out, so a scrub that only moves the number updates the
             * text in place, and only a change of wording — crossing into a
             * different bucket, or out of the reported range — remounts it for
             * the 120ms `@starting-style` crossfade (schools.css). The key sits
             * on the span, not this `<p>`, so the live region's own root stays
             * mounted for a screen reader. */}
            <p
              aria-busy={isScrubbing}
              className={cn(
                "max-w-[48ch] text-[17px] text-foreground leading-[1.45] text-pretty",
              )}
              data-slot="school-chances-interpretation"
              role="status"
            >
              <span data-slot="school-chances-interpretation-text" key={interpretation.replace(/[\d.,%]+/g, "#")}>
                {interpretation}
              </span>
            </p>
            {metric === "gpa" ? <NumberRow cells={gpaNumberCells(model)} /> : null}
            {metric === "act" ? <NumberRow cells={actNumberCells(model)} /> : null}
            <MetricPlotReveal key={metric}>
              <ComparisonGraphic
                metric={metric}
                model={model}
                onScenarioChange={setScenarios}
                profile={profileScenario(model)}
                scenario={scenarios}
              />
            </MetricPlotReveal>
          </>
        )}
      </div>
      {showsChance ? null : (
        <footer
          className={cn(
            "border-t border-[var(--school-chances-divider)] px-4 py-3 text-xs text-[var(--school-fact-caveat)]",
          )}
          data-slot="school-chances-footer"
        >
          {footerTruth(metric, data, model)}
        </footer>
      )}
    </section>
  );
}

/**
 * This is deliberately mounted only with an actual graphic, never with the
 * Profile skeleton. The metric key the caller applies (`key={metric}`) makes
 * every GPA↔SAT↔ACT switch a fresh mount — a return, refetch, or scenario
 * edit rerenders this same instance instead, so those never replay it.
 *
 * FIX 3b/3c: this used to reveal only on a metric's first visit in the
 * session — the common case (flipping tabs repeatedly) then got an instant
 * hard cut, which is the actual defect. It now fires on every switch, gated
 * only by reduced motion, at plan §7's 160ms (not the old first-visit-only
 * 200ms) with `blur(3px) → 0` alongside the opacity fade — the blur bridges
 * two dissimilar silhouettes (a stepped area vs. a rail) that a plain
 * crossfade would show as two overlapping objects rather than one
 * transforming shape.
 */
function MetricPlotReveal({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // Snapshotted once per mount (i.e. once per metric switch, via the
  // caller's `key={metric}`) so a later rerender of this same instance
  // can't flip reduced-motion mid-transition.
  const [reveal] = React.useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  return (
    <div
      className={cn(
        reveal &&
          "motion-safe:animate-in motion-safe:fade-in motion-safe:blur-in-3 duration-[160ms] ease-out",
      )}
      data-reveal-state={reveal ? "revealing" : "static"}
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
  profile,
  scenario,
  onScenarioChange,
}: {
  metric: ChancesMetric;
  model: SchoolChancesModel;
  profile: ChancesScenarioInput;
  scenario: ChancesScenarioInput;
  onScenarioChange: (next: ChancesScenarioInput) => void;
}) {
  if (metric === "gpa")
    return (
      <GpaComparison
        model={model.gpa!}
        onScenarioChange={onScenarioChange}
        profile={profile}
        scenario={scenario}
      />
    );
  if (metric === "sat")
    return (
      <SatComparison
        model={model.sat!}
        onScenarioChange={onScenarioChange}
        profile={profile}
        scenario={scenario}
        testPolicy={model.testPolicy}
      />
    );
  return (
    <ActComparison
      model={model.act!}
      onScenarioChange={onScenarioChange}
      profile={profile}
      scenario={scenario}
      testPolicy={model.testPolicy}
    />
  );
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
  /** Defect 1 fix: true when this cell's value is a live scenario rather
   * than the student's saved record. Rendered in
   * `--school-chances-scenario` — the same token the mark and the Reset
   * pill already use for a hypothetical — so a student can never read a
   * scenario number as their saved GPA/ACT. */
  scenario?: boolean;
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
                "font-medium text-[30px] leading-none tracking-[-0.01em] tabular-nums",
                cell.scenario
                  ? "text-[var(--school-chances-scenario)]"
                  : "text-foreground",
              )}
              data-scenario={cell.scenario ? "true" : undefined}
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

/**
 * Defect 1 fix: the verdict sentence (`gpaInterpretation`,
 * school-chances-copy.ts) only ever reads `model.gpa.scenario` once its own
 * two profile-absence guards — `missing_profile_value`,
 * `incompatible_profile_value` — have already passed; a scenario never
 * papers over either absence there. Mirroring that exact guard order here
 * (rather than just checking `gpa.scenario` truthy) is what keeps this row
 * and the verdict sentence telling one story: an active scenario the
 * verdict itself would ignore must not drive these cells either.
 */
function activeGpaScenario(gpa: NonNullable<SchoolChancesModel["gpa"]>) {
  return gpa.profile.state === "value" ? gpa.scenario : null;
}

function gpaNumberCells(model: SchoolChancesModel): NumberCell[] {
  const gpa = model.gpa!;
  const scenario = activeGpaScenario(gpa);
  const comparison = scenario ? scenario.comparison : gpa.profile.comparison;
  const bucket = comparison?.state === "in_bucket" ? comparison.label : null;
  const percentage = bucket
    ? gpa.distribution?.buckets.find((item) => item.label === bucket)?.pct
    : null;
  const bandPeriod = gpa.distribution?.reportedPeriod ?? gpa.distributionState.reportedPeriod;
  const baseline = dominantReportedPeriod([bandPeriod, gpa.average?.reportedPeriod]);
  const you = scenario
    ? `${scenario.value.toFixed(2)} / 4.0`
    : gpa.profile.display
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
    {
      label: "You",
      value: you,
      absent: !scenario && !gpa.profile.display,
      scenario: scenario !== null,
    },
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

/** Same guard-mirroring rationale as `activeGpaScenario` above, for
 * `scoreInterpretation`'s identical guard order. */
function activeScoreScenario(lane: NonNullable<SchoolChancesModel["act"]>) {
  return lane.profile.state === "value" ? lane.scenario : null;
}

function actNumberCells(model: SchoolChancesModel): NumberCell[] {
  const act = model.act!;
  const scenario = activeScoreScenario(act);
  const bandPeriod = act.band?.reportedPeriod ?? act.bandState.reportedPeriod;
  const baseline = dominantReportedPeriod([bandPeriod, act.average?.reportedPeriod]);
  return [
    {
      label: "You",
      value: scenario
        ? String(scenario.value)
        : act.profile.display !== null
          ? String(act.profile.display)
          : "Not added",
      absent: !scenario && act.profile.display === null,
      scenario: scenario !== null,
    },
    /* Middle 50% and Reported average are school-level constants — they do
     * not depend on the student's value, so a scenario never touches them
     * (fix brief: "stay as they are"). */
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

/** Exported for test-only direct composition of `GpaComparison` /
 * `ActComparison` / `SatComparison` (`academic-comparisons.test.tsx`),
 * which now need the same `profile: ChancesScenarioInput` this panel
 * computes to drive each plot's own `ScrubbablePlot`. */
export function profileScenario(model: SchoolChancesModel): ChancesScenarioInput {
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
