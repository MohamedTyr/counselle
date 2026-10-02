import type React from "react";

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
