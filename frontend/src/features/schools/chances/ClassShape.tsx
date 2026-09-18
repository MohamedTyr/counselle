/* eslint-disable react-refresh/only-export-components -- CLASS_SHAPE_HEIGHT
 * and selectClassShapeKind are consumed by AcademicComparisonPlot.tsx and
 * GpaComparison.tsx alongside the component itself; see badge.tsx/select.tsx
 * for the same precedent in this codebase. */
import * as React from "react";
import { Area, ComposedChart, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import {
  PLOT_LABEL_PRECISION,
  PLOT_WINDOW_TICK,
  scorePosition,
  type PlotWindow,
  type PlotWindowMetric,
} from "./academic-comparison-geometry";
import type { BandModel, ChanceBucket, DistributionModel } from "./school-chances-model";

/*
 * The one visual grammar used on GPA, SAT and ACT alike (plan §2.1): the
 * class as a continuous silhouette along a cropped axis. Which of the three
 * renderers draws is chosen by what data exists, never by which metric —
 * that is what makes the three screens read as one product.
 *
 * Purely presentational by design (plan boundary #1): no interaction, no
 * event handlers, no `role="slider"`. `YouMark.tsx` is the only thing here
 * that takes a live value, and it takes it as a plain prop — a later scrub
 * wrapper (P3's `ScrubbablePlot`) drives both the mark and, if it ever needs
 * to, a highlighted bucket, purely by re-rendering with new prop values. This
 * file never owns pointer or keyboard state.
 */

export type ClassShapeKind = "stepped" | "rail" | "point";

/** The shape's own plot height, excluding the axis-label row (plan §2.5). */
export const CLASS_SHAPE_HEIGHT: Record<ClassShapeKind, number> = {
  stepped: 132,
  rail: 88,
  point: 88,
};

/**
 * `YouMark`'s pill type, named once here so its rendered height can be
 * derived instead of guessed. `text-chrome` (DESIGN.md §6.3's 13px/20px
 * off-ladder step, `theme.css`) gives the pill an explicit 20px line height
 * — the P1 fix round instead left the pill on a bare `text-[13px]` with the
 * font's own default line height, computed to 23.5px against an assumed
 * 17px. That 6.5px miss (`YOU_MARK_PILL_CLEARANCE` was 24, the SAT/ACT lanes
 * measured 0.5px of real clearance) is exactly the class of bug an explicit
 * line-height forecloses: an assumed value can silently drift from the
 * font's real metrics; a token both files read cannot.
 */
export const PILL_LINE_HEIGHT_PX = 20;
/** `py-0.5` top + `py-0.5` bottom (2px each, Tailwind's 0.25rem spacing unit). */
export const PILL_VERTICAL_PADDING_PX = 4;
/** The pill's actual rendered height — derived, not assumed. */
const PILL_HEIGHT_PX = PILL_LINE_HEIGHT_PX + PILL_VERTICAL_PADDING_PX;
/** Real headroom above the pill's own height, not a sub-pixel margin — a
 * reservation exactly equal to the pill's height leaves zero room for
 * rendering variance to push it back into collision. */
const PILL_BREATHING_ROOM_PX = 8;

/**
 * `YouMark`'s pill rides `-translate-y-full` above the top of the plot box
 * it is drawn in (plan §2.2) — by design, so it never competes with the
 * shape for vertical room. A caller that gives the plot box its exact
 * `CLASS_SHAPE_HEIGHT` and nothing else leaves the pill nowhere to escape
 * to but whatever sits directly above (FIX 4: it collided with the row
 * label at 390px). Callers reserve this much space above the plot box —
 * `paddingTop` on an outer wrapper, the plot box itself unchanged — so the
 * pill renders into empty, reserved space instead. Verified in-browser at
 * 390/768/1280px on both the GPA lane and a paired SAT fixture (see the P1
 * fix-round report and its follow-up).
 */
export const YOU_MARK_PILL_CLEARANCE = PILL_HEIGHT_PX + PILL_BREATHING_ROOM_PX;

const RAIL_BAR_HEIGHT = 10;
const ENDPOINT_LABEL_ROW_HEIGHT = 20;

export type ClassShapeAverage = { value: number };

/**
 * Chooses the renderer by what is actually usable — a bucket distribution
 * beats a band, a band beats a bare average, and absence of all three means
 * there is no shape to draw (the caller's own "unavailable" branch handles
 * that; `ClassShape` never invents one).
 */
export function selectClassShapeKind(input: {
  distributionUsable: boolean;
  band: BandModel | null;
  average: ClassShapeAverage | null;
}): ClassShapeKind | null {
  if (input.distributionUsable) return "stepped";
  if (input.band !== null) return "rail";
  if (input.average !== null) return "point";
  return null;
}

export type ClassShapeProps = {
  window: PlotWindow;
  /** Which axis tick this shape snaps to — used only to size the stepped
   * renderer's adjacent-bucket tolerance (`steppedAreaData`) and the
   * open-ended edge sliver, both against `PLOT_WINDOW_TICK[metric]`. */
  metric: PlotWindowMetric;
  distribution?: DistributionModel | null;
  /**
   * Whether `distribution` is scaled and safe to draw as the class shape —
   * the caller's own `distributionState.usable` (`state === "school_value"`),
   * never re-derived here. A `distribution_unscaled` distribution can still
   * carry per-bucket `pct`/`range` values; drawing it as a scaled shape
   * anyway would misstate data the school itself flagged as not comparable
   * (AGENTS.md principle 3), so this is a required, explicit honesty gate
   * rather than something this file infers from bucket contents.
   */
  distributionUsable: boolean;
  band?: BandModel | null;
  average?: ClassShapeAverage | null;
  className?: string;
};

export function ClassShape({
  window,
  metric,
  distribution,
  distributionUsable,
  band,
  average,
  className,
}: ClassShapeProps): React.ReactElement {
  if (window.hi <= window.lo) return <AxisOnly className={className} />;

  const kind = selectClassShapeKind({
    distributionUsable,
    band: band ?? null,
    average: average ?? null,
  });

  if (kind === "stepped" && distribution) {
    return (
      <SteppedArea
        className={className}
        distribution={distribution}
        metric={metric}
        window={window}
      />
    );
  }
  if (kind === "rail" && band) {
    return (
      <BandRail average={average ?? null} band={band} className={className} window={window} />
    );
  }
  if (kind === "point" && average) {
    return <PointAxis average={average} className={className} window={window} />;
  }
  return <AxisOnly className={className} />;
}

const CHART_CONFIG = {
  class: {
    label: "Reported entering-class distribution",
    color: "var(--school-chances-class-edge)",
  },
} as const;

function SteppedArea({
  distribution,
  window,
  metric,
  className,
}: {
  distribution: DistributionModel;
  window: PlotWindow;
  metric: PlotWindowMetric;
  className?: string;
}): React.ReactElement {
  const data = smoothSilhouette(steppedAreaData(distribution, window, metric));
  const rampId = React.useId();
  const fadeId = React.useId();
  return (
    <ChartContainer
      className={cn("w-full", className)}
      config={CHART_CONFIG}
      data-slot="class-shape-stepped"
      style={{ height: CLASS_SHAPE_HEIGHT.stepped }}
    >
      {/* Recharts' own keyboard/accessibility layer defaults on — a second,
       * redundant `tabIndex=0` SVG surface sitting inside this figure's own
       * `aria-hidden` box (plan §5's interactive layer lives outside it, in
       * `ScrubbablePlot`). Disabled so tabbing through the plot never lands
       * on an inert, AT-invisible stop. */}
      <ComposedChart
        accessibilityLayer={false}
        data={data}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
      >
        <XAxis dataKey="x" domain={[window.lo, window.hi]} hide type="number" />
        <YAxis domain={[0, 100]} hide type="number" />
        {/* `userSpaceOnUse` so the ramp spans the score axis itself, not the
         * path's own bounding box — a flat line has a zero-height box and
         * would otherwise lose its stroke entirely. */}
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={rampId} x1="0" x2="100%" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--school-chances-ramp-low)" />
            <stop offset="50%" stopColor="var(--school-chances-ramp-mid)" />
            <stop offset="100%" stopColor="var(--school-chances-ramp-high)" />
          </linearGradient>
          <linearGradient id={fadeId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--school-chances-panel-surface)" stopOpacity={0} />
            <stop offset="100%" stopColor="var(--school-chances-panel-surface)" stopOpacity={1} />
          </linearGradient>
        </defs>
        <Area
          dataKey="y"
          fill={`url(#${rampId})`}
          fillOpacity={0.3}
          isAnimationActive={false}
          stroke="none"
          type="monotoneX"
        />
        <Area
          dataKey="y"
          fill={`url(#${fadeId})`}
          fillOpacity={0.55}
          isAnimationActive={false}
          stroke={`url(#${rampId})`}
          strokeLinecap="round"
          strokeWidth={2}
          type="monotoneX"
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/**
 * The open-ended edge sliver (FIX 1): an open-ended bucket ("4.00 and
 * Above", "Below 2.00") clamps to a zero-width point whenever the window's
 * own edge sits at the instrument domain's edge — the window can never pad
 * past the domain, so there is no room left for the bucket's flat top to
 * run into. Rather than let that width-filter it out of existence (silently
 * dropping the whole bucket's reported share, FIX 1's bug), it is drawn as a
 * sliver flush to the window edge — as wide as `EDGE_SLIVER_TICKS` ticks of
 * this metric's own axis grid allows, but never wider than whatever room the
 * neighbouring bucket actually leaves, so the sliver can never overlap it.
 */
const EDGE_SLIVER_TICKS = 0.5;

type SteppedBucket = { lo: number; hi: number; pct: number };

/**
 * Builds the step polyline's data points. A bucket's own percentage holds
 * flat across exactly its reported range and nowhere else — never
 * interpolated between two reported edges (AGENTS.md principle 3: this
 * codebase does not invent values) — closed to zero at any real gap between
 * buckets (not a same-precision labelling seam, FIX 2) and at the window's
 * own edges.
 *
 * Exported (only) for direct unit testing — honesty-critical geometry per
 * AGENTS.md's tested-hard carve-out (FIX 1 dropped 20% of a reported class
 * silently; FIX 2 invented a 0% canyon between a school's two largest
 * buckets). Not part of the component's public rendering API.
 */
export function steppedAreaData(
  distribution: DistributionModel,
  window: PlotWindow,
  metric: PlotWindowMetric,
): { x: number; y: number }[] {
  const clamp = (value: number) => Math.min(window.hi, Math.max(window.lo, value));
  const tick = PLOT_WINDOW_TICK[metric];
  const labelPrecision = PLOT_LABEL_PRECISION[metric];
  const sliverWidth = Math.min(window.hi - window.lo, tick * EDGE_SLIVER_TICKS);

  const prepared: SteppedBucket[] = distribution.buckets
    .filter(
      (bucket): bucket is ChanceBucket & { pct: number; range: NonNullable<ChanceBucket["range"]> } =>
        bucket.pct !== null && bucket.range !== null,
    )
    // FIX 1: filter on the bucket's raw, pre-clamp width so an open-ended
    // bucket (range.hi === +Infinity, or the mirror range.lo === -Infinity)
    // is never discarded just because clamping collapses it inside the
    // window — that discarded a fifth of the class on the GPA fixtures.
    .filter((bucket) => bucket.range.hi > bucket.range.lo)
    .map((bucket) => ({
      lo: clamp(bucket.range.lo),
      hi: clamp(bucket.range.hi),
      pct: bucket.pct,
    }))
    .sort((a, b) => a.lo - b.lo);

  // Forward pass: a bucket that clamped flush against the window's *top*
  // edge (lo === hi === window.hi) is widened backward into a sliver,
  // bounded by the previous bucket's own (already final) `hi` so it can
  // never eat into a neighbour.
  for (let index = 0; index < prepared.length; index += 1) {
    const current = prepared[index]!;
    if (current.hi > current.lo || current.hi !== window.hi) continue;
    const previousHi = index > 0 ? prepared[index - 1]!.hi : window.lo;
    current.lo = Math.max(previousHi, window.hi - sliverWidth);
  }
  // Backward pass: the mirror, for a bucket clamped flush against the
  // window's *bottom* edge — bounded by the next bucket's `lo`.
  for (let index = prepared.length - 1; index >= 0; index -= 1) {
    const current = prepared[index]!;
    if (current.hi > current.lo || current.lo !== window.lo) continue;
    const nextLo = index < prepared.length - 1 ? prepared[index + 1]!.lo : window.hi;
    current.hi = Math.min(nextLo, window.lo + sliverWidth);
  }

  const buckets = prepared.filter((bucket) => bucket.hi > bucket.lo);

  if (buckets.length === 0) {
    return [
      { x: window.lo, y: 0 },
      { x: window.hi, y: 0 },
    ];
  }

  const points: { x: number; y: number }[] = [];
  if (window.lo < buckets[0]!.lo) points.push({ x: window.lo, y: 0 });
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index]!;
    points.push({ x: bucket.lo, y: bucket.pct });
    const next = buckets[index + 1];
    // FIX 2 (tightened by FIX C): two buckets are "touching" — no invented
    // 0% canyon between them — when the gap between them is within the
    // metric's own *label* precision (`PLOT_LABEL_PRECISION`, e.g. GPA's
    // 0.01-wide labelling seam between "3.50-3.74" and "3.75-3.99"), not
    // the coarser axis tick (a full 0.25-wide GPA bucket) `PLOT_WINDOW_TICK`
    // above sizes the sliver with. Using the axis tick here would silently
    // smooth over a real reported gap up to a full bucket wide — the same
    // honesty defect as FIX 2, in the opposite direction. A gap wider than
    // the label precision is a real reported 0% zone and still drops to
    // zero. The last bucket only closes to zero if it leaves real window
    // beyond it unreported — a bucket already flush to the window's own
    // edge (FIX 1's sliver included) has nothing after it to close into.
    if (next ? next.lo - bucket.hi > labelPrecision : bucket.hi < window.hi)
      points.push({ x: bucket.hi, y: 0 });
  }
  const last = points[points.length - 1]!;
  if (last.x < window.hi) points.push({ x: window.hi, y: last.y });
  return points;
}

