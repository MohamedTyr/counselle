/**
 * The Radar web tab (ui-spec §5, §7; parity A7, A7a). Eight domain axes —
 * first-try (filled) vs overall (dashed) — plus the domain-summary side
 * list, which carries the same numbers as text (S15's honesty fix: an
 * axis with no data reads "no data", never a measured low score).
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
} from "recharts";

import type { SatStatsResponse } from "@/api/sat/types";
import { ChartContainer } from "@/components/ui/chart";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { AnalyticsMeter } from "@/features/sat/SatAnalyticsMeter";
import { analyticsGroupLabelClass, analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";
import { skipMissingVertices, summarizeRadar } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";

/** The eight short axis/tooltip forms upstream uses (A7). Not in
 * `sat-copy.ts` — this file owns the one place they're needed and that
 * module is outside this phase's file ownership. */
const DOMAIN_SHORT_LABEL: Record<string, string> = {
  CAS: "Craft & Struct",
  EOI: "Expr of Ideas",
  H: "Algebra",
  INI: "Info & Ideas",
  P: "Adv Math",
  Q: "Data & Stats",
  S: "Geom & Trig",
  SEC: "Std English",
};

/** Below this container width the full domain names would not fit around
 * the web, so the axes carry the short forms. */
const NARROW_CONTAINER_PX = 520;
const WRAP_FULL_CHARS = 18;
const WRAP_SHORT_CHARS = 10;
const RADAR_MARGIN_WIDE = { bottom: 36, left: 96, right: 96, top: 36 } as const;
const RADAR_MARGIN_NARROW = { bottom: 36, left: 36, right: 36, top: 36 } as const;
/** Between the top and top-right axes, clear of every axis label. */
const RADIUS_LABEL_ANGLE = 67.5;
const TICK_LINE_EM = 1.15;

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The outer ring is the only one labelled, upright rather than rotated
 * with the axis. */
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
}

function makeAxisTick(maxChars: number, fontSize: number, noData: readonly boolean[]) {
  return function AxisTick({ x = 0, y = 0, textAnchor, payload, index = 0 }: AxisTickProps): React.ReactElement {
    const lines = wrapLabel(payload?.value ?? "", maxChars);
    if (noData[index]) lines.push(SAT_ANALYTICS_COPY.radar.noData);
    return (
      <text fill="var(--ink-secondary)" fontSize={fontSize} textAnchor={textAnchor} x={x} y={y}>
        {lines.map((line, lineIndex) => (
          <tspan
            dy={lineIndex === 0 ? `${(-(lines.length - 1) * TICK_LINE_EM) / 2 + 0.35}em` : `${TICK_LINE_EM}em`}
            fill={noData[index] && lineIndex === lines.length - 1 ? "var(--ink-faint)" : undefined}
            key={line}
            x={x}
          >
            {line}
          </tspan>
        ))}
      </text>
    );
  };
}

interface RadarRow {
  code: string;
  label: string;
  fullName: string;
  /** Plotted radii; an axis with no data follows the edge between its
   * neighbours (`skipMissingVertices`) rather than dipping to 0%. */
  firstTry: number;
  overall: number;
  overallPct: number;
  hasFirst: boolean;
  hasOverall: boolean;
  uniqueQuestions: number;
  avgTimeSeconds: number;
  firstTryAccuracyPct: number;
}

