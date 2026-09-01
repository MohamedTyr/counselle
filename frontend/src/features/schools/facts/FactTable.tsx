import { AlertTriangle } from "lucide-react";
import type React from "react";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type {
  FactTableRow,
  RowProvenance,
} from "@/features/schools/facts/school-facts-rows";
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
 *
 * Two things about a value are as load-bearing as the value: where it came
 * from, and the qualifier that makes it true. They divide by whether the
 * reader can afford to miss them.
 *
 *   Provenance is ON DEMAND. It answers "says who?", which most readers
 *   never ask and every reader is entitled to. It sits behind a popover.
 *
 *   A SEVERE caveat is NOT. It is, by its own definition, the sentence
 *   without which the number cannot be read correctly. It renders on the
 *   row, always, with a badge word beside it — never behind a click, and
 *   never behind the overflow fold.
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
          <FactRow emphasis={emphasis} key={row.key} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function FactRow({
  emphasis,
  row,
}: {
  emphasis: boolean;
  row: FactTableRow;
}): React.ReactElement {
  const severe = row.caveats.filter((caveat) => caveat.severity === "severe");
  const density = emphasis
    ? "py-4 text-[0.9375rem] leading-6"
    : "py-3.5 text-sm leading-6";

  return (
    <>
      <TableRow
        /* The caveat line below belongs to this row, so the hairline that
         * would separate them is suppressed — one fact, one band. */
        className={cn(severe.length > 0 && "border-b-0")}
      >
        <TableCell
          /* Labels wrap, never truncate — "average percent of need met,
           * first-time first-year" is typical, and a clipped metric label
           * is an unreadable one. Baseline alignment keeps the first line
           * level with the value beside it. */
          className={cn(
            /* Flush left: the panel's own padding is the text column, so
             * a row starts exactly where the group title above it does. */
            "ps-0 align-baseline whitespace-normal text-[var(--school-fact-label)]",
            density,
          )}
        >
          {row.label}
        </TableCell>
        <TableCell
          className={cn(
            /* pe-1, not pe-0: the absence sentences are italic, and an
             * italic glyph overhangs its box by a couple of pixels. At a
             * flush right edge the table container's overflow clipped the
             * last letter — "not reported" rendered as "not reportea",
             * which is a value that says something we did not. */
            "pe-1 pl-4 text-right align-baseline whitespace-normal sm:pl-6",
            density,
            /* A CEILING, not a width. The occasional prose value — "Yes,
             * engineering weighs portfolio more heavily" — must not
             * swallow the row and leave the label column a stub; but this
             * used to be `w-[38ch]` too, which reserved 38ch even for a
             * value of "20" and starved the label of the space it was
             * protecting. The column sizes to its content and stops. */
            "sm:max-w-[38ch]",
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
          {row.provenance.length > 0 ? (
            <EvidenceDisclosure row={row} />
          ) : (
            row.value
          )}
        </TableCell>
      </TableRow>
      {severe.length > 0 ? (
        <TableRow>
          <TableCell
            /* whitespace-normal is load-bearing: TableCell defaults to
             * nowrap, and a caveat sentence that refuses to wrap sets the
             * table's min-width to the length of the sentence — which at
             * 375px pushed every VALUE off the right edge of the screen. */
            className="px-0 pt-0 pb-3.5 align-top whitespace-normal"
            colSpan={2}
          >
            {severe.map((caveat) => (
              <p
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5 text-[var(--school-fact-caveat)]"
                key={caveat.id}
              >
                {/* Three redundant channels, so the warning survives
                 * greyscale, a screen reader, and a colour-blind reader:
                 * the word, the icon, and the surface. Never colour alone,
                 * and never the badge INSTEAD of the sentence. */}
                <Badge className="gap-1" size="sm" variant="warning">
                  <AlertTriangle aria-hidden="true" className="size-3" />
                  Read with
                </Badge>
                <span className="max-w-[68ch]">{caveat.text}</span>
              </p>
            ))}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * The value, as a button onto the page of the form it was read from.
 *
 * A `Popover` and deliberately not a `HoverCard`: a hover card does not
 * exist on a phone, and this tab already refuses hover-only disclosure for
 * chart caveats one file over. This is a real button — focusable, activated
 * by Enter or Space or a tap, dismissed by Escape.
 *
 * The trigger keeps the exact ink, slant and weight the value would have had
 * without it. A dotted underline is the whole affordance: styling an absence
 * to look interactive is one thing, styling it to look like a VALUE is a
 * different claim entirely.
 */
function EvidenceDisclosure({ row }: { row: FactTableRow }) {
  const proofs = row.provenance;
  const isAbsence = !row.reported;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${row.value} — ${row.label}. Show where this came from.`}
        className="cursor-pointer rounded-[4px] underline decoration-dotted decoration-[var(--school-fact-evidence-ink)] underline-offset-4 transition-colors duration-150 hover:decoration-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none"
      >
        {row.value}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        /* max-w-full, not a hard width: the positioner caps itself at the
         * available width, and a 28rem popup on a 375px screen would hang
         * off the edge with the excerpt unreadable. */
        className="w-[28rem] max-w-full text-left"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-5 text-[var(--ink-secondary)]">
            {isAbsence
              ? "Why there is no value here, in the school's own form:"
              : "Read from the school's own Common Data Set:"}
          </p>
          {proofs.map((proof) => (
            <EvidenceRow
              key={`${proof.label}:${proof.evidence.pageNumber}`}
              proof={proof}
              /* Only worth naming when one line covers several metrics —
               * otherwise the label is already the row beside it. */
              showLabel={proofs.length > 1}
            />
          ))}
          {row.caveats.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-[var(--school-fact-divider)] pt-3">
              {row.caveats.map((caveat) => (
                <p
                  className="text-xs leading-5 text-[var(--school-fact-caveat)]"
                  key={caveat.id}
                >
                  {caveat.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EvidenceRow({
  proof,
  showLabel,
}: {
  proof: RowProvenance;
  showLabel: boolean;
}): React.ReactElement {
  const { evidence } = proof;
  /* Section, row and column are how a reader finds the line themselves —
   * "C1, row 3" beats a page number alone on a 60-page PDF. Any of them may
   * be absent, and an absent one is simply not printed: this is a locator,
   * not a metric, so the absence grammar does not apply. */
  const locator = [evidence.section, evidence.row, evidence.column]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel ? (
        <p className="text-xs font-medium text-[var(--ink)]">{proof.label}</p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--school-fact-evidence-ink)]">
        {/* "proof" rather than a bare page number when the excerpt shows a
         * row is ABSENT from this edition — the two are different claims and
         * must not read the same. */}
        <span className="font-medium">
          {evidence.isAbsenceProof
            ? `Proof of absence, page ${evidence.pageNumber}`
            : `Page ${evidence.pageNumber}`}
        </span>
        {locator ? <span>{locator}</span> : null}
      </p>
      {/* A well, never a bordered card: an inset surface that also has a rim
       * reads as embossed. */}
      <blockquote className="rounded-lg bg-[var(--school-fact-well)] px-3 py-2 text-xs leading-5 text-[var(--ink-secondary)]">
        {evidence.excerpt}
      </blockquote>
    </div>
  );
}
