import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { AccordionPrimitive } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { GroupCaveat } from "@/features/schools/facts/CaveatLine";
import { cn } from "@/lib/utils";

/*
 * A group of facts is a <dl>, and this is the same component the chat's
 * `stat_block` viz renders through — there is one implementation of "a list
 * of labelled values with their qualifiers", not two, because two would
 * drift and the drift would land on the honesty rules.
 *
 * Rows are separated by a hairline rule, never by borders and never by
 * cards. A page has exactly one raised level and a card never contains a
 * card (DESIGN §4); the panel is that level, and everything inside it is
 * separated by rules and headings.
 */

export function FactGroup({
  caveat,
  children,
  title,
}: {
  caveat?: string | null;
  children: ReactNode;
  title?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <h3 className="text-sm font-medium text-[var(--ink)]">{title}</h3>
      ) : null}
      {caveat ? <GroupCaveat text={caveat} /> : null}
      <dl className="divide-y divide-[var(--school-fact-divider)]">
        {children}
      </dl>
    </div>
  );
}

/**
 * The collapsed detail group.
 *
 * The closed header carries the metric count and, when the group contains a
 * severe caveat or a value the school withheld, a `Check this` badge — so
 * the flag is legible without opening anything. An honesty flag is never
 * hidden behind a disclosure (DESIGN rule 38); a disclosure that hides one
 * is worse than no disclosure, because it makes the page look complete.
 */
export function CollapsibleFactGroup({
  caveat,
  children,
  count,
  needsAttention,
  title,
  value,
}: {
  caveat?: string | null;
  children: ReactNode;
  count: number;
  needsAttention: boolean;
  title: string;
  value: string;
}) {
  return (
    <AccordionPrimitive.Item
      className="border-0"
      data-slot="accordion-item"
      value={value}
    >
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger
          className={cn(
            /* -mx-2 px-2 so the chevron sits on the fact rows' own left
             * edge: the title then indents by exactly the disclosure glyph,
             * which is the amount of indent the nesting actually earns. */
            "-mx-2 flex h-9 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md px-2",
            "text-left text-sm font-medium text-[var(--ink)]",
            "transition-colors duration-150 outline-none",
            "hover:bg-[var(--surface-hover)]",
            "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
            "data-panel-open:*:data-[slot=group-indicator]:rotate-90",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 opacity-70 transition-transform duration-150 ease-out motion-reduce:transition-none"
              data-slot="group-indicator"
            />
            <span className="truncate">{title}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {needsAttention ? (
              <Badge variant="warning">Check this</Badge>
            ) : null}
            <span className="text-xs tabular-nums text-[var(--ink-muted)]">
              {count}
            </span>
          </span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Panel
        /*
         * Height is a layout property and normally a last resort. The
         * accordion is the documented exception: the height change IS the
         * disclosure, so it survives prefers-reduced-motion while the
         * chevron rotation does not.
         */
        className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
        data-slot="accordion-panel"
      >
        {/* An inset surface never draws a border. */}
        <div className="mt-1 rounded-md bg-[var(--school-fact-well)] p-4">
          <FactGroup caveat={caveat}>{children}</FactGroup>
        </div>
      </AccordionPrimitive.Panel>
    </AccordionPrimitive.Item>
  );
}

export function FactGroupAccordion({ children }: { children: ReactNode }) {
  return (
    <AccordionPrimitive.Root
      className="flex flex-col gap-1"
      data-slot="accordion"
      multiple
    >
      {children}
    </AccordionPrimitive.Root>
  );
}
