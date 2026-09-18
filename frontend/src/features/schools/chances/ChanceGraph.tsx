import * as React from "react";

import { cn } from "@/lib/utils";

import { chanceLevel, formatChance, RAMP_HIGH_AT, RAMP_MID_AT } from "./chance-format";
import type { ChanceLane, ChancePoint } from "./chance-lane";
import { monotonePath } from "./monotone-cubic";

/*
 * The chance curve: score along x, estimated chance up y. Drawn in a fixed
 * 1000-unit viewBox stretched to the container (`preserveAspectRatio="none"`
 * with non-scaling strokes), so every overlay — the typical-student rule,
 * the dot, its pill — positions with a plain percentage and the whole plot
 * needs no measurement and no resize handling. Purely presentational: the
 * slider beneath it (`ChanceScreen`) owns the value.
 */

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 200;
const PLOT_HEIGHT_PX = 184;
/** Headroom so the curve's highest point never touches the plot's top edge. */
const HEADROOM = 1.12;
/** Above this share of the plot's height the dot's pill hangs below it. */
const PILL_FLIP_BELOW_PCT = 22;
const Y_CEILINGS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
export function ChanceGraph({
  lane,
  curve,
  current,
  savedPoint,
}: {
  lane: ChanceLane;
  curve: ChancePoint[];
  current: ChancePoint;
  /** The saved profile's own point, drawn only while a scenario differs. */
  savedPoint: ChancePoint | null;
}): React.ReactElement {
  const peak = Math.max(...curve.map((point) => point.chance), current.chance);
  const ceiling = Y_CEILINGS.find((step) => step >= peak * HEADROOM) ?? 1;
  const x = (value: number) => (value - lane.min) / (lane.max - lane.min);
  const y = (chance: number) => 1 - chance / ceiling;
  const line = monotonePath(
    curve.map((point) => ({
      x: x(point.value) * VIEW_WIDTH,
      y: y(point.chance) * VIEW_HEIGHT,
    })),
  );

  return (
    <div className={cn("flex gap-2")} data-slot="chance-graph">
      <div
        aria-hidden
        className={cn(
          "flex w-8 shrink-0 flex-col justify-between text-right text-xs text-[var(--school-fact-caveat)] tabular-nums",
        )}
        style={{ height: PLOT_HEIGHT_PX }}
      >
        <span className={cn("-translate-y-1/2")}>{Math.round(ceiling * 100)}%</span>
        <span className={cn("translate-y-1/2")}>0%</span>
      </div>
      {/* `mx-2` matches the slider thumb's half-width: Base UI's edge-aligned
       * thumb travels from 8px to width-8px, so the dot sits exactly above it. */}
      <div className={cn("relative mx-2 min-w-0 flex-1")} style={{ height: PLOT_HEIGHT_PX }}>
        <ChanceCurve line={line} zeroY={y(0) * VIEW_HEIGHT} fullY={y(1) * VIEW_HEIGHT} />
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 w-0 border-l border-dashed border-[var(--school-chances-typical-rule)]",
          )}
          data-slot="chance-graph-typical"
          style={{ left: `${x(lane.typical) * 100}%` }}
        />
        {savedPoint ? (
          <span
            aria-hidden
            className={cn(
              "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--school-fact-caveat)] bg-[var(--school-chances-panel-surface)]",
            )}
            data-slot="chance-graph-saved"
            style={{
              left: `${x(savedPoint.value) * 100}%`,
              top: `${y(savedPoint.chance) * 100}%`,
            }}
          />
        ) : null}
        <ChanceDot
          chance={current.chance}
          leftPct={x(current.value) * 100}
          topPct={y(current.chance) * 100}
        />
      </div>
    </div>
  );
}

/** The curve and its fill. The colour gradient is laid out in user space from
 * 0% chance (`zeroY`) to 100% (`fullY`, above the plot whenever the y-axis
 * tops out lower), so a colour always means the same absolute chance. */
function ChanceCurve({
  line,
  zeroY,
  fullY,
}: {
  line: string;
  zeroY: number;
  fullY: number;
}): React.ReactElement {
  const gradientId = React.useId();
  return (
    <svg
      aria-hidden
      className={cn("chance-graph-reveal absolute inset-0 size-full overflow-visible")}
      preserveAspectRatio="none"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
    >
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={gradientId}
          x1="0"
          x2="0"
          y1={zeroY}
          y2={fullY}
        >
          <stop offset="0" stopColor="var(--school-chances-ramp-low)" />
          <stop offset={RAMP_MID_AT} stopColor="var(--school-chances-ramp-mid)" />
          <stop offset={RAMP_HIGH_AT} stopColor="var(--school-chances-ramp-high)" />
        </linearGradient>
        <linearGradient id={`${gradientId}-fade`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--school-chances-panel-surface)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--school-chances-panel-surface)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <line
        stroke="var(--school-chances-axis)"
        strokeDasharray="2 6"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2={VIEW_WIDTH}
        y1={VIEW_HEIGHT / 2}
        y2={VIEW_HEIGHT / 2}
      />
      <path
        d={`${line}L${VIEW_WIDTH},${VIEW_HEIGHT}L0,${VIEW_HEIGHT}Z`}
        fill={`url(#${gradientId})`}
        fillOpacity="0.26"
      />
      <path
        d={`${line}L${VIEW_WIDTH},${VIEW_HEIGHT}L0,${VIEW_HEIGHT}Z`}
        fill={`url(#${gradientId}-fade)`}
      />
      <path
        d={line}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeLinecap="round"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        stroke="var(--school-chances-axis)"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2={VIEW_WIDTH}
        y1={VIEW_HEIGHT}
        y2={VIEW_HEIGHT}
      />
    </svg>
  );
}

function ChanceDot({
  chance,
  leftPct,
  topPct,
}: {
  chance: number;
  leftPct: number;
  topPct: number;
}): React.ReactElement {
  /* The pill hangs to the dot's left once the dot is in the right half, so
   * it never leaves the plot at either end of the slider. */
  const pillOnLeft = leftPct > 50;
  /* Near the top of the plot the pill drops below the dot instead, so it
   * never climbs out over the figures above the graph. */
  const pillBelow = topPct < PILL_FLIP_BELOW_PCT;
  return (
    <span
      aria-hidden
      className={cn("absolute size-0")}
      data-level={chanceLevel(chance)}
      data-slot="chance-graph-dot"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      <span
        className={cn(
          "absolute top-0 left-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--school-chances-panel-surface)] bg-[var(--chance-level-solid)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--chance-level-solid)_22%,transparent)]",
        )}
      />
      <span
        data-slot="chance-graph-pill"
        className={cn(
          "absolute rounded-md bg-[var(--chance-level-solid)] px-1.5 py-0.5 text-chrome font-semibold tabular-nums",
          pillBelow ? "top-3.5" : "bottom-3.5",
          pillOnLeft ? "right-1" : "left-1",
        )}
      >
        {formatChance(chance)}
      </span>
    </span>
  );
}
