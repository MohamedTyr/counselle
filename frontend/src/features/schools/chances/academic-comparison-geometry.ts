import type { ScoreLaneModel } from "./school-chances-model";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

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

export const CALLOUT_MIN_SEPARATION_PX = 64;
export const CALLOUT_VALUE_ROW_WIDTH_PX = 160;
/** Endpoint labels have a fixed `w-6` footprint, so this is real geometry. */
export const BAND_ENDPOINT_LABEL_WIDTH_PX = 24;

export type CalloutLayout = "separate" | "rail" | "value-row";

/**
 * Pure collision policy shared by score and GPA marks. It deliberately takes
 * the plot width from the layout contract; it never samples a DOM rectangle.
 */
export function calloutLayout(
  positions: readonly number[],
  plotWidth: number,
): CalloutLayout {
  if (positions.length < 2) return "separate";
  if (plotWidth < CALLOUT_VALUE_ROW_WIDTH_PX) return "value-row";
  return Math.abs(positions[0]! - positions[1]!) * plotWidth <
    CALLOUT_MIN_SEPARATION_PX
    ? "rail"
    : "separate";
}

export type EndpointLabelLayout = "endpoints" | "middle";

/**
 * The p25 label starts at its mark and the p75 label ends at its mark. Their
 * fixed 24px boxes overlap only when the actual measured space says they do.
 */
export function endpointLabelLayout(
  p25Position: number,
  p75Position: number,
  plotWidth: number,
): EndpointLabelLayout {
  return (p75Position - p25Position) * plotWidth <
    BAND_ENDPOINT_LABEL_WIDTH_PX * 2
    ? "middle"
    : "endpoints";
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
