import type React from "react";

import { cn } from "@/lib/utils";
import type { OrdinalBlock } from "@/features/schools/facts/school-facts-blocks";

/*
 * How they weigh your file — the one visual on this tab that is NOT a shadcn
 * chart, because no chart represents what this data is.
 *
 * "Very important / Important / Considered / Not considered" are four ORDERED
 * CATEGORIES, not magnitudes. A bar chart would silently assert that "very
 * important" is twice "important", and that "not considered" is zero of
 * something — a numeric scale the CDS never defines and the school never
 * claimed. Discrete steps say the only true thing: this one is ranked above
 * that one.
 *
 * Sorted heaviest first in the block builder, so the top of the block IS the
 * answer to "what do they actually care about" — which is the whole reason
 * twelve identical text rows were worth replacing.
 */

export function FactOrdinal({
  block,
}: {
  block: OrdinalBlock;
}): React.ReactElement | null {
  if (block.items.length === 0) return null;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">
        {`${block.title}. ${block.items
          .map((item) => `${item.label}: ${item.display}`)
          .join(". ")}.`}
      </figcaption>
      <ul className="flex flex-col gap-1.5">
        {block.items.map((item) => (
          <li
            /* The label takes the slack and the level word is a fixed right
             * column, so the steps land in one vertical line down the list
             * and the row spans the same measure as the tables around it. A
             * strip huddled at the left of a wide column reads as a fragment
             * of a chart rather than as a chart. */
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto_8.5rem] sm:gap-x-5"
            key={item.key}
          >
            <span className="text-sm leading-6 text-[var(--school-fact-label)]">
              {item.label}
            </span>
            <span
              aria-hidden="true"
              className="order-3 flex gap-1 sm:order-none"
            >
              {block.levels.map((level, position) => (
                <span
                  className={cn(
                    "h-2 w-7 rounded-full",
                    position <= item.level
                      ? "bg-[var(--school-chart-mark)]"
                      : "bg-[var(--school-chart-track)]",
                  )}
                  key={level}
                />
              ))}
            </span>
            {/* The words, always. The steps rank it; only this says what the
             * school actually wrote. */}
            <span className="text-sm leading-6 font-medium text-[var(--school-fact-value)] sm:text-right">
              {item.display}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
