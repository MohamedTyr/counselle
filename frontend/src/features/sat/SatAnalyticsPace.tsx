/**
 * The Pace matrix tab (ui-spec §5, §7; parity A8, S13). A scatter of the
 * union of the four weakest and four strongest skills (by first-try
 * accuracy) — never "every skill", whatever the subtitle upstream prints.
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
  PACE_MATRIX_MAX_SECONDS,
  PACE_MATRIX_MIN_SECONDS,
  PACE_MATRIX_SECONDS_SPLIT,
  paceDotRadius,
  summarizePaceMatrix,
} from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";

interface PacePoint {
  code: string;
  name: string;
  module: string;
  x: number;
  y: number;
  r: number;
  attempts: number;
}

function PaceDot(props: {
  cx?: number;
  cy?: number;
  payload?: PacePoint;
}): React.ReactElement {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return <g />;
  const { r } = payload;
  if (payload.module === "math") {
    return (
      <rect
        fill="none"
        height={r * 2}
        rx={2}
        stroke="var(--ink)"
        strokeWidth={2}
        width={r * 2}
        x={cx - r}
        y={cy - r}
      />
    );
  }
  return <circle cx={cx} cy={cy} fill="var(--ink)" r={r} />;
}

export function SatAnalyticsPace({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.pace;
  const merged = new Map<string, SatSkillRanking>();
  for (const skill of [...stats.weakestSkills, ...stats.strongestSkills]) {
    merged.set(skill.code, skill);
  }
  const points: PacePoint[] = Array.from(merged.values()).map((skill) => ({
    attempts: skill.attempted,
    code: skill.code,
    module: skill.module,
    name: skill.name,
    r: paceDotRadius(skill.attempted),
    x: clampPaceSeconds(skill.avgTime),
    y: skill.accuracyPct,
  }));

  const summary = summarizePaceMatrix(
    points.map((point) => ({
      accuracyPct: point.y,
      attempted: point.attempts,
      avgTimeSeconds: point.x,
      code: point.code,
      name: point.name,
    })),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ink-secondary)]">{copy.subtitle}</p>
      <ChartFigure summary={summary}>
        <ChartContainer className="aspect-video max-h-[420px] w-full" config={{}}>
          <ScatterChart margin={{ bottom: 24, left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="var(--edge)" />
            <ReferenceArea
              fill="var(--surface-inset)"
              x1={PACE_MATRIX_MIN_SECONDS}
              x2={PACE_MATRIX_SECONDS_SPLIT}
              y1={PACE_MATRIX_ACCURACY_SPLIT_PCT}
              y2={100}
              label={{ position: "insideTopLeft", value: copy.quadrants.fastAccurate }}
            />
            <ReferenceArea
              fill="transparent"
              x1={PACE_MATRIX_SECONDS_SPLIT}
              x2={PACE_MATRIX_MAX_SECONDS}
              y1={PACE_MATRIX_ACCURACY_SPLIT_PCT}
              y2={100}
              label={{ position: "insideTopRight", value: copy.quadrants.accurateSlow }}
            />
            <ReferenceArea
              fill="transparent"
              x1={PACE_MATRIX_MIN_SECONDS}
              x2={PACE_MATRIX_SECONDS_SPLIT}
              y1={0}
              y2={PACE_MATRIX_ACCURACY_SPLIT_PCT}
              label={{ position: "insideBottomLeft", value: copy.quadrants.fastInaccurate }}
            />
            <ReferenceArea
              fill="var(--surface-inset)"
              x1={PACE_MATRIX_SECONDS_SPLIT}
              x2={PACE_MATRIX_MAX_SECONDS}
              y1={0}
              y2={PACE_MATRIX_ACCURACY_SPLIT_PCT}
              label={{ position: "insideBottomRight", value: copy.quadrants.slowInaccurate }}
            />
            <XAxis
              dataKey="x"
              domain={[PACE_MATRIX_MIN_SECONDS, PACE_MATRIX_MAX_SECONDS]}
              tickFormatter={(value: number) => `${value}s`}
              ticks={[PACE_MATRIX_MIN_SECONDS, PACE_MATRIX_SECONDS_SPLIT, PACE_MATRIX_MAX_SECONDS]}
              type="number"
            />
            <YAxis
              dataKey="y"
              domain={[0, 100]}
              tickFormatter={(value: number) => `${value}%`}
              ticks={[0, 50, 100]}
              type="number"
            />
            <ReferenceLine stroke="var(--edge-strong)" strokeDasharray="4 3" x={PACE_MATRIX_SECONDS_SPLIT} />
            <ReferenceLine stroke="var(--edge-strong)" strokeDasharray="4 3" y={PACE_MATRIX_ACCURACY_SPLIT_PCT} />
            <Scatter data={points} isAnimationActive={false} shape={PaceDot} />
            <Tooltip
              content={({ payload }) => {
                const point = payload?.[0]?.payload as PacePoint | undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg border bg-popover p-2 text-xs shadow-md">
                    <p className="font-medium">{point.name}</p>
                    <p>{copy.tooltip(point.y, point.x, point.attempts)}</p>
                  </div>
                );
              }}
            />
          </ScatterChart>
        </ChartContainer>
      </ChartFigure>
    </div>
  );
}
