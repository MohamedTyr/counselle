import type React from "react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  AxisCategoryTick,
  ChartFigure,
} from "@/features/schools/facts/charts/chart-shell";
import {
  chartRowHeight,
  VALUE_LABEL,
  useAxisWidth,
  useChartEntrance,
} from "@/features/schools/facts/charts/chart-tokens";
import type { BarsBlock } from "@/features/schools/facts/school-facts-blocks";

/*
 * Horizontal bars — degree shares, aid coverage, campus composition, class
 * sizes, the applicant funnel, the completion gap.
 *
 * shadcn `chart-bar-horizontal`, stripped to the geometry: no grid, no axis
 * line, no legend, no tooltip. There is one series, so a legend names nothing;
 * every value is printed at the end of its own bar, so a tooltip hides a fact
 * behind a hover that does not exist on a phone or in print.
 *
 * `max` is the honest ceiling and it is decided in the block builder, never
 * here: 100 for a share, the largest bar for counts. Scaling counts to a SUM
 * would let one unreported bin quietly shrink every other bar, which is the
 * "a blank reads as zero" failure written in geometry.
 */

const CONFIG = {
  value: { label: "Value", color: "var(--school-chart-mark)" },
} satisfies ChartConfig;

export function FactBarChart({
  block,
}: {
  block: BarsBlock;
}): React.ReactElement | null {
  const entrance = useChartEntrance();
  const axisWidth = useAxisWidth();

  if (block.points.length === 0) return null;

  const summary = block.points
    .map((point) => `${point.label}: ${point.display}`)
    .join(". ");

  /*
   * Room for the printed value at the end of the LONGEST bar.
   *
   * The bar that equals the domain ends flush with the plot area, so its
   * label has nowhere to go and Recharts happily draws it past the edge of
   * the SVG, where it clips. A half-visible "68" that is really 689 is a
   * wrong number, so the space is reserved rather than the domain inflated —
   * padding the scale to make room would misstate every other bar.
   */
  const longest = block.points.reduce(
    (width, point) => Math.max(width, point.display.length),
    0,
  );

  return (
    <ChartFigure summary={`${block.title ?? "Chart"}. ${summary}.`}>
      <ChartContainer
        className="w-full"
        config={CONFIG}
        style={{
          height:
            block.points.length *
              chartRowHeight(
                block.points.map((point) => point.label),
                axisWidth,
              ) +
            8,
          /* Recharts sizes to its parent; without an explicit aspect
           * override the shadcn default squashes a 3-bar chart. */
          aspectRatio: "auto",
        }}
      >
        <BarChart
          accessibilityLayer
          barSize={10}
          data={block.points}
          layout="vertical"
          margin={{
            bottom: 4,
            left: 0,
            right: longest * 8 + 14,
            top: 4,
          }}
        >
          <YAxis
            axisLine={false}
            dataKey="label"
            tick={<AxisCategoryTick />}
            tickLine={false}
            type="category"
            width={axisWidth}
          />
          {/* The domain is the whole point of this component; the axis
           * itself is chrome and stays hidden. */}
          <XAxis dataKey="value" domain={[0, block.max]} hide type="number" />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            {...entrance}
            /*
             * THE ZERO RULE.
             *
             * Recharts draws nothing for a value of 0 — no rectangle, and
             * therefore no label either. That is the page's worst failure
             * mode wearing a chart: a school that genuinely graduates 0% in
             * a field would simply lose the row, and a reader would take
             * "absent" for "not asked" instead of "none".
             *
             * A reported 0 IS a fact, so it gets a 2px tick and keeps its
             * printed "0%". Two pixels cannot be misread as a quantity, and
             * it is the difference between "none" and "we don't know" —
             * which is the whole distinction this tab exists to hold.
             */
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
  );
}