/**
 * Turns the step polyline into the anchor points of the drawn silhouette:
 * one point at the centre of each reported bucket, at that bucket's own
 * percentage. A monotone curve through them never overshoots a reported
 * value, a real reported gap keeps both of its zero endpoints so the curve
 * rests on the axis across it, and a bucket flush to the window's edge stays
 * at its own height there rather than diving to a zero nobody reported. The
 * exact bucket ranges and shares stay in the number row and the summary.
 */
export function smoothSilhouette(
  steps: { x: number; y: number }[],
): { x: number; y: number }[] {
  if (steps.length < 2) return steps;
  const points: { x: number; y: number }[] = [steps[0]!];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const start = steps[index]!;
    const end = steps[index + 1]!;
    if (end.x <= start.x) continue;
    if (start.y === 0) points.push({ x: start.x, y: 0 }, { x: end.x, y: 0 });
    else points.push({ x: (start.x + end.x) / 2, y: start.y });
  }
  points.push(steps[steps.length - 1]!);
  return points.filter(
    (point, index) => index === 0 || point.x > points[index - 1]!.x,
  );
}

/**
 * Plan §2.1's "B. Band rail" as absolutely-positioned `div`s rather than a
 * Recharts `ReferenceArea`: the rail is one 10px rounded bar plus an
 * optional 1px tick, both sharing `scorePosition()` with `SteppedArea` and
 * `RailTick` — composing a second Recharts chart/custom shape for that would
 * buy nothing a couple of styled `span`s don't already give, geometrically
 * verified against the same axis math the rest of `ClassShape` uses.
 */
