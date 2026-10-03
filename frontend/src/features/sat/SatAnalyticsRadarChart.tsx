/**
 * The radar plot itself: eight domain axes, first-try (filled) against all
 * attempts (dashed). Sized from the measured card width so the web fills the
 * card, with the axis labels pushed clear of the outer ring. An axis with no
 * data draws nothing, and fewer than three measured axes show points only.
 */
import type React from "react";
import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
} from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";

export interface RadarRow {
  code: string;
  label: string;
  fullName: string;
  /** Plotted radii; `null` where no honest edge crosses the axis. */
  firstTry: number | null;
  overall: number | null;
  overallPct: number;
  hasFirst: boolean;
  hasOverall: boolean;
  uniqueQuestions: number;
  avgTimeSeconds: number;
  firstTryAccuracyPct: number;
}

/** Below this container width the axes carry the short domain forms. */
export const NARROW_CONTAINER_PX = 520;
const WRAP_FULL_CHARS = 18;
const WRAP_SHORT_CHARS = 10;
/** Width reserved each side for a wrapped axis label plus its offset. */
const LABEL_SPACE_WIDE_PX = 124;
const LABEL_SPACE_NARROW_PX = 78;
/** Room above and below the web for a two-line label. */
const LABEL_SPACE_VERTICAL_PX = 44;
/** Gap between the outer ring and the axis labels. */
const LABEL_OFFSET_PX = 16;
const MAX_RADIUS_PX = 230;
const MIN_RADIUS_PX = 60;
/** Between the top and top-right axes, clear of every axis label. */
const RADIUS_LABEL_ANGLE = 67.5;
const TICK_LINE_EM = 1.15;
const DOT_RADIUS_PX = 3.5;

function RingTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string | number };
}): React.ReactElement {
  return payload?.value === 100 ? (
    <text fill="var(--ink-faint)" fontSize={10} textAnchor="start" x={Number(x) + 4} y={y}>
      100%
    </text>
  ) : (
    <g />
  );
}

function wrapLabel(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

interface AxisTickProps {
  x?: number | string;
  y?: number | string;
  textAnchor?: "start" | "middle" | "end" | "inherit";
  payload?: { value: string };
  index?: number;
  maxChars?: number;
  fontSize?: number;
  noData?: readonly boolean[];
}

function AxisTick({
  x = 0,
  y = 0,
  textAnchor,
  payload,
  index = 0,
  maxChars = WRAP_FULL_CHARS,
  fontSize = 12,
  noData = [],
}: AxisTickProps): React.ReactElement {
  const lines = wrapLabel(payload?.value ?? "", maxChars);
  const missing = noData[index] === true;
  if (missing) lines.push(SAT_ANALYTICS_COPY.radar.noData);
  return (
    <text fill="var(--ink-secondary)" fontSize={fontSize} textAnchor={textAnchor} x={x} y={y}>
      {lines.map((line, lineIndex) => (
        <tspan
          dy={lineIndex === 0 ? `${(-(lines.length - 1) * TICK_LINE_EM) / 2 + 0.35}em` : `${TICK_LINE_EM}em`}
          fill={missing && lineIndex === lines.length - 1 ? "var(--ink-faint)" : undefined}
          key={line}
          x={x}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function measuredDot(kind: "first" | "overall") {
  return function Dot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: RadarRow }): React.ReactElement {
    const present = kind === "first" ? payload?.hasFirst : payload?.hasOverall;
    if (!present) return <g key={payload?.code} />;
    return kind === "first" ? (
      <circle cx={cx} cy={cy} fill="var(--brand-scale-2)" key={payload?.code} r={DOT_RADIUS_PX} />
    ) : (
      <circle
        cx={cx}
        cy={cy}
        fill="var(--surface-raised)"
        key={payload?.code}
        r={DOT_RADIUS_PX - 0.5}
        stroke="var(--ink-secondary)"
        strokeWidth={1.5}
      />
    );
  };
}

const FIRST_TRY_DOT = measuredDot("first");
const OVERALL_DOT = measuredDot("overall");

function RadarTooltip({ payload }: { payload?: readonly { payload?: unknown }[] }): React.ReactElement | null {
  const copy = SAT_ANALYTICS_COPY.radar;
  const row = payload?.[0]?.payload as RadarRow | undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-raised)] p-2 text-xs shadow-[var(--elevation-2)]">
      <p className="font-medium">{row.fullName}</p>
      <p className="tabular-nums">
        {copy.tooltip.firstTry(row.hasFirst ? `${row.firstTryAccuracyPct}%` : copy.noData)}
      </p>
      <p className="tabular-nums">{copy.tooltip.overall(row.hasOverall ? `${row.overallPct}%` : copy.noData)}</p>
    </div>
  );
}

export function SatAnalyticsRadarChart({
  drawFirstWeb,
  drawOverallWeb,
  rows,
  width,
}: {
  rows: readonly RadarRow[];
  /** Measured width of the card, 0 before the first measurement. */
  width: number;
  drawFirstWeb: boolean;
  drawOverallWeb: boolean;
}): React.ReactElement {
  const narrow = width > 0 && width < NARROW_CONTAINER_PX;
  const labelSpace = narrow ? LABEL_SPACE_NARROW_PX : LABEL_SPACE_WIDE_PX;
  const radius = Math.max(MIN_RADIUS_PX, Math.min(MAX_RADIUS_PX, (width - 2 * labelSpace) / 2));
  const height = 2 * radius + 2 * LABEL_SPACE_VERTICAL_PX;

  const chartRows = useMemo(
    () => rows.map((row) => ({ ...row, label: narrow ? row.label : row.fullName })),
    [rows, narrow],
  );
  const tick = useMemo(
    () => (
      <AxisTick
        fontSize={narrow ? 11 : 12}
        maxChars={narrow ? WRAP_SHORT_CHARS : WRAP_FULL_CHARS}
        noData={rows.map((row) => !row.hasFirst)}
      />
    ),
    [rows, narrow],
  );

  return (
    <ChartContainer className="aspect-auto w-full" config={{}} style={{ height }}>
      <RadarChart data={chartRows} margin={{ bottom: 0, left: 0, right: 0, top: 0 }} outerRadius={radius}>
        <PolarGrid stroke="var(--edge)" />
        <PolarAngleAxis dataKey="label" tick={tick} tickLine={false} tickSize={LABEL_OFFSET_PX} />
        <PolarRadiusAxis
          angle={RADIUS_LABEL_ANGLE}
          axisLine={false}
          domain={[0, 100]}
          tick={RingTick}
          tickCount={2}
          tickLine={false}
        />
        <Radar
          dataKey="firstTry"
          dot={FIRST_TRY_DOT}
          fill={drawFirstWeb ? "var(--brand-scale-2)" : "none"}
          fillOpacity={0.22}
          isAnimationActive={false}
          stroke={drawFirstWeb ? "var(--brand-scale-2)" : "none"}
          strokeWidth={2}
        />
        <Radar
          dataKey="overall"
          dot={drawOverallWeb ? false : OVERALL_DOT}
          fill="none"
          isAnimationActive={false}
          stroke={drawOverallWeb ? "var(--ink-secondary)" : "none"}
          strokeDasharray="4 3"
          strokeWidth={2}
        />
        <Tooltip content={RadarTooltip} />
      </RadarChart>
    </ChartContainer>
  );
}
