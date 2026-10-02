/**
 * The Pace matrix tab (ui-spec §5, §7; parity A8, S13). A scatter of the
 * union of the four weakest and four strongest skills (by first-try
 * accuracy) — never "every skill". Each marker carries its number; the key
 * beneath the chart names it, so no label ever collides with a caption.
 *
 * Drawn as plain elements over a measured box rather than a chart library:
 * the y-axis is exactly 0-100%, markers are fixed-size and nudged apart
 * (`sat-pace-layout.ts`), and every label sits where it is placed.
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";

import type { SatSkillRanking, SatStatsResponse } from "@/api/sat/types";
import { ChartFigure } from "@/components/workspace/chart-figure";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  clampPaceSeconds,
  PACE_TARGET_SECONDS,
  summarizePaceMatrix,
} from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import {
  analyticsMetaClass,
  analyticsSheetClass,
} from "@/features/sat/sat-analytics-styles";
import {
  layoutPaceMarkers,
  paceAxisMax,
  type PlotSize,
} from "@/features/sat/sat-pace-layout";
import { cn } from "@/lib/utils";

const X_TICK_SECONDS = 30;
const Y_TICKS = [0, 50, 100] as const;
/** Room around the plot for the tick labels, the target label and the
 * marker overhang at the 0% / 100% edges. */
const PLOT_INSET = { bottom: 38, left: 44, right: 16, top: 34 } as const;

const QUADRANT_CAPTION =
  "pointer-events-none absolute hidden text-[11px] leading-none text-[var(--ink-faint)] @[560px]/sat-analytics:block";

interface PacePoint {
  code: string;
  name: string;
  module: string;
  x: number;
  y: number;
  attempts: number;
  rawSeconds: number;
  n: number;
}

/** One marker's look, shared by the plot, the legend and the key so the
 * three can never drift apart: Reading and Writing is a circle, Math a
 * rounded square, each in its own brand step. */
function PaceMarker({
  className,
  module,
  n,
}: {
  className?: string;
  module: string;
  n?: number;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center text-xs font-semibold text-[var(--on-brand)] tabular-nums",
        module === "math"
          ? "rounded-md bg-[var(--brand-scale-3)]"
          : "rounded-full bg-[var(--brand-scale-2)]",
        className,
      )}
    >
      {n}
    </span>
  );
}

function usePlotSize(): [React.RefObject<HTMLDivElement | null>, PlotSize] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PlotSize>({ height: 0, width: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      setSize({ height, width });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function PlotFrame({ xMax }: { xMax: number }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  const ticks = Array.from(
    { length: Math.floor(xMax / X_TICK_SECONDS) },
    (_, index) => (index + 1) * X_TICK_SECONDS,
  );
  return (
    <>
      <div className="absolute inset-0 border-b border-l border-[var(--edge)]" />
      <div className="absolute inset-x-0 top-0 border-t border-[var(--hairline)]" />
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--edge-strong)]" />
      {Y_TICKS.map((tick) => (
        <span
          className={cn(analyticsMetaClass, "absolute right-full mr-2 -translate-y-1/2 leading-none")}
          key={tick}
          style={{ top: `${100 - tick}%` }}
        >
          {tick}%
        </span>
      ))}
      {ticks.map((tick) => (
        <span
          className={cn(analyticsMetaClass, "absolute top-full mt-4 -translate-x-1/2 leading-none")}
          key={tick}
          style={{ left: `${(tick / xMax) * 100}%` }}
        >
          {tick}s
        </span>
      ))}
      <div
        className="absolute inset-y-0 border-l border-dashed border-[var(--edge-strong)]"
        style={{ left: `${(PACE_TARGET_SECONDS / xMax) * 100}%` }}
      >
        <span className="absolute bottom-full mb-3 -translate-x-1/2 whitespace-nowrap text-[11px] leading-none font-medium text-[var(--ink-secondary)] tabular-nums">
          {copy.targetLine(PACE_TARGET_SECONDS)}
        </span>
      </div>
      <span className={cn(QUADRANT_CAPTION, "top-4 left-3")}>{copy.quadrants.fastAccurate}</span>
      <span className={cn(QUADRANT_CAPTION, "top-4 right-3")}>{copy.quadrants.accurateSlow}</span>
      <span className={cn(QUADRANT_CAPTION, "bottom-4 left-3")}>{copy.quadrants.fastInaccurate}</span>
      <span className={cn(QUADRANT_CAPTION, "right-3 bottom-4")}>{copy.quadrants.slowInaccurate}</span>
      <span
        className={cn(analyticsMetaClass, "absolute right-full bottom-full mr-2 mb-3 leading-none whitespace-nowrap")}
        style={{ left: -PLOT_INSET.left }}
      >
        {copy.axisAccuracy}
      </span>
    </>
  );
}

