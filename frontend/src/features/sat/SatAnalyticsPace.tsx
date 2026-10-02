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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PACE_TARGET_SECONDS } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { analyticsMetaClass, analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import {
  type CaptionBox,
  layoutPaceMarkers,
  leaderSegment,
  markerCoversCaption,
  paceAxis,
  paceMarkerSize,
  type PaceAxis,
  type PlacedMarker,
  type PlotSize,
  paceVerticalPad,
  paceYPx,
} from "@/features/sat/sat-pace-layout";
import { cn } from "@/lib/utils";

/** Room around the plot for the tick labels, the target label and the
 * y-axis title. */
const PLOT_INSET = { bottom: 56, left: 44, right: 16, top: 34 } as const;
const LEGEND_MARKER_PX = 12;
const TRUE_POINT_DOT_PX = 2.5;
/** Below the lowest marker: the x tick labels, then the axis title. */
const TICK_GAP_PX = 4;
const TITLE_GAP_PX = 24;
const CAPTION_CHAR_PX = 5.8;
const CAPTION_HEIGHT_PX = 12;
const CAPTION_SIDE_PX = 12;
const CAPTION_GAP_PX = 8;
/** Below this container width the quadrant captions would crowd the data. */
const CAPTION_MIN_PLOT_WIDTH_PX = 480;

interface PacePoint {
  code: string;
  name: string;
  module: string;
  x: number;
  y: number;
  attempts: number;
  n: number;
}

/** One marker's look, shared by the plot, the legend and the key so the
 * three can never drift apart: Reading and Writing is a pale circle with a
 * green rim, Math a solid dark rounded square. */
function PaceMarker({
  module,
  n,
  px,
}: {
  module: string;
  n?: number;
  px: number;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center text-xs font-semibold tabular-nums",
        module === "math"
          ? "rounded-md bg-[var(--brand-scale-3)] text-[var(--on-brand)]"
          : "rounded-full border-2 border-[var(--accent-solid)] bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)]",
      )}
      style={{ fontSize: px < 20 ? 11 : 12, height: px, width: px }}
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

interface FrameProps {
  axis: PaceAxis;
  markerPx: number;
  size: PlotSize;
  spots: readonly PlacedMarker[];
}

function captionBoxes(size: PlotSize, markerPx: number): Record<string, CaptionBox> {
  const copy = SAT_ANALYTICS_COPY.pace.quadrants;
  const top = paceYPx(100, size.height, markerPx) + CAPTION_GAP_PX;
  const bottom = paceYPx(0, size.height, markerPx) - CAPTION_GAP_PX - CAPTION_HEIGHT_PX;
  const box = (text: string, right: boolean, y: number): CaptionBox => {
    const width = text.length * CAPTION_CHAR_PX;
    return {
      height: CAPTION_HEIGHT_PX,
      left: right ? size.width - CAPTION_SIDE_PX - width : CAPTION_SIDE_PX,
      top: y,
      width,
    };
  };
  return {
    accurateSlow: box(copy.accurateSlow, true, top),
    fastAccurate: box(copy.fastAccurate, false, top),
    fastInaccurate: box(copy.fastInaccurate, false, bottom),
    slowInaccurate: box(copy.slowInaccurate, true, bottom),
  };
}

function QuadrantCaptions({ markerPx, size, spots }: FrameProps): React.ReactElement | null {
  const copy = SAT_ANALYTICS_COPY.pace.quadrants;
  if (size.width < CAPTION_MIN_PLOT_WIDTH_PX) return null;
  const boxes = captionBoxes(size, markerPx);
  return (
    <>
      {Object.entries(boxes).map(([key, box]) =>
        markerCoversCaption(box, spots, markerPx) ? null : (
          <span
            className="pointer-events-none absolute text-[11px] leading-none whitespace-nowrap text-[var(--ink-faint)]"
            key={key}
            style={{ left: box.left, top: box.top }}
          >
            {copy[key as keyof typeof copy]}
          </span>
        ),
      )}
    </>
  );
}

function TargetLine({ axis, size }: { axis: PaceAxis; size: PlotSize }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  const labelClass =
    "absolute bottom-full mb-3 whitespace-nowrap text-[11px] leading-none font-medium text-[var(--ink-secondary)] tabular-nums";
  if (PACE_TARGET_SECONDS > axis.max) {
    return <span className={cn(labelClass, "right-0")}>{copy.targetOffscreen(PACE_TARGET_SECONDS)}</span>;
  }
  return (
    <div
      className="absolute inset-y-0 border-l border-dashed border-[var(--edge-strong)]"
      style={{ left: (PACE_TARGET_SECONDS / axis.max) * size.width }}
    >
      <span className={cn(labelClass, "-translate-x-1/2")}>{copy.targetLine(PACE_TARGET_SECONDS)}</span>
    </div>
  );
}

/** A thin line from a nudged marker back to the point its data sits on,
 * ended by a small dot there when no marker already shows that point. */
function Leaders({
  markerPx,
  spots,
}: {
  markerPx: number;
  spots: readonly PlacedMarker[];
}): React.ReactElement | null {
  const segments = spots.flatMap((spot) => leaderSegment(spot, spots, markerPx) ?? []);
  if (segments.length === 0) return null;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      {segments.map((segment) => (
        <g key={`${segment.x1}-${segment.y1}`}>
          <line
            stroke="var(--ink-secondary)"
            strokeWidth={1}
            x1={segment.x1}
            x2={segment.x2}
            y1={segment.y1}
            y2={segment.y2}
          />
          {segment.dot && <circle cx={segment.dot.x} cy={segment.dot.y} fill="var(--ink-secondary)" r={TRUE_POINT_DOT_PX} />}
        </g>
      ))}
    </svg>
  );
}

