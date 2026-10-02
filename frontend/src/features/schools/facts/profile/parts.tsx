import type React from "react";

import { cn } from "@/lib/utils";

/* Small pieces the blocks share: a key-facts list and the absent-value tone. */

export type KeyFact = {
  label: string;
  value: React.ReactNode | null;
  note?: string | null;
};

/** Label left, value right. A fact with no published value is dropped. */
export function KeyFacts({
  facts,
  className,
  dense = false,
}: {
  facts: KeyFact[];
  className?: string;
  dense?: boolean;
}) {
  const shown = facts.filter((f) => f.value !== null && f.value !== undefined);
  if (shown.length === 0) return null;
  return (
    <dl className={cn("flex flex-col", className)}>
      {shown.map((fact) => (
        <div
          className={cn(
            "flex items-baseline justify-between gap-4 border-b border-[var(--school-fact-divider)] last:border-b-0",
            dense ? "py-2" : "py-2.5",
          )}
          key={fact.label}
        >
          <dt className="text-sm text-[var(--ink-secondary)]">{fact.label}</dt>
          <dd className="text-right text-sm font-medium text-[var(--ink)] tabular-nums">
            {fact.value}
            {fact.note ? (
              <span className="block text-xs font-normal text-[var(--ink-muted)]">
                {fact.note}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Missing({
  children = "Not published",
}: {
  children?: React.ReactNode;
}) {
  return (
    <span className="text-sm text-[var(--school-fact-absent)]">{children}</span>
  );
}
