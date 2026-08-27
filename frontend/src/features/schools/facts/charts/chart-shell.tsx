import type React from "react";
import { Text } from "recharts";

import {
  AXIS_TICK,
  TICK_GAP,
} from "@/features/schools/facts/charts/chart-tokens";

/*
 * The frame every visual on this tab shares.
 *
 * A chart here is NOT a card. It sits at the same left edge, in the same
 * surface, under the same group heading as a table would — because it is the
 * same kind of content, drawn differently. Boxing it would make the page read
 * as a dashboard of widgets rather than one document about one school.
 *
 * That was aspirational until the section panel landed: the tables around a
 * chart were cards, so the chart had to be nudged right by a now-deleted
 * --school-chart-inset to fake a shared edge. Now the panel's padding IS the
 * edge, and nothing here needs to compensate for anything.
 *
 * Measurements and motion live in `chart-tokens.ts`.
 */

/**
 * The one line of prose this tab still carries: a qualifier the chart above
 * cannot be read correctly without. Never a tooltip — a caveat behind a hover
 * is a caveat that does not exist on a phone or in print.
 */
export function ChartFoot({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <p className="max-w-[68ch] text-xs leading-5 text-[var(--school-fact-caveat)]">
      {children}
    </p>
  );
}

/**
 * The category tick every bar chart on this tab draws.
 *
 * Recharts anchors a left y-axis tick at `end`, so the labels ragged-right
 * against the bars. That is a fine default for a chart standing alone and the
 * wrong one here: the ordinal strip, the range bands and every table row on
 * the tab are left-aligned, so a bar chart was the one block whose labels
 * started somewhere else, and the section read as a chart pasted into a
 * document rather than a page of one.
 *
 * `Text` rather than a bare `<text>`: it keeps the wrapping the default tick
 * does, which is load-bearing at 375px where the gutter is 116px and metric
 * labels are long by nature.
 */
export function AxisCategoryTick(props: {
  x?: number;
  y?: number;
  width?: number;
  payload?: { value?: string | number };
}): React.ReactElement {
  const gutter = props.width ?? 0;
  return (
    <Text
      {...AXIS_TICK}
      /* The axis box already starts at the container's left edge, which is
       * the panel's text column — so the label starts exactly where a table
       * label above it does. */
      lineHeight="1.3em"
      textAnchor="start"
      verticalAnchor="middle"
      width={Math.max(gutter - TICK_GAP, 0)}
      x={0}
      y={props.y}
    >
      {props.payload?.value}
    </Text>
  );
}

/**
 * Wraps a chart with the text equivalent screen readers actually use.
 *
 * The marks are `aria-hidden`: an SVG of bars is noise to a screen reader,
 * and every value is already in `summary` as a sentence. This is the same
 * honesty rule as the printed value — the shape is never the only channel.
 */
export function ChartFigure({
  children,
  summary,
}: {
  children: React.ReactNode;
  summary: string;
}): React.ReactElement {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden="true">{children}</div>
    </figure>
  );
}
