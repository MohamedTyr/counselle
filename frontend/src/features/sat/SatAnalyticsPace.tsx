/**
 * The Pace matrix tab (ui-spec §5, §7; parity A8, S13). A scatter of the
 * union of the four weakest and four strongest skills (by first-try
 * accuracy) — never "every skill". Each point carries its number; the key
 * beneath the chart names it, so no label ever collides with a caption.
 */
import type React from "react";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SatSkillRanking, SatStatsResponse } from "@/api/sat/types";
import { ChartContainer } from "@/components/ui/chart";
import { ChartFigure } from "@/components/workspace/chart-figure";
import {
  clampPaceSeconds,
  PACE_MATRIX_ACCURACY_SPLIT_PCT,
  PACE_MATRIX_SECONDS_SPLIT,
  paceDotRadius,
  summarizePaceMatrix,
} from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { analyticsGroupLabelClass, analyticsMetaClass, analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";

/** The plot is padded past 0-100% so quadrant captions sit in free rows
 * above and below every possible point. */
const Y_MIN = -22;
const Y_MAX = 122;
const X_MIN = 0;
const X_MAX = 146;
const X_TICKS = [30, 60, 90, 120];
const CAPTION_STYLE = { fill: "var(--ink-faint)", fontSize: 11 } as const;

interface PacePoint {
  code: string;
  name: string;
  module: string;
  x: number;
  y: number;
  r: number;
  attempts: number;
  rawSeconds: number;
  n: number;
}

function PaceDot(props: { cx?: number; cy?: number; payload?: PacePoint }): React.ReactElement {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return <g />;
  const { r } = payload;
  const isMath = payload.module === "math";
  return (
    <g>
      {isMath ? (
        <rect
          fill="var(--brand-scale-3)"
          height={r * 2}
          rx={3}
          stroke="var(--surface-raised)"
          strokeWidth={2}
          width={r * 2}
          x={cx - r}
          y={cy - r}
        />
      ) : (
        <circle cx={cx} cy={cy} fill="var(--brand-scale-2)" r={r} stroke="var(--surface-raised)" strokeWidth={2} />
      )}
      <text dominantBaseline="central" fill="var(--on-brand)" fontSize={11} fontWeight={600} textAnchor="middle" x={cx} y={cy}>
        {payload.n}
      </text>
    </g>
  );
}

function SkillKey({ points }: { points: readonly PacePoint[] }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  return (
    <ol className={cn(analyticsSheetClass, "grid grid-cols-1 p-1 @[900px]/sat-analytics:grid-cols-2")}>
      {points.map((point) => (
        <li className="flex items-center gap-3 rounded-lg px-3 py-2" key={point.code}>
          <span
            aria-hidden="true"
            className={cn(
              "grid size-6 shrink-0 place-items-center text-xs font-semibold text-[var(--on-brand)] tabular-nums",
              point.module === "math" ? "rounded-md bg-[var(--brand-scale-3)]" : "rounded-full bg-[var(--brand-scale-2)]",
            )}
          >
            {point.n}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{point.name}</span>
            <span className={analyticsMetaClass}>{copy.pointMeta(point.y, point.rawSeconds, point.attempts)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SatAnalyticsPace({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  const merged = new Map<string, SatSkillRanking>();
  for (const skill of [...stats.weakestSkills, ...stats.strongestSkills]) {
    merged.set(skill.code, skill);
  }
  const points: PacePoint[] = Array.from(merged.values())
    .sort((a, b) => b.accuracyPct - a.accuracyPct)
    .map((skill, index) => ({
      attempts: skill.attempted,
      code: skill.code,
      module: skill.module,
      n: index + 1,
      name: skill.name,
      r: paceDotRadius(skill.attempted),
      rawSeconds: skill.avgTime,
      x: clampPaceSeconds(skill.avgTime),
      y: skill.accuracyPct,
    }));

  const summary = summarizePaceMatrix(
    points.map((point) => ({
      accuracyPct: point.y,
      attempted: point.attempts,
      avgTimeSeconds: point.rawSeconds,
      code: point.code,
      name: point.name,
    })),
  );

  const split = PACE_MATRIX_ACCURACY_SPLIT_PCT;
  const midX = PACE_MATRIX_SECONDS_SPLIT;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className={cn(analyticsGroupLabelClass, "whitespace-nowrap")}>{SAT_ANALYTICS_COPY.tabs.pace}</h3>
            <span className="text-xs text-[var(--ink-faint)]">{copy.subtitle}</span>
          </div>
          <ul className="flex items-center gap-4 text-xs text-[var(--ink-secondary)]">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--brand-scale-2)]" />
              {copy.legendReading}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-[var(--brand-scale-3)]" />
              {copy.legendMath}
            </li>
          </ul>
        </div>
        <div className={cn(analyticsSheetClass, "p-4")}>
          <ChartFigure summary={summary}>
            <ChartContainer className="aspect-[4/3] max-h-[460px] w-full @[640px]/sat-analytics:aspect-video" config={{}}>
              <ScatterChart margin={{ bottom: 20, left: 4, right: 20, top: 8 }}>
                <CartesianGrid stroke="var(--hairline)" vertical={false} />
                <ReferenceArea
                  fill="var(--brand-subtle)"
                  ifOverflow="visible"
                  label={{ ...CAPTION_STYLE, position: "insideTopLeft", value: copy.quadrants.fastAccurate }}
                  x1={X_MIN}
                  x2={midX}
                  y1={split}
                  y2={Y_MAX}
                />
                <ReferenceArea
                  fill="transparent"
                  ifOverflow="visible"
                  label={{ ...CAPTION_STYLE, position: "insideTopRight", value: copy.quadrants.accurateSlow }}
                  x1={midX}
                  x2={X_MAX}
                  y1={split}
                  y2={Y_MAX}
                />
                <ReferenceArea
                  fill="transparent"
                  ifOverflow="visible"
                  label={{ ...CAPTION_STYLE, position: "insideBottomLeft", value: copy.quadrants.fastInaccurate }}
                  x1={X_MIN}
                  x2={midX}
                  y1={Y_MIN}
                  y2={split}
                />
                <ReferenceArea
                  fill="transparent"
                  ifOverflow="visible"
                  label={{ ...CAPTION_STYLE, position: "insideBottomRight", value: copy.quadrants.slowInaccurate }}
                  x1={midX}
                  x2={X_MAX}
                  y1={Y_MIN}
                  y2={split}
                />
                <XAxis
                  axisLine={{ stroke: "var(--edge)" }}
                  dataKey="x"
                  domain={[X_MIN, X_MAX]}
                  label={{ ...CAPTION_STYLE, offset: -8, position: "insideBottom", value: copy.axisSeconds }}
                  tickFormatter={(value: number) => `${value}s`}
                  tickLine={false}
                  ticks={X_TICKS}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="y"
                  domain={[Y_MIN, Y_MAX]}
                  tickFormatter={(value: number) => `${value}%`}
                  tickLine={false}
                  ticks={[0, 50, 100]}
                  type="number"
                  width={40}
                />
                <ReferenceLine stroke="var(--edge-strong)" strokeDasharray="4 3" x={midX} />
                <ReferenceLine stroke="var(--edge-strong)" strokeDasharray="4 3" y={split} />
                <Scatter data={points} isAnimationActive={false} shape={PaceDot} />
                <Tooltip
                  content={({ payload }) => {
                    const point = payload?.[0]?.payload as PacePoint | undefined;
                    if (!point) return null;
                    return (
                      <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-raised)] p-2 text-xs shadow-[var(--elevation-2)]">
                        <p className="font-medium">{point.name}</p>
                        <p className="tabular-nums">{copy.pointMeta(point.y, point.rawSeconds, point.attempts)}</p>
                      </div>
                    );
                  }}
                  cursor={false}
                />
              </ScatterChart>
            </ChartContainer>
          </ChartFigure>
        </div>
      </div>
      <SkillKey points={points} />
    </div>
  );
}
