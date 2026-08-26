import { AlertTriangle } from "lucide-react";

import type { Caveat } from "@/features/schools/facts/school-facts-types";

/*
 * A caveat is never a tooltip.
 *
 * Where a number requires a qualifier, the qualifier renders as visible text
 * under the number, at every viewport, always. Under test-optional review a
 * school's published SAT middle 50% describes only the students who chose to
 * submit — at 38% submitted, that band is the profile of the top third of
 * the class. Printing 1500–1560 without "38% submitted" is manufacturing a
 * fact, and putting the correction behind a hover is the same thing with an
 * alibi.
 *
 * This renders INSIDE the <dd>, so a screen reader reading the value also
 * reads the qualifier. That placement is the whole reason it is not a
 * tooltip.
 */

export function CaveatLine({ caveat }: { caveat: Caveat }) {
  if (caveat.severity === "severe") {
    return (
      <p
        className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[var(--school-fact-caveat-severe-bg)] px-2 py-1 text-xs leading-5 font-medium text-[var(--school-fact-caveat-severe-fg)]"
        title={caveat.text}
      >
        {/*
         * Triple-redundant by design: weight, glyph, and title. Status is
         * never colour alone (DESIGN §7), and this one has to survive
         * greyscale, a screen reader, and a printout.
         */}
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
        <span>{caveat.text}</span>
      </p>
    );
  }

  return (
    <p className="mt-1 text-xs leading-5 text-[var(--school-fact-caveat)]">
      {caveat.text}
    </p>
  );
}

export function CaveatList({ caveats }: { caveats: readonly Caveat[] }) {
  if (caveats.length === 0) return null;
  return (
    <>
      {caveats.map((caveat) => (
        <CaveatLine caveat={caveat} key={caveat.id} />
      ))}
    </>
  );
}

/**
 * A caveat that qualifies a whole group rather than one row — "this is what
 * the school says it weighs, not a measurement". Sits above the first row on
 * an inset well with no border: a recessed fill that also has a rim reads as
 * embossed.
 */
export function GroupCaveat({ text }: { text: string }) {
  return (
    <p className="rounded-md bg-[var(--school-fact-well)] p-3 text-xs leading-5 text-[var(--school-fact-caveat)]">
      {text}
    </p>
  );
}
