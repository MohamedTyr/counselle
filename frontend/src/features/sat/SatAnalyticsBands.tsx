/**
 * The Score bands tab (ui-spec §5, §7; parity A9, S14). Bars = accuracy
 * per band, overlaid with a pace line — a band with no attempts draws no
 * bar and breaks the line rather than pulling it down to a measurement
 * nobody took (S14's honesty fix).
 */
import type React from "react";
import { useState } from "react";
import { Bar, ComposedChart, Line, XAxis, YAxis } from "recharts";

import type { SatDifficultyBandStat, SatStatsResponse } from "@/api/sat/types";
import { ChartContainer } from "@/components/ui/chart";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { clampScoreBandPace, summarizeScoreBands } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";

type Section = "all" | "ebrw" | "math";

const BANDS = [1, 2, 3, 4, 5, 6, 7] as const;

interface BandRow {
  band: number;
  accuracy: number | null;
  pace: number | null;
  attempted: number;
}

export function SatAnalyticsBands({ stats }: { stats: SatStatsResponse }): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.bands;
  const [section, setSection] = useState<Section>("all");

  const source: Record<number, SatDifficultyBandStat> =
    section === "ebrw" ? stats.ebrw.difficultyStats : section === "math" ? stats.math.difficultyStats : stats.difficultyStats;

  const rows: BandRow[] = BANDS.map((band) => {
    const stat = source[band];
    const attempted = stat?.attempted ?? 0;
    return {
      accuracy: attempted > 0 ? stat.accuracyPct : null,
      attempted,
      band,
      pace: attempted > 0 ? clampScoreBandPace(stat.avgTimeSeconds) : null,
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

  const options: readonly SegmentedControlOption<Section>[] = [
    { label: copy.sectionSegments.all, value: "all" },
    { label: copy.sectionSegments.ebrw, value: "ebrw" },
    { label: copy.sectionSegments.math, value: "math" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl label={copy.sectionSegments.all} onValueChange={setSection} options={options} value={section} />
      <ChartFigure summary={summary}>
        <ChartContainer className="aspect-video max-h-[380px] w-full" config={{}}>
          <ComposedChart data={rows} margin={{ bottom: 8, left: 0, right: 16, top: 8 }}>
            <XAxis dataKey="band" tickFormatter={(value: number) => `Band ${value}`} />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(value: number) => `${value}%`}
              yAxisId="accuracy"
            />
            <YAxis
              domain={[0, 140]}
              hide
              orientation="right"
              tickFormatter={(value: number) => `${value}s`}
              yAxisId="pace"
            />
            <Bar
              dataKey="accuracy"
              fill="var(--ink)"
              fillOpacity={0.85}
              isAnimationActive={false}
              radius={[3, 3, 0, 0]}
              yAxisId="accuracy"
            />
            <Line
              connectNulls={false}
              dataKey="pace"
              dot
              isAnimationActive={false}
              stroke="var(--brand-scale-3)"
              strokeWidth={2}
              type="monotone"
              yAxisId="pace"
            />
          </ComposedChart>
        </ChartContainer>
      </ChartFigure>
      <div className="grid grid-cols-7 gap-2 text-center text-xs text-[var(--ink-secondary)]">
        {rows.map((row) => (
          <div key={row.band}>
            {row.attempted > 0 ? (
              <span className="tabular-nums">{row.pace}s</span>
            ) : (
              <span>{copy.emptyBand}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