function BandRail({
  band,
  average,
  window,
  className,
}: {
  band: BandModel;
  average: ClassShapeAverage | null;
  window: PlotWindow;
  className?: string;
}): React.ReactElement {
  const clamp = (value: number) => Math.min(window.hi, Math.max(window.lo, value));
  const p25Pct = scorePosition(clamp(band.p25), window.lo, window.hi) * 100;
  const p75Pct = scorePosition(clamp(band.p75), window.lo, window.hi) * 100;
  const barTop = (CLASS_SHAPE_HEIGHT.rail - RAIL_BAR_HEIGHT) / 2;
  return (
    <div
      className={cn("relative", className)}
      data-slot="class-shape-rail"
      style={{ height: CLASS_SHAPE_HEIGHT.rail }}
    >
      <AxisHairline />
      {/* The fill's own two edges ARE the p25/p75 endpoints (plan §2.1) — no
       * separate vertical rules are drawn at the band's boundary. */}
      <span
        className={cn("absolute rounded-full")}
        data-slot="class-shape-band"
        style={{
          left: `${p25Pct}%`,
          width: `${Math.max(0, p75Pct - p25Pct)}%`,
          top: barTop,
          height: RAIL_BAR_HEIGHT,
          background: "var(--school-chances-class-fill)",
          border: "1px solid var(--school-chances-class-edge)",
        }}
      />
      {average ? <RailTick top={barTop} value={average.value} window={window} /> : null}
    </div>
  );
}

