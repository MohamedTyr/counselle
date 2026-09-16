import type { ScoreLaneModel } from "./school-chances-model";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Superseded by `plotWindow()` (plan §2.4) as the axis domain a chart should
 * draw against — this still returns the *instrument* scale (1–36, 200–800),
 * not a windowed one. Its remaining callers (`AcademicComparisonPlot.tsx`,
 * `academic-comparison-marks.tsx`, `score-plot-copy.ts`) are deleted in a
 * later phase of the redesign; kept here only so this phase does not have to
 * touch files it does not own.
 */
export function scoreDomain(lane: ScoreLaneModel): {
  min: number;
  max: number;
} {
  return (
    lane.band ??
    (lane.key === "composite" ? { min: 1, max: 36 } : { min: 200, max: 800 })
  );
}

export function scorePosition(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

export type InstrumentDomain = { min: number; max: number };
export type PlotWindow = { lo: number; hi: number };
export type PlotWindowMetric = "gpa" | "sat" | "act";

/** The axis tick each metric snaps to — one source of truth (plan §2.4). */
export const PLOT_WINDOW_TICK: Record<PlotWindowMetric, number> = {
  gpa: 0.25,
  sat: 20,
  act: 1,
};

/**
 * Bucket-label precision — the smallest gap between two adjacent reported
 * bucket labels ("3.50 - 3.74" → "3.75 - 3.99" is 0.01 GPA; SAT and ACT
 * labels are whole numbers, so their gap is 1). Deliberately distinct from
 * `PLOT_WINDOW_TICK` above, which is the *axis* grid each metric snaps to —
 * for GPA that's a full 0.25-wide bucket, four times the label seam it
 * would need to absorb. `steppedAreaData` (`ClassShape.tsx`) uses this, not
 * the axis tick, to decide whether two buckets are "touching" (same
 * reporting seam, no invented 0% canyon) versus a genuine reported gap
 * (which must still drop to zero). SAT and ACT happen to share a value with
 * their own axis tick; GPA does not.
 */
export const PLOT_LABEL_PRECISION: Record<PlotWindowMetric, number> = {
  gpa: 0.01,
  sat: 1,
  act: 1,
};

/** The span is padded by this fraction of its own width on each side. */
const WINDOW_PADDING_FRACTION = 0.12;
/** The window is never narrower than this fraction of the instrument scale. */
const WINDOW_MINIMUM_FRACTION = 0.15;
/** Kills float drift (e.g. `3.7500000001`) after tick-snap arithmetic. */
const CLEAN_PRECISION = 1e6;
/** Absorbs float error at a tick boundary before flooring/ceiling outward. */
const SNAP_EPSILON = 1e-9;

function cleanNumber(value: number): number {
  return Math.round(value * CLEAN_PRECISION) / CLEAN_PRECISION;
}

function snapDown(value: number, tick: number): number {
  return cleanNumber(Math.floor(value / tick + SNAP_EPSILON) * tick);
}

function snapUp(value: number, tick: number): number {
  return cleanNumber(Math.ceil(value / tick - SNAP_EPSILON) * tick);
}

/**
 * Widens [spanLo, spanHi] to at least `minWidth`, centered, then slides the
 * result back inside [domainLo, domainHi] if widening pushed it past an edge.
 */
function applyMinimumWidth(
  spanLo: number,
  spanHi: number,
  minWidth: number,
  domainLo: number,
  domainHi: number,
): PlotWindow {
  const center = (spanLo + spanHi) / 2;
  let widenedLo = center - minWidth / 2;
  let widenedHi = center + minWidth / 2;
  if (widenedLo < domainLo) {
    widenedHi += domainLo - widenedLo;
    widenedLo = domainLo;
  }
  if (widenedHi > domainHi) {
    widenedLo -= widenedHi - domainHi;
    widenedHi = domainHi;
  }
  const clampToDomain = (value: number) =>
    Math.min(domainHi, Math.max(domainLo, value));
  return { lo: clampToDomain(widenedLo), hi: clampToDomain(widenedHi) };
}

/**
 * Windows an axis to the data actually drawn on it, instead of the full
 * instrument scale (plan §2.4 — the fix for `academic-comparison-geometry.ts`
 * spending most of its width on empty space). Pure and stable: identical
 * inputs always produce an identical window.
 *
 * `drawnValues` is whatever the renderer will actually draw — bucket edges,
 * a band's p25/p75, or a single average point. `studentValue` (the
 * saved/scenario value) is always folded into the span so the student's mark
 * can never fall outside the returned window, even where it is invalid for
 * this instrument's domain (defensively clamped rather than trusted).
 */
export function plotWindow(
  metric: PlotWindowMetric,
  domain: InstrumentDomain,
  drawnValues: readonly number[],
  studentValue: number | null | undefined,
): PlotWindow {
  const tick = PLOT_WINDOW_TICK[metric];
  const domainLo = Math.min(domain.min, domain.max);
  const domainHi = Math.max(domain.min, domain.max);
  const domainWidth = domainHi - domainLo;

  if (domainWidth <= 0) return { lo: domainLo, hi: domainHi };

  const clampToDomain = (value: number) =>
    Math.min(domainHi, Math.max(domainLo, value));

  const values: number[] = [];
  for (const value of drawnValues) {
    if (Number.isFinite(value)) values.push(clampToDomain(value));
  }
  if (Number.isFinite(studentValue as number)) {
    values.push(clampToDomain(studentValue as number));
  }

  if (values.length === 0) {
    return { lo: snapDown(domainLo, tick), hi: snapUp(domainHi, tick) };
  }

  const spanLo = Math.min(...values);
  const spanHi = Math.max(...values);
  const padding = (spanHi - spanLo) * WINDOW_PADDING_FRACTION;

  let windowLo = clampToDomain(spanLo - padding);
  let windowHi = clampToDomain(spanHi + padding);

  const minWidth = domainWidth * WINDOW_MINIMUM_FRACTION;
  if (windowHi - windowLo < minWidth) {
    const widened = applyMinimumWidth(spanLo, spanHi, minWidth, domainLo, domainHi);
    windowLo = widened.lo;
    windowHi = widened.hi;
  }

  const snappedLo = Math.max(domainLo, snapDown(windowLo, tick));
  const snappedHi = Math.min(domainHi, snapUp(windowHi, tick));
  return snappedHi > snappedLo
    ? { lo: snappedLo, hi: snappedHi }
    : { lo: domainLo, hi: domainHi };
}

/** Measures the plot container itself; callers never infer width from marks. */
export function useMeasuredPlotWidth<T extends HTMLElement>(
  suppliedWidth?: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(suppliedWidth ?? 0);

  useLayoutEffect(() => {
    if (suppliedWidth !== undefined) return;
    const element = ref.current;
    if (!element) return;
    const update = (nextWidth: number) =>
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    const measure = () => update(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver((entries) => {
      update(
        entries[0]?.contentRect.width ?? element.getBoundingClientRect().width,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [suppliedWidth]);

  return [ref, suppliedWidth ?? width];
}