function PlotFrame(props: FrameProps): React.ReactElement {
  const { axis, markerPx, size } = props;
  const copy = SAT_ANALYTICS_COPY.pace;
  const yTop = paceYPx(100, size.height, markerPx);
  const yMid = paceYPx(50, size.height, markerPx);
  const yBase = paceYPx(0, size.height, markerPx);
  const ticks = Array.from({ length: Math.floor(axis.max / axis.step) }, (_, i) => (i + 1) * axis.step);
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute inset-y-0 left-0 border-l border-[var(--edge)]" />
      <div className="absolute inset-x-0 border-t border-[var(--hairline)]" style={{ top: yTop }} />
      <div className="absolute inset-x-0 border-t border-dashed border-[var(--edge-strong)]" style={{ top: yMid }} />
      <div className="absolute inset-x-0 border-t border-[var(--edge)]" style={{ top: yBase }} />
      {[100, 50, 0].map((tick) => (
        <span
          className={cn(analyticsMetaClass, "absolute right-full mr-2 -translate-y-1/2 leading-none")}
          key={tick}
          style={{ top: paceYPx(tick, size.height, markerPx) }}
        >
          {tick}%
        </span>
      ))}
      {ticks.map((tick) => (
        <span
          className={cn(analyticsMetaClass, "absolute -translate-x-1/2 leading-none")}
          key={tick}
          style={{ left: (tick / axis.max) * size.width, top: yBase + paceVerticalPad(markerPx) + TICK_GAP_PX }}
        >
          {tick}s
        </span>
      ))}
      <TargetLine axis={axis} size={size} />
      <QuadrantCaptions {...props} />
      <span
        className={cn(analyticsMetaClass, "absolute bottom-full mb-3 leading-none whitespace-nowrap")}
        style={{ left: -PLOT_INSET.left }}
      >
        {copy.axisAccuracy}
      </span>
      <span
        className={cn(analyticsMetaClass, "absolute inset-x-0 text-center leading-none")}
        style={{ top: yBase + paceVerticalPad(markerPx) + TITLE_GAP_PX }}
      >
        {copy.axisSeconds}
      </span>
    </div>
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
  const axis = paceAxis(Math.max(0, ...points.map((point) => point.x)));
  const markerPx = paceMarkerSize(size.width);
  const spots = size.width > 0 ? layoutPaceMarkers(points, size, axis.max, markerPx) : [];

  return (
    <div
      aria-label={SAT_ANALYTICS_COPY.tabs.pace}
      className="relative aspect-[4/5] max-h-[440px] w-full @[560px]/sat-analytics:aspect-video"
      data-slot="sat-pace-plot"
      role="group"
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
        {size.width > 0 && <PlotFrame axis={axis} markerPx={markerPx} size={size} spots={spots} />}
        <Leaders markerPx={markerPx} spots={spots} />
        {points.map((point, index) => {
          const spot = spots[index];
          if (!spot) return null;
          const meta = copy.pointMeta(point.y, point.x, point.attempts);
          return (
            <Tooltip key={point.code}>
              <TooltipTrigger asChild>
                <span
                  aria-label={`${point.name}, ${meta}`}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 cursor-default ring-2 ring-[var(--surface-raised)] outline-none transition-[scale] duration-150 ease-out focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none",
                    point.module === "math" ? "rounded-md" : "rounded-full",
                    activeCode === point.code ? "z-10 scale-110" : "z-[1]",
                  )}
                  onBlur={() => onActiveChange(null)}
                  onFocus={() => onActiveChange(point.code)}
                  onPointerEnter={() => onActiveChange(point.code)}
                  onPointerLeave={() => onActiveChange(null)}
                  role="button"
                  style={{ left: spot.left, top: spot.top }}
                  tabIndex={0}
                >
                  <PaceMarker module={point.module} n={point.n} px={markerPx} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{point.name}</span>
                  <span className="tabular-nums opacity-80">{meta}</span>
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

const KEY_MARKER_PX = 24;

/** The visible key is a sighted-pointer aid; the markers themselves carry
 * the names and values for keyboard and screen-reader users. */
function SkillKey({
  activeCode,
  points,
}: {
  activeCode: string | null;
  points: readonly PacePoint[];
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  return (
    <ol
      aria-hidden="true"
      className={cn(analyticsSheetClass, "grid grid-cols-1 p-1 @[900px]/sat-analytics:grid-cols-2")}
    >
      {points.map((point) => (
        <li
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 motion-reduce:transition-none",
            activeCode === point.code && "bg-[var(--canvas-hover)]",
          )}
          key={point.code}
        >
          <PaceMarker module={point.module} n={point.n} px={KEY_MARKER_PX} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{point.name}</span>
            <span className={analyticsMetaClass}>{copy.pointMeta(point.y, point.x, point.attempts)}</span>
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
        <PaceMarker module="reading" px={LEGEND_MARKER_PX} />
        {copy.legendReading}
      </li>
      <li className="flex items-center gap-1.5">
        <PaceMarker module="math" px={LEGEND_MARKER_PX} />
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
      x: skill.avgTime,
      y: skill.accuracyPct,
    }));
}

export function SatAnalyticsPace({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const points = buildPoints(stats);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <PaceLegend />
        </div>
        <div className={cn(analyticsSheetClass, "p-3 @[560px]/sat-analytics:p-4")}>
          <PaceChart activeCode={activeCode} onActiveChange={setActiveCode} points={points} />
        </div>
      </div>
      <SkillKey activeCode={activeCode} points={points} />
    </div>
  );
}
