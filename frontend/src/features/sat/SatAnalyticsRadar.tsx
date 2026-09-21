/**
 * The Radar web tab (ui-spec §5, §7; parity A7, A7a). Eight domain axes —
 * first-try (filled) vs overall (dashed) — plus the domain-summary side
 * list, which carries the same numbers as text (S15's honesty fix: an
 * axis with no data reads "no data", never a measured low score).
 */
import type React from "react";
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
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { radarAxisRatio, summarizeRadar } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";

/** The eight short axis/tooltip forms upstream uses (A7). Not in
 * `sat-copy.ts` — this file owns the one place they're needed and that
 * module is outside this phase's file ownership. */
const DOMAIN_SHORT_LABEL: Record<string, string> = {
  CAS: "Craft & Struct",
  EOI: "Expr of Ideas",
  H: "Algebra",
  INI: "Info & Ideas",
  P: "Adv Math",
  Q: "Data & Problem",
  S: "Geom & Trig",
  SEC: "Std English",
};

interface RadarRow {
  code: string;
  label: string;
  fullName: string;
  firstTry: number;
  overall: number;
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

  const rows: RadarRow[] = domains.map((domain) => {
    const perf = stats.domainStats[domain.code];
    const hasFirst = (perf?.uniqueQuestions ?? 0) > 0;
    const hasOverall = (perf?.totalAttempts ?? 0) > 0;
    return {
      avgTimeSeconds: perf?.avgTimeSeconds ?? 0,
      code: domain.code,
      firstTry: radarAxisRatio(perf?.firstTryAccuracyPct ?? 0, hasFirst) * 100,
      firstTryAccuracyPct: perf?.firstTryAccuracyPct ?? 0,
      fullName: perf?.name ?? domain.name,
      hasFirst,
      hasOverall,
      label: DOMAIN_SHORT_LABEL[domain.code] ?? domain.code,
      overall: radarAxisRatio(perf?.overallAccuracyPct ?? 0, hasOverall) * 100,
      uniqueQuestions: perf?.uniqueQuestions ?? 0,
    };
  });

  const summary = summarizeRadar(
    rows.map((row) => ({
      firstTryAccuracyPct: row.firstTryAccuracyPct,
      hasData: row.hasFirst,
      name: row.fullName,
    })),
  );

  return (
    <div className="grid grid-cols-1 gap-6 @[960px]/sat-analytics:grid-cols-[1fr_320px]">
      <ChartFigure summary={summary}>
        <ChartContainer className="mx-auto aspect-square max-h-[420px]" config={{}}>
          <RadarChart data={rows}>
            <PolarGrid stroke="var(--edge)" />
            <PolarAngleAxis dataKey="label" tick={{ fill: "var(--ink-secondary)", fontSize: 12 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="firstTry"
              fill="var(--brand-scale-2)"
              fillOpacity={0.25}
              isAnimationActive={false}
              stroke="var(--brand-scale-2)"
              strokeWidth={2}
            />
            <Radar
              dataKey="overall"
              fill="none"
              isAnimationActive={false}
              stroke="var(--ink)"
              strokeDasharray="4 3"
              strokeWidth={2}
            />
            <Tooltip
              content={({ payload }) => {
                const row = payload?.[0]?.payload as RadarRow | undefined;
                if (!row) return null;
                return (
                  <div className="rounded-lg border bg-popover p-2 text-xs shadow-md">
                    <p className="font-medium">{row.fullName}</p>
                    <p>
                      {copy.tooltip.firstTry(row.hasFirst ? `${row.firstTryAccuracyPct}%` : copy.noData)}
                    </p>
                    <p>
                      {copy.tooltip.overall(row.hasOverall ? `${Math.round(row.overall)}%` : copy.noData)}
                    </p>
                  </div>
                );
              }}
            />
          </RadarChart>
        </ChartContainer>
      </ChartFigure>

      <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
        <h3 className="text-sm font-semibold">{copy.domainSummary}</h3>
        {rows.map((row) => (
          <div className="flex flex-col gap-1" key={row.code}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{row.fullName}</span>
              <span className="tabular-nums">{row.hasFirst ? `${row.firstTryAccuracyPct}%` : copy.noData}</span>
            </div>
            <Meter max={100} min={0} value={row.hasFirst ? row.firstTryAccuracyPct : 0}>
              <MeterTrack>
                <MeterIndicator variant="neutral" />
              </MeterTrack>
            </Meter>
            <span className="text-xs text-[var(--ink-secondary)]">
              {copy.questionsAndPace(row.uniqueQuestions, row.avgTimeSeconds)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
