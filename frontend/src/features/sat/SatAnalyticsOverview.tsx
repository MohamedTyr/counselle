/**
 * The Overview tab (ui-spec §5, §7; parity A2-A6): one headline figure, the
 * two sections side by side, where each question stands now, and the skills
 * worth another look. Greens mark progress; a question that is not right
 * yet is neutral — it is a to-do, not an alarm.
 */
import type React from "react";

import type { SatStatsResponse } from "@/api/sat/types";
import { Button } from "@/components/ui/button";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { AnalyticsMeter } from "@/features/sat/SatAnalyticsMeter";
import { formatDuration, hasSkillData, summarizeDonut } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import {
  analyticsGroupLabelClass,
  analyticsMetaClass,
  analyticsSheetClass,
} from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";

/** Below this many questions the headline is flagged as a small sample. */
const SMALL_SAMPLE_QUESTIONS = 10;

function sectionName(module: string): string {
  return module === "math" ? SAT_ANALYTICS_COPY.sections.math : SAT_ANALYTICS_COPY.sections.ebrw;
}

function SectionRow({
  accuracyPct,
  avgSeconds,
  name,
  questions,
}: {
  name: string;
  questions: number;
  accuracyPct: number;
  avgSeconds: number;
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.overview;
  const started = questions > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-sm font-semibold tabular-nums">{started ? `${accuracyPct}%` : "—"}</span>
      </div>
      <AnalyticsMeter label={`${name} first-try accuracy`} value={started ? accuracyPct : null} />
      <span className={analyticsMetaClass}>
        {started ? copy.sectionMeta(questions, avgSeconds) : copy.sectionNotStarted}
      </span>
    </div>
  );
}

function Headline({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.overview;
  const questions = stats.uniqueQuestionsAttempted;
  return (
    <section className="flex flex-col gap-3 p-6" aria-labelledby="sat-headline">
      <h3 className="text-[13px] font-medium text-[var(--ink-secondary)]" id="sat-headline">
        {copy.headline}
      </h3>
      <p className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {stats.firstTryOverallAccuracyPct}
        <span className="ml-0.5 text-2xl text-[var(--ink-faint)]">%</span>
      </p>
      <p className="max-w-[36ch] text-sm text-[var(--ink-secondary)]">
        {copy.headlineLine(stats.firstTryOverallAccuracyPct, questions)}
      </p>
      {questions < SMALL_SAMPLE_QUESTIONS && (
        <p className="max-w-[36ch] text-xs text-[var(--ink-faint)]">{copy.smallSampleNote(questions)}</p>
      )}
    </section>
  );
}

function Standing({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.overview;
  const neverMissed = Math.max(0, stats.uniqueCorrect - stats.totalUpsolvedCount);
  const parts = [
    { count: neverMissed, label: copy.standing.neverMissed, tone: "bg-[var(--brand-scale-2)]" },
    { count: stats.totalUpsolvedCount, label: copy.standing.upsolved, tone: "bg-[var(--brand-scale-1)]" },
    { count: stats.uniqueIncorrect, label: copy.standing.unsolved, tone: "bg-[var(--edge-strong)]" },
  ];
  const summary = summarizeDonut({
    neverMissed,
    unsolved: stats.uniqueIncorrect,
    upsolved: stats.totalUpsolvedCount,
  });
  return (
    <div className="flex flex-col gap-2">
      <h3 className={analyticsGroupLabelClass}>{copy.standingHeading}</h3>
      <div className={cn(analyticsSheetClass, "flex flex-1 flex-col gap-4 p-5")}>
        <ChartFigure summary={summary}>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--surface-inset)]">
            {parts
              .filter((part) => part.count > 0)
              .map((part) => (
                <div className={part.tone} key={part.label} style={{ flexGrow: part.count }} />
              ))}
          </div>
        </ChartFigure>
        <ul className="flex flex-col gap-2 text-sm">
          {parts.map((part) => (
            <li className="flex items-center justify-between gap-3" key={part.label}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className={cn("size-2.5 rounded-full", part.tone)} />
                {part.label}
              </span>
              <span className="font-medium tabular-nums">{part.count}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--ink-faint)]">{copy.standingNote}</p>
      </div>
    </div>
  );
}

function StatList({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.overview.stats;
  const rows: readonly [string, string][] = [
    [copy.rightNow, copy.rightNowValue(stats.uniqueCorrect, stats.uniqueQuestionsAttempted)],
    [copy.corrected, String(stats.totalUpsolvedCount)],
    [copy.overallAccuracy, `${stats.overallAccuracyPct}%`],
    [copy.averagePace, formatDuration(stats.avgTimeSeconds)],
    [copy.timePractised, formatDuration(stats.ebrw.totalTimeSeconds + stats.math.totalTimeSeconds)],
  ];
  return (
    <dl className={cn(analyticsSheetClass, "flex flex-col self-end px-5")}>
      {rows.map(([label, value]) => (
        <div
          className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-3 last:border-b-0"
          key={label}
        >
          <dt className="text-sm text-[var(--ink-secondary)]">{label}</dt>
          <dd className="text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
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

  return (
    <div className="flex flex-col gap-8">
      <div
        className={cn(
          analyticsSheetClass,
          "grid grid-cols-1 divide-y divide-[var(--hairline)] @[760px]/sat-analytics:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @[760px]/sat-analytics:divide-x @[760px]/sat-analytics:divide-y-0",
        )}
      >
        <Headline stats={stats} />
        <section className="flex flex-col gap-5 p-6" aria-labelledby="sat-sections">
          <h3 className="text-[13px] font-medium text-[var(--ink-secondary)]" id="sat-sections">
            {copy.sectionsHeading}
          </h3>
          <SectionRow
            accuracyPct={stats.ebrw.firstTryAccuracyPct}
            avgSeconds={stats.ebrw.avgTimeSeconds}
            name={SAT_ANALYTICS_COPY.sections.ebrw}
            questions={stats.ebrw.uniqueAttempted}
          />
          <SectionRow
            accuracyPct={stats.math.firstTryAccuracyPct}
            avgSeconds={stats.math.avgTimeSeconds}
            name={SAT_ANALYTICS_COPY.sections.math}
            questions={stats.math.uniqueAttempted}
          />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-8 @[760px]/sat-analytics:grid-cols-2">
        <Standing stats={stats} />
        <StatList stats={stats} />
      </div>

      {hasSkillData(weakest) && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className={analyticsGroupLabelClass}>{copy.skillsToReinforce.heading}</h3>
            <span className="text-xs text-[var(--ink-faint)]">{copy.skillsToReinforce.subtitle}</span>
          </div>
          <ul className={cn(analyticsSheetClass, "overflow-hidden")}>
            {weakest.map((skill) => (
              <li
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 hover:bg-[var(--canvas-hover)] border-b border-[var(--hairline)] last:border-b-0"
                key={skill.code}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{skill.name}</span>
                  <span className={analyticsMetaClass}>
                    {sectionName(skill.module)} · {copy.skillsToReinforce.attemptsAndPace(skill.attempted, skill.avgTime)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">{skill.accuracyPct}%</span>
                  <Button onClick={() => onDrill(skill.code)} size="sm" variant="outline">
                    {copy.skillsToReinforce.practiceDrill}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
