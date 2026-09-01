import type React from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { ChartFigure } from "@/features/schools/facts/charts/chart-shell";
import {
  CHART_ROW_HEIGHT,
  useChartEntrance,
} from "@/features/schools/facts/charts/chart-tokens";
import type { BandsBlock } from "@/features/schools/facts/school-facts-blocks";

/*
 * The middle-50 range band — "where do I sit" — one track per test.
 *
 * Built on the same shadcn horizontal bar as everything else: Recharts `Bar`
 * accepts an ARRAY `dataKey` (`[p25, p75]`) and renders it as a floating bar,
 * so the band is native geometry rather than a stacked bar with an invisible
 * offset segment.
 *
 * Two rules this component exists to hold:
 *
 *   Each test keeps ITS OWN scale. An SAT section runs 200–800 and the ACT
 *   runs 1–36; putting them on one axis would make a 34 look like a failing
 *   score. The domain comes from the band, never from the data.
 *
 *   The full domain is always drawn as the track behind the band. A band
 *   floating on a bare axis reads as the whole range; against 200–800 it
 *   reads as the slice of it that it actually is.
 */

const CONFIG = {
  band: { label: "Middle 50%", color: "var(--school-chart-mark)" },
  track: { label: "Full scale", color: "var(--school-chart-track)" },
} satisfies ChartConfig;

export function FactRangeChart({
  block,
}: {
  block: BandsBlock;
}): React.ReactElement | null {
  if (block.bands.length === 0) return null;

  /*
   * One chart per band rather than one chart with N rows: the scales differ,
   * and a shared Recharts axis would silently force them together.
   */
  return (
    <div className="flex flex-col gap-5">
      {block.bands.map((band) => (
        <RangeRow band={band} key={band.key} />
      ))}
    </div>
  );
}

function RangeRow({
  band,
}: {
  band: BandsBlock["bands"][number];
}): React.ReactElement {
  const entrance = useChartEntrance();
  const summary = `${band.label}: middle 50% of submitted scores runs ${band.p25} to ${band.p75}, median ${band.p50}, on a ${band.min} to ${band.max} scale.`;
  const data = [
    {
      label: band.label,
      /* Recharts reads a two-element array as [start, end] — the band. */
      band: [band.p25, band.p75] as [number, number],
      display: `${band.p25}–${band.p75}`,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {/*
       * The range reads as a heading rather than as a label on the bar.
       * A high-scoring band sits hard against the right end of its scale,
       * which is exactly where a `position="right"` label has no room and
       * clips — and a clipped number on this page is a wrong number.
       */}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm leading-6 text-[var(--school-fact-label)]">
          {band.label}
        </span>
        <span className="text-sm leading-6 font-medium tabular-nums text-[var(--school-fact-value)]">
          {band.p25}–{band.p75}
        </span>
      </div>
      <ChartFigure summary={summary}>
        <ChartContainer
          className="w-full"
          config={CONFIG}
          style={{ height: CHART_ROW_HEIGHT - 10, aspectRatio: "auto" }}
        >
          <BarChart
            accessibilityLayer
            barSize={10}
            data={data}
            layout="vertical"
            margin={{ bottom: 0, left: 0, right: 0, top: 0 }}
          >
            {/* No category axis: one row, and its name is the heading
             * above. The track spans the full measure instead. */}
            <YAxis dataKey="label" hide type="category" width={0} />
            <XAxis domain={[band.min, band.max]} hide type="number" />
            <Bar
              /* `background` is Recharts' own full-domain track — the whole
               * 200–800, drawn behind the band so the band reads as the
               * slice of the scale it actually is. */
              background={{ fill: "var(--color-track)", radius: 5 }}
              dataKey="band"
              fill="var(--color-band)"
              {...entrance}
              radius={5}
            />
          </BarChart>
        </ChartContainer>
      </ChartFigure>
      {/* The endpoints, so the band is read against its real scale rather
       * than against the width of the container. */}
      <div className="flex justify-between text-[11px] leading-4 tabular-nums text-[var(--school-fact-caveat)]">
        <span>{band.min}</span>
        <span>median {band.p50}</span>
        <span>{band.max}</span>
      </div>
    </div>
  );
}