function PaceChart({
  activeCode,
  onActiveChange,
  points,
}: {
  activeCode: string | null;
  onActiveChange: (code: string | null) => void;
  points: readonly PacePoint[];
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  const [plotRef, size] = usePlotSize();
  const xMax = paceAxisMax(
    Math.max(0, ...points.map((point) => point.x)),
    PACE_TARGET_SECONDS,
    X_TICK_SECONDS,
  );
  const spots = size.width > 0 ? layoutPaceMarkers(points, size, xMax) : [];

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative aspect-[4/5] max-h-[420px] w-full @[560px]/sat-analytics:aspect-video"
        data-slot="sat-pace-plot"
      >
        <div
          className="absolute"
          ref={plotRef}
          style={{
            bottom: PLOT_INSET.bottom,
            left: PLOT_INSET.left,
            right: PLOT_INSET.right,
            top: PLOT_INSET.top,
          }}
        >
          <PlotFrame xMax={xMax} />
          {points.map((point, index) => {
            const spot = spots[index];
            if (!spot) return null;
            return (
              <Tooltip key={point.code}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded-md ring-2 ring-[var(--surface-raised)] transition-[scale] duration-150 ease-out motion-reduce:transition-none",
                      point.module !== "math" && "rounded-full",
                      activeCode === point.code ? "z-10 scale-110" : "z-[1]",
                    )}
                    onPointerEnter={() => onActiveChange(point.code)}
                    onPointerLeave={() => onActiveChange(null)}
                    style={{ left: spot.left, top: spot.top }}
                  >
                    <PaceMarker module={point.module} n={point.n} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{point.name}</span>
                    <span className="tabular-nums opacity-80">
                      {copy.pointMeta(point.y, point.rawSeconds, point.attempts)}
                    </span>
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <p className={analyticsMetaClass}>{copy.axisSeconds}</p>
    </div>
  );
}

function SkillKey({
  activeCode,
  onActiveChange,
  points,
}: {
  activeCode: string | null;
  onActiveChange: (code: string | null) => void;
  points: readonly PacePoint[];
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  return (
    <ol className={cn(analyticsSheetClass, "grid grid-cols-1 p-1 @[900px]/sat-analytics:grid-cols-2")}>
      {points.map((point) => (
        <li
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 motion-reduce:transition-none",
            activeCode === point.code && "bg-[var(--canvas-hover)]",
          )}
          key={point.code}
          onPointerEnter={() => onActiveChange(point.code)}
          onPointerLeave={() => onActiveChange(null)}
        >
          <PaceMarker module={point.module} n={point.n} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{point.name}</span>
            <span className={analyticsMetaClass}>{copy.pointMeta(point.y, point.rawSeconds, point.attempts)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PaceLegend(): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  return (
    <ul className="flex items-center gap-4 text-xs text-[var(--ink-secondary)]">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full bg-[var(--brand-scale-2)]" />
        {copy.legendReading}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-[4px] bg-[var(--brand-scale-3)]" />
        {copy.legendMath}
      </li>
    </ul>
  );
}

function buildPoints(stats: SatStatsResponse): PacePoint[] {
  const merged = new Map<string, SatSkillRanking>();
  for (const skill of [...stats.weakestSkills, ...stats.strongestSkills]) {
    merged.set(skill.code, skill);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.accuracyPct - a.accuracyPct)
    .map((skill, index) => ({
      attempts: skill.attempted,
      code: skill.code,
      module: skill.module,
      n: index + 1,
      name: skill.name,
      rawSeconds: skill.avgTime,
      x: clampPaceSeconds(skill.avgTime),
      y: skill.accuracyPct,
    }));
}

export function SatAnalyticsPace({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const points = buildPoints(stats);
  const summary = summarizePaceMatrix(
    points.map((point) => ({
      accuracyPct: point.y,
      attempted: point.attempts,
      avgTimeSeconds: point.rawSeconds,
      code: point.code,
      name: point.name,
    })),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <PaceLegend />
        </div>
        <div className={cn(analyticsSheetClass, "p-3 @[560px]/sat-analytics:p-4")}>
          <ChartFigure summary={summary}>
            <PaceChart activeCode={activeCode} onActiveChange={setActiveCode} points={points} />
          </ChartFigure>
        </div>
      </div>
      <SkillKey activeCode={activeCode} onActiveChange={setActiveCode} points={points} />
    </div>
  );
}