export function SatAnalyticsRadar({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.radar;
  // The eight domains are a closed taxonomy set (S17) — hardcoding the
  // eight codes/names here (rather than fetching `/taxonomy` a second
  // time) keeps this tab a pure function of `stats`, matching
  // `sat-analytics.ts`'s own no-fetch leaf-module discipline. The codes
  // are load-bearing (`domain/sat/taxonomy.py`, `config/assets/sat/taxonomy.yaml`)
  // and unlikely to change without a taxonomy version bump this file would
  // need updating for regardless.
  const domains: readonly { code: string; name: string }[] = [
    { code: "CAS", name: "Craft and Structure" },
    { code: "EOI", name: "Expression of Ideas" },
    { code: "INI", name: "Information and Ideas" },
    { code: "SEC", name: "Standard English Conventions" },
    { code: "H", name: "Algebra" },
    { code: "P", name: "Advanced Math" },
    { code: "Q", name: "Problem-Solving and Data Analysis" },
    { code: "S", name: "Geometry and Trigonometry" },
  ];

  const measured = domains.map((domain) => {
    const perf = stats.domainStats[domain.code];
    const hasFirst = (perf?.uniqueQuestions ?? 0) > 0;
    const hasOverall = (perf?.totalAttempts ?? 0) > 0;
    return {
      avgTimeSeconds: perf?.avgTimeSeconds ?? 0,
      code: domain.code,
      firstTryRaw: hasFirst ? (perf?.firstTryAccuracyPct ?? 0) : null,
      firstTryAccuracyPct: perf?.firstTryAccuracyPct ?? 0,
      fullName: perf?.name ?? domain.name,
      hasFirst,
      hasOverall,
      label: DOMAIN_SHORT_LABEL[domain.code] ?? domain.code,
      overallRaw: hasOverall ? (perf?.overallAccuracyPct ?? 0) : null,
      overallPct: perf?.overallAccuracyPct ?? 0,
      uniqueQuestions: perf?.uniqueQuestions ?? 0,
    };
  });

  const firstTryPlot = skipMissingVertices(measured.map((row) => row.firstTryRaw));
  const overallPlot = skipMissingVertices(measured.map((row) => row.overallRaw));
  const rows: RadarRow[] = measured.map((row, index) => ({
    ...row,
    firstTry: firstTryPlot[index] ?? 0,
    overall: overallPlot[index] ?? 0,
  }));

  const [chartRef, containerWidth] = useContainerWidth();
  const narrow = containerWidth > 0 && containerWidth < NARROW_CONTAINER_PX;
  const chartRows = rows.map((row) => ({ ...row, label: narrow ? row.label : row.fullName }));
  const axisTick = makeAxisTick(
    narrow ? WRAP_SHORT_CHARS : WRAP_FULL_CHARS,
    narrow ? 11 : 12,
    rows.map((row) => !row.hasFirst),
  );

  const summary = summarizeRadar(
    rows.map((row) => ({
      firstTryAccuracyPct: row.firstTryAccuracyPct,
      hasData: row.hasFirst,
      name: row.fullName,
    })),
  );

  return (
    <div className="grid grid-cols-1 gap-8 @[900px]/sat-analytics:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h3 className={analyticsGroupLabelClass}>{copy.chartHeading}</h3>
          <ul className="flex items-center gap-4 text-xs text-[var(--ink-secondary)]">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--brand-scale-2)]" />
              {copy.legendFirstTry}
            </li>
            <li className="flex items-center gap-1.5">
              <svg aria-hidden="true" height="2" width="16">
                <line stroke="var(--ink-secondary)" strokeDasharray="4 3" strokeWidth="2" x1="0" x2="16" y1="1" y2="1" />
              </svg>
              {copy.legendOverall}
            </li>
          </ul>
        </div>
        <div
          className={cn(analyticsSheetClass, "flex flex-col justify-center p-2 @[900px]/sat-analytics:flex-1 @[560px]/sat-analytics:p-4")}
          ref={chartRef}
        >
          <ChartFigure summary={summary}>
            <ChartContainer className="mx-auto aspect-square max-h-[520px] w-full" config={{}}>
              <RadarChart
                data={chartRows}
                margin={narrow ? RADAR_MARGIN_NARROW : RADAR_MARGIN_WIDE}
                outerRadius={narrow ? "72%" : "76%"}
              >
                <PolarGrid stroke="var(--edge)" />
                <PolarAngleAxis dataKey="label" tick={axisTick} />
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
                  fill="var(--brand-scale-2)"
                  fillOpacity={0.22}
                  dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: RadarRow }) =>
                    payload?.hasFirst ? (
                      <circle cx={cx} cy={cy} fill="var(--brand-scale-2)" key={payload.code} r={3.5} />
                    ) : (
                      <g key={payload?.code} />
                    )
                  }
                  isAnimationActive={false}
                  stroke="var(--brand-scale-2)"
                  strokeWidth={2}
                />
                <Radar
                  dataKey="overall"
                  fill="none"
                  isAnimationActive={false}
                  stroke="var(--ink-secondary)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                />
                <Tooltip
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as RadarRow | undefined;
                    if (!row) return null;
                    return (
                      <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-raised)] p-2 text-xs shadow-[var(--elevation-2)]">
                        <p className="font-medium">{row.fullName}</p>
                        <p className="tabular-nums">
                          {copy.tooltip.firstTry(row.hasFirst ? `${row.firstTryAccuracyPct}%` : copy.noData)}
                        </p>
                        <p className="tabular-nums">
                          {copy.tooltip.overall(row.hasOverall ? `${row.overallPct}%` : copy.noData)}
                        </p>
                      </div>
                    );
                  }}
                />
              </RadarChart>
            </ChartContainer>
          </ChartFigure>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={analyticsGroupLabelClass}>{copy.domainSummary}</h3>
        <ul className={cn(analyticsSheetClass, "flex flex-col px-5")}>
          {rows.map((row) => (
            <li
              className="flex flex-col gap-1.5 border-b border-[var(--hairline)] py-3 last:border-b-0"
              key={row.code}
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 font-medium">{row.fullName}</span>
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap tabular-nums",
                    row.hasFirst ? "font-medium" : "text-xs text-[var(--ink-faint)]",
                  )}
                >
                  {row.hasFirst ? `${row.firstTryAccuracyPct}%` : copy.noData}
                </span>
              </div>
              <AnalyticsMeter
                label={`${row.fullName} first try`}
                value={row.hasFirst ? row.firstTryAccuracyPct : null}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
