/**
 * The Score bands tab (ui-spec §5, §7; parity A9, S14). Accuracy per
 * difficulty band as columns, with the average pace and attempt count in
 * rows beneath, so every number sits under the band it belongs to. A band
 * with no attempts draws no column rather than a measurement nobody took
 * (S14's honesty fix). Two measures with different units stay in separate
 * rows instead of sharing one chart axis.
 */
import type React from "react";
import { useState } from "react";

import type { SatDifficultyBandStat, SatStatsResponse } from "@/api/sat/types";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { formatDuration, summarizeScoreBands } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";

type Section = "all" | "ebrw" | "math";

const BANDS = [1, 2, 3, 4, 5, 6, 7] as const;
const COLUMN_HEIGHT_CLASS = "h-44 @[640px]/sat-analytics:h-56";
const GRID_CLASS = "grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] items-end gap-x-1.5 @[640px]/sat-analytics:gap-x-3";

interface BandRow {
  band: number;
  accuracy: number | null;
  pace: number | null;
  attempted: number;
}

function BandColumn({ row }: { row: BandRow }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.bands;
  if (row.accuracy === null) {
    return (
      <div
        className={cn(
          COLUMN_HEIGHT_CLASS,
          "flex items-end justify-center rounded-md border border-dashed border-[var(--edge)] pb-2 text-xs text-[var(--ink-faint)]",
        )}
      >
        {copy.emptyBand}
      </div>
    );
  }
  return (
    <div className={cn(COLUMN_HEIGHT_CLASS, "relative rounded-md bg-[var(--surface-inset)]")}>
      {row.accuracy > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 rounded-md bg-[var(--progress-fill)]"
          style={{ height: `${Math.max(row.accuracy, 2)}%` }}
        />
      )}
      <span
        className="absolute inset-x-0 text-center text-xs font-medium tabular-nums"
        style={{ bottom: row.accuracy > 0 ? `calc(${Math.max(row.accuracy, 2)}% + 4px)` : "4px" }}
      >
        {row.accuracy}%
      </span>
    </div>
  );
}

export function SatAnalyticsBands({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.bands;
  const [section, setSection] = useState<Section>("all");

  const source: Record<number, SatDifficultyBandStat> =
    section === "ebrw"
      ? stats.ebrw.difficultyStats
      : section === "math"
        ? stats.math.difficultyStats
        : stats.difficultyStats;

  const rows: BandRow[] = BANDS.map((band) => {
    const stat = source[band];
    const attempted = stat?.attempted ?? 0;
    return {
      accuracy: attempted > 0 ? stat.accuracyPct : null,
      attempted,
      band,
      pace: attempted > 0 ? stat.avgTimeSeconds : null,
    };
  });

  const summary = summarizeScoreBands(
    rows.map((row) => ({
      accuracyPct: row.accuracy ?? 0,
      attempted: row.attempted,
      avgTimeSeconds: row.pace ?? 0,
      band: row.band,
    })),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs onValueChange={(value) => setSection(value as Section)} value={section}>
          <TabsList aria-label={SAT_ANALYTICS_COPY.sections.label} variant="pill">
            <TabsTab value="all">{copy.sectionSegments.all}</TabsTab>
            <TabsTab value="ebrw">{copy.sectionSegments.ebrw}</TabsTab>
            <TabsTab value="math">{copy.sectionSegments.math}</TabsTab>
          </TabsList>
        </Tabs>
      </div>

      <div className={cn(analyticsSheetClass, "p-4 @[640px]/sat-analytics:p-6")}>
        <ChartFigure summary={summary}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--ink-secondary)]">{copy.accuracyRow}</p>
            <div className={cn(GRID_CLASS, "pt-4")}>
              <span aria-hidden="true" />
              {rows.map((row) => (
                <BandColumn key={row.band} row={row} />
              ))}
            </div>
            <div className={cn(GRID_CLASS, "items-center border-t border-[var(--hairline)] pt-3 text-center")}>
              <span className="text-left text-xs text-[var(--ink-secondary)]">{copy.heading}</span>
              {rows.map((row) => (
                <span className="text-sm font-semibold tabular-nums" key={row.band}>
                  {row.band}
                </span>
              ))}
              <span className="col-span-7 col-start-2 pt-1 text-left text-[11px] leading-none text-[var(--ink-faint)]">
                {copy.bandDirection}
              </span>
            </div>
            <div className={cn(GRID_CLASS, "items-center text-center text-xs tabular-nums")}>
              <span className="text-left text-[var(--ink-secondary)]">{copy.paceRow}</span>
              {rows.map((row) => (
                <span className={row.pace === null ? "text-[var(--ink-faint)]" : undefined} key={row.band}>
                  {row.pace === null ? copy.emptyBand : formatDuration(row.pace)}
                </span>
              ))}
            </div>
            <div className={cn(GRID_CLASS, "items-center text-center text-xs tabular-nums")}>
              <span className="text-left text-[var(--ink-secondary)]">{copy.attemptsRow}</span>
              {rows.map((row) => (
                <span className={row.attempted === 0 ? "text-[var(--ink-faint)]" : undefined} key={row.band}>
                  {row.attempted === 0 ? copy.emptyBand : row.attempted}
                </span>
              ))}
            </div>
          </div>
        </ChartFigure>
      </div>
    </div>
  );
}
