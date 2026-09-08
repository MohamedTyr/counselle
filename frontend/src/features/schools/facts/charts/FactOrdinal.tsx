import type React from "react";

import type {
  Fact,
  OrdinalValue,
} from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * How they weigh your file — the one visual on this tab that is not a
 * shadcn chart, because no chart represents what this data is.
 *
 * "Very important / Important / Considered / Not considered" are ORDERED
 * CATEGORIES, not magnitudes — a bar chart would assert that "very
 * important" is twice "important", a scale the source never claims.
 * Discrete steps say the only true thing: this one is ranked above that
 * one.
 *
 * Takes every `ordinal`-kind fact IN STATE `value` from a group
 * (`school-facts-blocks.ts` batches them); the group's own `levels`
 * vocabulary comes from whichever fact carries one, since CollegeData's
 * selection-factor table shares one four-level scale across every row.
 * Sorted heaviest first, so the top of the block IS the answer.
 */

function isOrdinalValue(value: unknown): value is OrdinalValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as OrdinalValue).levels)
  );
}

export function FactOrdinal({
  facts,
}: {
  facts: readonly Fact[];
}): React.ReactElement | null {
  const items = facts
    .filter((fact) => fact.state === "value" && isOrdinalValue(fact.value))
    .map((fact) => {
      const value = fact.value as OrdinalValue;
      return {
        key: fact.key,
        label: fact.label,
        display: fact.display,
        level: value.levels.indexOf(value.code),
        levels: value.levels,
      };
    })
    .filter((item) => item.level >= 0)
    .sort((a, b) => b.level - a.level);

  if (items.length === 0) return null;
  const levels = items[0].levels;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            /* The level word is a fixed right column so every row's steps
             * land in one vertical line down the list. */
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto_8.5rem] sm:gap-x-5"
            key={item.key}
          >
            <span className="text-sm leading-6 text-[var(--school-fact-label)]">
              {item.label}
            </span>
            <span aria-hidden="true" className="order-3 flex gap-1 sm:order-none">
              {levels.map((level, position) => (
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
            {/* The words, always — the steps rank it, only this says what
             * the school actually wrote. */}
            <span className="text-sm leading-6 font-medium text-[var(--school-fact-value)] sm:text-right">
              {item.display}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
