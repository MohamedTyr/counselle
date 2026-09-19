import type React from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { ChartFigure } from "@/components/workspace/chart-figure";
import {
  CHART_ROW_HEIGHT,
  useChartEntrance,
} from "@/features/schools/facts/charts/chart-tokens";
import type {
  BandValue,
  Fact,
} from "@/features/schools/facts/school-facts-types";

/*
 * The middle-50 range band — "where do I sit" — one track per test.
 *
 * A band is a FACT, not a group chart (plan §5.2/§6b): the wire already
 * merges each test's `_p25`/`_p75` pair server-side, so this component
 * takes one band fact at a time and `BandsBlock` (`SchoolFactsSection`)
 * calls it once per band fact in a group.
 *
 * Built on the shadcn horizontal bar: Recharts `Bar` accepts an ARRAY
 * `dataKey` (`[p25, p75]`) and renders it as a floating bar, so the band is
 * native geometry rather than a stacked bar with an invisible offset
 * segment. Each test keeps its OWN scale (SAT sections run 200-800, ACT
 * runs 1-36) — the domain comes from the fact's own `min`/`max`, never a
 * shared axis. The full domain is always drawn as the track behind the
 * band, so a band floating on a bare axis does not read as the whole range.
 *
 * There is no median row: CollegeData publishes no p50, and this page never
 * synthesises one (plan §6b, R14).
 */

const CONFIG = {
  band: { label: "Middle 50%", color: "var(--school-chart-mark)" },
  track: { label: "Full scale", color: "var(--school-chart-track)" },
} satisfies ChartConfig;

function isBandValue(value: unknown): value is BandValue {
  return typeof value === "object" && value !== null && "p25" in value;
}

export function FactRangeChart({ fact }: { fact: Fact }): React.ReactElement | null {
  /* Called unconditionally — Rules of Hooks — even though most callers
   * (an absent band) bail out just below. */
  const entrance = useChartEntrance();
  if (fact.state !== "value" || !isBandValue(fact.value)) return null;
  const { p25, p75, min, max } = fact.value;
  if (p25 === null || p75 === null || min === null || max === null) return null;
  /* The accessible rendering of the figure alone — the geometry, and no
   * claim about what the band MEANS. That claim is the group's wire
   * `BAND_CAPTION` foot, adjacent in the reading order. */
  const summary = `${fact.label}: ${p25} to ${p75}, on a ${min} to ${max} scale.`;
  const data = [
    {
      label: fact.label,
      band: [p25, p75] as [number, number],
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm leading-6 text-[var(--school-fact-label)]">
          {fact.label}
        </span>
        <span className="text-sm leading-6 font-medium tabular-nums text-[var(--school-fact-value)]">
          {p25}&ndash;{p75}
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
            <YAxis dataKey="label" hide type="category" width={0} />
            <XAxis domain={[min, max]} hide type="number" />
            <Bar
              background={{ fill: "var(--color-track)", radius: 5 }}
              dataKey="band"
              fill="var(--color-band)"
              {...entrance}
              radius={5}
            />
          </BarChart>
        </ChartContainer>
      </ChartFigure>
      <div className="flex justify-between text-[11px] leading-4 tabular-nums text-[var(--school-fact-caveat)]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
