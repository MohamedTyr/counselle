/**
 * The Overview tab (ui-spec §5, §7; parity A2-A6). KPI row, section
 * comparison table, the mastery donut, and "Skills to reinforce".
 */
import type React from "react";
import { Cell, Pie, PieChart } from "recharts";

import type { SatStatsResponse } from "@/api/sat/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { hasSkillData, summarizeDonut } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";
import { formatAttemptSeconds, formatPrepTime } from "@/features/sat/sat-format";

function sectionLabel(module: string): string {
  return module === "math" ? SAT_ANALYTICS_COPY.overview.math : SAT_ANALYTICS_COPY.overview.ebrw;
}

function KpiCard({
  badge,
  label,
  line,
  value,
}: {
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  line: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-[var(--surface-inset)] p-6" data-slot="sat-kpi-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--ink-secondary)]">{label}</span>
        {badge}
      </div>
      <span className="text-lg font-medium tabular-nums">{value}</span>
      <span className="text-xs text-[var(--ink-secondary)]">{line}</span>
    </div>
  );
}

export function SatAnalyticsOverview({
  onDrill,
  stats,
}: {
  stats: SatStatsResponse;
  onDrill: (skillCode: string) => void;
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.overview;
  const weakest = stats.weakestSkills.slice(0, 4);

  const neverMissed = Math.max(0, stats.uniqueCorrect - stats.totalUpsolvedCount);
  const donutData = [
    { name: "neverMissed", value: neverMissed },
    { name: "upsolved", value: stats.totalUpsolvedCount },
    { name: "unsolved", value: stats.uniqueIncorrect },
  ];
  const donutSummary = summarizeDonut({
    neverMissed,
    unsolved: stats.uniqueIncorrect,
    upsolved: stats.totalUpsolvedCount,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 @[768px]/sat-analytics:grid-cols-4">
        <KpiCard
          label={copy.firstTryAccuracy}
          line={copy.uniqueAttemptedLine(stats.uniqueQuestionsAttempted)}
          value={`${stats.firstTryOverallAccuracyPct}%`}
        />
        <KpiCard
          badge={<Badge variant="secondary">{stats.ebrw.firstTryAccuracyPct}%</Badge>}
          label={copy.ebrw}
          line={copy.avgAndTotalLine(stats.ebrw.avgTimeSeconds, formatPrepTime(stats.ebrw.totalTimeSeconds))}
          value={stats.ebrw.uniqueAttempted}
        />
        <KpiCard
          badge={<Badge variant="secondary">{stats.math.firstTryAccuracyPct}%</Badge>}
          label={copy.math}
          line={copy.avgAndTotalLine(stats.math.avgTimeSeconds, formatPrepTime(stats.math.totalTimeSeconds))}
          value={stats.math.uniqueAttempted}
        />
        <KpiCard
          badge={<Badge variant="secondary">{copy.correctedSuffix(stats.totalUpsolvedCount)}</Badge>}
          label={copy.upsolve}
          line={copy.unsolvedMistakes(stats.uniqueIncorrect)}
          value={`${stats.uniqueCorrect}/${stats.uniqueQuestionsAttempted}`}
        />
      </div>

      <div className="rounded-xl bg-[var(--surface-inset)] p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>{copy.ebrw}</TableHead>
              <TableHead>{copy.math}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-[var(--ink-secondary)]">
                {copy.sectionComparisonTable.firstTryAccuracy}
              </TableCell>
              <TableCell className="tabular-nums">{stats.ebrw.firstTryAccuracyPct}%</TableCell>
              <TableCell className="tabular-nums">{stats.math.firstTryAccuracyPct}%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-[var(--ink-secondary)]">
                {copy.sectionComparisonTable.overallAccuracy}
              </TableCell>
              <TableCell className="tabular-nums">{stats.ebrw.overallAccuracyPct}%</TableCell>
              <TableCell className="tabular-nums">{stats.math.overallAccuracyPct}%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-[var(--ink-secondary)]">
                {copy.sectionComparisonTable.averagePace}
              </TableCell>
              <TableCell className="tabular-nums">{formatAttemptSeconds(stats.ebrw.avgTimeSeconds)}</TableCell>
              <TableCell className="tabular-nums">{formatAttemptSeconds(stats.math.avgTimeSeconds)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-[var(--ink-secondary)]">
                {copy.sectionComparisonTable.upsolved}
              </TableCell>
              <TableCell className="tabular-nums">{stats.ebrw.upsolvedCount}</TableCell>
              <TableCell className="tabular-nums">{stats.math.upsolvedCount}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 items-center gap-6 @[640px]/sat-analytics:grid-cols-[220px_1fr]">
        <ChartFigure summary={donutSummary}>
          <div className="relative">
            <ChartContainer className="mx-auto aspect-square max-h-56" config={{}}>
              <PieChart>
                <defs>
                  <pattern height={4} id="sat-upsolved-pattern" patternUnits="userSpaceOnUse" width={4}>
                    <rect fill="var(--success-solid)" height={4} width={4} />
                    <circle cx={1} cy={1} fill="var(--surface-raised)" r={0.8} />
                  </pattern>
                </defs>
                <Pie data={donutData} dataKey="value" innerRadius="62%" nameKey="name" outerRadius="100%" strokeWidth={0}>
                  <Cell fill="var(--success-solid)" key="neverMissed" />
                  <Cell fill="url(#sat-upsolved-pattern)" key="upsolved" />
                  <Cell fill="var(--danger-solid)" key="unsolved" />
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-medium tabular-nums">{stats.uniqueQuestionsAttempted}</span>
              <span className="text-xs text-[var(--ink-secondary)]">{copy.donut.attempted}</span>
            </div>
          </div>
        </ChartFigure>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--success-solid)]" />
              {copy.donut.neverMissed}
            </span>
            <span className="tabular-nums">{neverMissed}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <svg aria-hidden="true" className="size-2.5 rounded-full" height={10} width={10}>
                <rect fill="url(#sat-upsolved-pattern)" height={10} rx={5} width={10} />
              </svg>
              {copy.donut.upsolved}
            </span>
            <span className="tabular-nums">{stats.totalUpsolvedCount}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--danger-solid)]" />
              {copy.donut.unsolved}
            </span>
            <span className="tabular-nums">{stats.uniqueIncorrect}</span>
          </div>
        </div>
      </div>

      {hasSkillData(weakest) && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">{copy.skillsToReinforce.heading}</h3>
            <p className="text-xs text-[var(--ink-secondary)]">{copy.skillsToReinforce.subtitle}</p>
          </div>
          <div className="flex flex-col gap-2">
            {weakest.map((skill) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-inset)] px-4 py-3"
                key={skill.code}
              >
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{sectionLabel(skill.module)}</Badge>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{skill.name}</span>
                    <span className="text-xs text-[var(--ink-secondary)]">
                      {copy.skillsToReinforce.attemptsAndPace(skill.attempted, skill.avgTime)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums">{skill.accuracyPct}%</span>
                  <Button onClick={() => onDrill(skill.code)} size="sm" variant="outline">
                    {copy.skillsToReinforce.practiceDrill}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
