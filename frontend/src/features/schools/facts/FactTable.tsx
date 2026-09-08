import type React from "react";

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { FactRow } from "@/features/schools/facts/school-facts-rows";
import { cn } from "@/lib/utils";

/*
 * Two columns: what it is, and what it says. Nothing else.
 *
 * Built on the house `table.tsx` at variant="default" — the hairline
 * between rows and the row hover come from the design system, and the
 * FRAME comes from the section panel one level up (`SchoolFactsSection`).
 *
 * The honesty rule this table holds: an absent value renders as the
 * SENTENCE naming which kind of nothing it is — one of five distinct wire
 * words (plan §5.1) — in the absent ink and italic, never a blank cell, an
 * em dash, a `0`, or a dropped row. A reported `0` or `false` is a fact and
 * renders in the value ink at full weight, because `state === "value"` is
 * the only thing that decides ink and slant — never the string's own
 * content, so a legitimately printed "0" can never be mistaken for the
 * absence grammar.
 */

export function FactTable({
  emphasis = false,
  rows,
}: {
  /** The headline reads at one density step up — taller rows, medium
   * weight. Hierarchy comes from DENSITY, never a big number. */
  emphasis?: boolean;
  rows: readonly FactRow[];
}): React.ReactElement {
  return (
    <Table>
      <TableBody>
        {rows.map((row) => (
          <FactTableRow emphasis={emphasis} key={row.key} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function FactTableRow({
  emphasis,
  row,
}: {
  emphasis: boolean;
  row: FactRow;
}): React.ReactElement {
  const density = emphasis
    ? "py-4 text-[0.9375rem] leading-6"
    : "py-3.5 text-sm leading-6";
  const isValue = row.state === "value";

  return (
    <TableRow>
      <TableCell
        /* Labels wrap, never truncate — a clipped metric label is an
         * unreadable one. Flush left: the panel's own padding is the text
         * column, so a row starts exactly where the group title does. */
        className={cn(
          "ps-0 align-baseline whitespace-normal text-[var(--school-fact-label)]",
          density,
        )}
      >
        {row.label}
      </TableCell>
      <TableCell
        className={cn(
          /* pe-1, not pe-0: the absence sentences are italic and an italic
           * glyph overhangs its box — at a flush edge the container's
           * overflow clipped the last letter. */
          "pe-1 pl-4 text-right align-baseline whitespace-normal sm:pl-6",
          density,
          /* A CEILING, not a width — the occasional prose value must not
           * swallow the row, but the column sizes to its content and stops
           * rather than reserving space for the longest possible string. */
          "sm:max-w-[38ch]",
          isValue
            ? cn(
                "tabular-nums text-[var(--school-fact-value)]",
                /* Weight is spent on the headline so it still MEANS
                 * something there. */
                emphasis ? "font-medium" : "font-normal",
              )
            : "italic text-[var(--school-fact-absent)]",
        )}
      >
        {row.href ? (
          <a
            className="underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none"
            href={row.href}
            rel="noreferrer"
            target="_blank"
          >
            {row.display}
          </a>
        ) : (
          row.display
        )}
        {isValue && row.reportedPeriod ? (
          <span className="ms-1.5 text-xs font-normal text-[var(--ink-muted)] not-italic">
            {row.reportedPeriod}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