function PointAxis({
  average,
  window,
  className,
}: {
  average: ClassShapeAverage;
  window: PlotWindow;
  className?: string;
}): React.ReactElement {
  const barTop = (CLASS_SHAPE_HEIGHT.point - RAIL_BAR_HEIGHT) / 2;
  return (
    <div
      className={cn("relative", className)}
      data-slot="class-shape-point"
      style={{ height: CLASS_SHAPE_HEIGHT.point }}
    >
      <AxisHairline />
      <RailTick top={barTop} value={average.value} window={window} />
    </div>
  );
}

/** The reported average, when there is one: a 1px tick, never a diamond. */
function RailTick({
  value,
  window,
  top,
}: {
  value: number;
  window: PlotWindow;
  top: number;
}): React.ReactElement {
  const clamped = Math.min(window.hi, Math.max(window.lo, value));
  const left = scorePosition(clamped, window.lo, window.hi) * 100;
  return (
    <span
      className={cn("absolute w-px")}
      data-slot="class-shape-average-tick"
      style={{
        left: `${left}%`,
        top,
        height: RAIL_BAR_HEIGHT,
        background: "var(--school-chances-class-edge)",
      }}
    />
  );
}

function AxisHairline(): React.ReactElement {
  return (
    <span
      className={cn("absolute inset-x-0 top-1/2 h-px -translate-y-1/2")}
      data-slot="class-shape-axis"
      style={{ background: "var(--school-chances-axis)" }}
    />
  );
}

