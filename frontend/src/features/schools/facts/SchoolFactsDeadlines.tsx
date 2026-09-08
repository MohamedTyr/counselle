import type React from "react";

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ChartFoot } from "@/features/schools/facts/charts/chart-shell";
import type { DeadlinesBlock } from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * The deadlines group — the first thing the Applying section shows.
 *
 * Every word here is wire-delivered: `display` is already "Rolling", a
 * formatted date, "Not offered", or the state's absence word, and `foot` is
 * already the "Dates last confirmed {Month YYYY} for the {cycle} cycle."
 * sentence (or its date-less/cycle-less forms) — this component authors no
 * text of its own, only the layout DESIGN.md gives every other fact table on
 * this tab.
 *
 * No badge, no colour on a deadline date: a catalog date is not a status
 * about THIS student.
 */
export function SchoolFactsDeadlines({
  deadlines,
}: {
  deadlines: DeadlinesBlock;
}): React.ReactElement | null {
  if (deadlines.rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableBody>
          {deadlines.rows.map((row) => {
            const isValue = row.state === "value";
            return (
              <TableRow key={row.round}>
                <TableCell className="ps-0 py-3.5 align-baseline text-sm leading-6 whitespace-normal text-[var(--school-fact-label)]">
                  {row.round}
                </TableCell>
                <TableCell
                  className={cn(
                    "pe-1 pl-4 py-3.5 text-right align-baseline text-sm leading-6 whitespace-normal sm:pl-6",
                    isValue
                      ? "font-normal tabular-nums text-[var(--school-fact-value)]"
                      : "italic text-[var(--school-fact-absent)]",
                  )}
                >
                  {row.display}
                  {isValue && row.reported_period ? (
                    <span className="ms-1.5 text-xs font-normal text-[var(--ink-muted)] not-italic">
                      {row.reported_period}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ChartFoot>{deadlines.foot}</ChartFoot>
    </div>
  );
}
