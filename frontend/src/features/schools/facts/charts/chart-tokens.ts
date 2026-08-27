import { useReducedMotion } from "motion/react";

import { useIsMobile } from "@/hooks/use-mobile";

/*
 * The measurements and motion every visual on this tab shares.
 *
 * Separate from `chart-shell.tsx` because these are values and hooks, not
 * components — mixing the two in one file breaks fast refresh.
 */

/** Row pitch, in px. Drives every chart's computed height. */
export const CHART_ROW_HEIGHT = 40;

/**
 * The label gutter. Every chart on the tab uses the same one so the marks
 * line up down the page — four charts starting at four different x positions
 * is what makes a page of visuals read as unrelated widgets.
 *
 * Mirrored as `--school-chart-axis` for the few places CSS needs it.
 */
export const AXIS_WIDTH = 200;

/**
 * It narrows on a phone because it has to: at 375px a 200px gutter plus room
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