/**
 * No usable data at all — a hairline and nothing else. Never invents a shape
 * to fill the space (plan §2.1.C). Exported so a caller whose own absence
 * grammar short-circuits before ever building a `ClassShape` window (e.g.
 * `GpaComparison`'s `GpaFallback`) can still render the plan's renderer C
 * instead of a bare void with no hairline.
 */
export function AxisOnly({ className }: { className?: string }): React.ReactElement {
  return (
    <div
      className={cn("relative", className)}
      data-slot="class-shape-empty"
      style={{ height: CLASS_SHAPE_HEIGHT.rail }}
    >
      <AxisHairline />
    </div>
  );
}

export type AxisEndpointLabelsProps = {
  window: PlotWindow;
  format?: (value: number) => string;
  className?: string;
};

/**
 * Both window endpoints, labelled with their real values — the honesty
 * mitigation that makes cropping the axis to the data permissible at all
 * (plan §2.4, mitigation 1).
 */
export function AxisEndpointLabels({
  window,
  format = String,
  className,
}: AxisEndpointLabelsProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-xs text-[var(--school-fact-caveat)] tabular-nums",
        className,
      )}
      data-slot="class-shape-endpoints"
      style={{ height: ENDPOINT_LABEL_ROW_HEIGHT }}
    >
      <span>{format(window.lo)}</span>
      <span>{format(window.hi)}</span>
    </div>
  );
}
