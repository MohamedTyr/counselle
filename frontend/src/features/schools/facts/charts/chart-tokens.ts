import { useReducedMotion } from "motion/react";

import { useIsMobile } from "@/hooks/use-mobile";

/*
 * The measurements and motion every visual on this tab shares.
 *
 * Separate from `chart-shell.tsx` because these are values and hooks, not
 * components — mixing the two in one file breaks fast refresh.
 */

/** Row pitch, in px, for a category whose label fits on ONE line. */
export const CHART_ROW_HEIGHT = 40;

/** Breathing room between the end of a label and the mark it names. */
export const TICK_GAP = 12;

/** Line box of a wrapped axis label, and the padding around the pair. */
const TICK_LINE_HEIGHT = 17;
const ROW_PADDING = 14;

/**
 * Average glyph advance for the axis label face at 13px.
 *
 * An estimate, and deliberately a slightly generous one: over-estimating
 * costs a few px of chart height, while under-estimating puts a third line
 * of a label on top of the row below it.
 */
const CHAR_ADVANCE = 6.4;

/**
 * The row pitch a chart actually needs, given how far its labels wrap.
 *
 * CHART_ROW_HEIGHT was a fixed 40px that assumed a one-line label. Metric
 * labels are long by nature — "Students with need whose need was fully met"
 * is a normal one — so at 200px of gutter they wrap to three lines and
 * collide with the row beneath, and at 375px, where the gutter is 116px,
 * nearly all of them do. The pitch derives from the labels instead of hoping
 * they are short.
 */
export function chartRowHeight(
  labels: readonly string[],
  gutter: number,
): number {
  const usable = Math.max(gutter - TICK_GAP, 1);
  const lines = labels.reduce(
    (most, label) =>
      Math.max(most, Math.ceil((label.length * CHAR_ADVANCE) / usable)),
    1,
  );
  return Math.max(CHART_ROW_HEIGHT, lines * TICK_LINE_HEIGHT + ROW_PADDING);
}

/**
 * The label gutter. Every chart on the tab uses the same one so the marks
 * line up down the page — four charts starting at four different x positions
 * is what makes a page of visuals read as unrelated widgets.
 *
 * TypeScript only. It used to be mirrored as a `--school-chart-axis` custom
 * property "for the few places CSS needs it"; there were none, so the mirror
 * was deleted rather than kept in sync with nothing.
 */
export const AXIS_WIDTH = 240;

/**
 * It narrows on a phone because it has to: at 375px a desktop gutter plus room
 * for the printed value leaves about 60px of track, and a bar that short
 * stops being a comparison. The labels wrap to more lines instead, which
 * costs height — the one thing a phone has to spare.
 */
const AXIS_WIDTH_MOBILE = 116;

export function useAxisWidth(): number {
  return useIsMobile() ? AXIS_WIDTH_MOBILE : AXIS_WIDTH;
}

/** Axis / label ink, passed to Recharts as a plain object (no Tailwind). */
export const AXIS_TICK = {
  fill: "var(--school-fact-label)",
  fontSize: 13,
} as const;

export const VALUE_LABEL = {
  fill: "var(--school-fact-value)",
  fontSize: 13,
  fontWeight: 500,
} as const;

/**
 * The entrance, as Recharts props.
 *
 * A bar growing from zero says "counting up to this" — it fits a value that
 * IS a quantity, and it happens once per section visit, which is the
 * occasional tier where an animation is still earned. It never re-runs on a
 * refetch: a bar that re-sweeps whenever cached data revalidates is noise
 * pretending to be news.
 *
 * One sweep per chart rather than a per-bar stagger: Recharts draws a series
 * as one element, and splitting it into N series to stagger them would be
 * inventing structure in the data to buy an effect.
 *
 * Recharts animates on the main thread and knows nothing about
 * `prefers-reduced-motion`, so the media query cannot do this for us: the
 * hook is the gate, and off means the chart is simply drawn.
 */
export function useChartEntrance(): {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: "ease-out";
} {
  const reduceMotion = useReducedMotion();
  return {
    isAnimationActive: !reduceMotion,
    animationDuration: 340,
    animationEasing: "ease-out",
  };
}
