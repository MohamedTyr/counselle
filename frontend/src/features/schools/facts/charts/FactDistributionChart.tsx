import type React from "react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { ChartFigure } from "@/components/workspace/chart-figure";
import { AxisCategoryTick } from "@/features/schools/facts/charts/chart-shell";
import {
  chartRowHeight,
  VALUE_LABEL,
  useAxisWidth,
  useChartEntrance,
} from "@/features/schools/facts/charts/chart-tokens";
import type {
  DistributionValue,
  Fact,
} from "@/features/schools/facts/school-facts-types";
import { compressAbsences } from "@/features/schools/facts/school-facts-rows";
import { FactTable } from "@/features/schools/facts/FactTable";

/*
 * A `distribution` fact — a `BarGraph`, as published (SAT score bands, class
 * rank deciles). One horizontal bar per bucket: no grid, no axis line, no
 * legend (one series names nothing), no tooltip (a tooltip hides a fact
 * behind a hover that does not exist on a phone or in print).
 *
 * THE ZERO RULE. A bucket the school marked `absence: "not_reported"`, or a
 * bucket schema entry the school's own graph omitted entirely
 * (`omitted_buckets`), never becomes a bar of width zero — that would read
 * as "0% of the class", a different and false claim from "we don't know".
 * Both cases are written out as rows underneath instead, in the same five-
 * state grammar as everywhere else on the page (plan §5.1/§7).
 */

const CONFIG = {
  value: { label: "Value", color: "var(--school-chart-mark)" },
} satisfies ChartConfig;

function isDistributionValue(value: unknown): value is DistributionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as DistributionValue).buckets)
  );
}

export function FactDistributionChart({
  fact,
}: {
  fact: Fact;
}): React.ReactElement | null {
  const entrance = useChartEntrance();
  const axisWidth = useAxisWidth();

  if (fact.state !== "value" || !isDistributionValue(fact.value)) return null;
  const { buckets, omitted_buckets: omitted } = fact.value;

  const points = buckets
    .filter((bucket) => bucket.pct !== undefined && bucket.absence === undefined)
    .map((bucket) => ({
      key: bucket.label,
      label: bucket.label,
      display: `${bucket.pct}%`,
      value: bucket.pct as number,
    }));

  const unreportedBuckets = [
    ...buckets
      .filter((bucket) => bucket.absence === "not_reported")
      .map((bucket) => ({ label: bucket.label, display: bucket.absence_display ?? "" })),
    ...omitted.map((bucket) => ({ label: bucket.label, display: bucket.display })),
  ];
  const unreportedRows = compressAbsences(
    unreportedBuckets.map(({ label, display }) => ({
      key: `${fact.key}:${label}`,
      label,
      display,
      state: "not_reported" as const,
      reportedPeriod: null,
      href: null,
    })),
  );

  if (points.length === 0) {
    return unreportedRows.length > 0 ? <FactTable rows={unreportedRows} /> : null;
  }

  const summary = `${fact.label}. ${points
    .map((point) => `${point.label}: ${point.display}`)
    .join(". ")}.`;
  const longest = points.reduce(
    (width, point) => Math.max(width, point.display.length),
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      <ChartFigure summary={summary}>
        <ChartContainer
          className="w-full"
          config={CONFIG}
          style={{
            height:
              points.length *
                chartRowHeight(
                  points.map((point) => point.label),
                  axisWidth,
                ) +
              8,
            aspectRatio: "auto",
          }}
        >
          <BarChart
            accessibilityLayer
            barSize={10}
            data={points}
            layout="vertical"
            margin={{ bottom: 4, left: 0, right: longest * 8 + 14, top: 4 }}
          >
            <YAxis
              axisLine={false}
              dataKey="label"
              tick={<AxisCategoryTick />}
              tickLine={false}
              type="category"
              width={axisWidth}
            />
            <XAxis dataKey="value" domain={[0, 100]} hide type="number" />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              {...entrance}
              /* A reported 0 IS a fact, so it keeps a 2px tick and its
               * printed "0%" — never nothing, which would read as "not
               * asked" rather than "none". */
              minPointSize={2}
              radius={[3, 3, 3, 3]}
            >
              <LabelList
                dataKey="display"
                offset={10}
                position="right"
                {...VALUE_LABEL}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </ChartFigure>
      {unreportedRows.length > 0 ? <FactTable rows={unreportedRows} /> : null}
    </div>
  );
}
