import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { FactTableRow } from "@/features/schools/facts/school-facts-rows";
import { cn } from "@/lib/utils";

/*
 * Two columns: what it is, and what it says. Nothing else.
 *
 * Built on the house `table.tsx` at variant="default" — the hairline between
 * rows and the row hover come from the design system, and the FRAME comes
 * from the section panel one level up. It used to be variant="card", which
 * gave every group in a section its own border and shadow: six boxes on a
 * section that was itself no surface at all. A group is a band in a list,
 * not a card, and a card inside the panel would be a card inside a card.
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
    <Table>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell
              /* Labels wrap, never truncate — "average percent of need met,
               * first-time first-year" is typical, and a clipped metric label
               * is an unreadable one. Baseline alignment keeps the first line
               * level with the value beside it. */
              className={cn(
                /* Flush left: the panel's own padding is the text column, so
                 * a row starts exactly where the group title above it does. */
                "ps-0 align-baseline whitespace-normal text-[var(--school-fact-label)]",
                emphasis
                  ? "py-4 text-[0.9375rem] leading-6"
                  : "py-3.5 text-sm leading-6",
              )}
            >
              {row.label}
            </TableCell>
            <TableCell
              className={cn(
                "pe-0 pl-4 text-right align-baseline whitespace-normal sm:pl-6",
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
