/**
 * The Radar web tab (ui-spec §5, §7; parity A7, A7a). Eight domain axes —
 * first-try (filled) vs overall (dashed) — plus the domain-summary side
 * list, which carries the same numbers as text (S15's honesty fix: an
 * axis with no data reads "no data", never a measured low score).
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { SatStatsResponse } from "@/api/sat/types";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { AnalyticsMeter } from "@/features/sat/SatAnalyticsMeter";
import { analyticsGroupLabelClass, analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";
import { canDrawWeb, skipMissingVertices, summarizeRadar } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { type RadarRow, SatAnalyticsRadarChart } from "@/features/sat/SatAnalyticsRadarChart";

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
    firstTry: firstTryPlot[index] ?? null,
    overall: overallPlot[index] ?? null,
  }));
  const drawFirstWeb = canDrawWeb(firstTryPlot, measured.filter((row) => row.hasFirst).length);
  const drawOverallWeb = canDrawWeb(overallPlot, measured.filter((row) => row.hasOverall).length);

  const [chartRef, containerWidth] = useContainerWidth();
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
            <SatAnalyticsRadarChart
              drawFirstWeb={drawFirstWeb}
              drawOverallWeb={drawOverallWeb}
              rows={rows}
              width={containerWidth}
            />
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
