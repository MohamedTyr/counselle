import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { FactTableRow } from "@/features/schools/facts/school-facts-rows";
import { cn } from "@/lib/utils";

/*
 * Two columns: what it is, and what it says. Nothing else.
 *
 * Built on the house `table.tsx` at variant="card", so the frame, the hairline
 * between rows, the corner radii and the row hover all come from the design
 * system rather than from a second table invented here.
 *
 * The honesty rule the table has to hold: an absent value renders as the
 * SENTENCE naming which kind of nothing it is, in the absent ink and italic —
 * never a blank cell, an em dash, a `0`, or a dropped row. Weight is the
 * signal that separates a claim from an admission, so it survives greyscale.
 */

export function FactTable({
  emphasis = false,
  rows,
}: {
  /**
   * The headline reads at one density step up — taller rows, 15px value,
   * medium weight. Hierarchy comes from DENSITY, never from a big number:
   * a single oversized figure is the hero-metric template, which is a look
   * rather than a claim about what matters.
   */
  emphasis?: boolean;
  rows: readonly FactTableRow[];
}) {
  return (
    <Table variant="card">
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell
              /* Labels wrap, never truncate — "average percent of need met,
               * first-time first-year" is typical, and a clipped metric label
               * is an unreadable one. Baseline alignment keeps the first line
               * level with the value beside it. */
              className={cn(
                "align-baseline whitespace-normal text-[var(--school-fact-label)]",
                emphasis
                  ? "py-4 text-[0.9375rem] leading-6"
                  : "py-3.5 text-sm leading-6",
              )}
            >
              {row.label}
            </TableCell>
            <TableCell
              className={cn(
                "pl-4 text-right align-baseline whitespace-normal sm:pl-6",
                emphasis
                  ? "py-4 text-[0.9375rem] leading-6"
                  : "py-3.5 text-sm leading-6",
                /* Capped from sm: up so the occasional prose value — "Yes,
                 * engineering weighs portfolio more heavily" — cannot swallow
                 * the row and leave the label column a stub. Below that the
                 * column has no width to give away, so it sizes to content. */
                "sm:w-[38ch] sm:max-w-[38ch]",
                row.reported
                  ? cn(
                      "tabular-nums text-[var(--school-fact-value)]",
                      /* Weight is spent on the headline so it still MEANS
                       * something there. Making every value on the page
                       * medium leaves nothing left to mark the ones that
                       * matter. */
                      emphasis ? "font-medium" : "font-normal",
                    )
                  : "italic text-[var(--school-fact-absent)]",
              )}
            >
              {row.value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
