import type React from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FactTable } from "@/features/schools/facts/FactTable";
import type { FactTableRow } from "@/features/schools/facts/school-facts-rows";
import { coverageSentence } from "@/features/schools/facts/school-facts-format";
import { FactBarChart } from "@/features/schools/facts/charts/FactBarChart";
import { FactOrdinal } from "@/features/schools/facts/charts/FactOrdinal";
import { FactRangeChart } from "@/features/schools/facts/charts/FactRangeChart";
import { ChartFoot } from "@/features/schools/facts/charts/chart-shell";
import {
  sectionBlocks,
  type SectionBlock,
} from "@/features/schools/facts/school-facts-blocks";
import type { SectionConfig } from "@/features/schools/facts/school-facts-sections";
import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/**
 * One section of the About tab.
 *
 * ONE raised panel holding a list of blocks, each either a chart or a
 * name/value table. Not six cards: the section is the container, the groups
 * are bands inside it, and the panel's padding is the single left edge every
 * row, title and chart shares. The headline leads at one density step up —
 * never as a hero number, which is a template rather than a hierarchy.
 */
export function SchoolFactsSection({
  data,
  section,
}: {
  data: SchoolFacts;
  section: SectionConfig;
}): React.ReactElement {
  const blocks = sectionBlocks(data, section);
  const coverage = data.coverage[section.id];

  return (
    <section
      aria-labelledby={`section-${section.id}`}
      className="overflow-hidden rounded-xl border border-[var(--school-facts-panel-border)] bg-[var(--school-facts-panel-surface)]"
    >
      <header className="flex flex-col gap-1 border-b border-[var(--school-fact-divider)] px-4 py-5 sm:px-6">
        <h2
          className="text-lg font-medium text-[var(--ink)]"
          id={`section-${section.id}`}
        >
          {section.title}
        </h2>
        {/* What the section rests on, in words. Plain text rather than a
         * meter — see coverageSentence. */}
        {coverage ? (
          <p className="text-xs leading-5 text-[var(--ink-secondary)]">
            {coverageSentence(coverage)}
          </p>
        ) : null}
      </header>
      {blocks.length > 0 ? (
        <div className="flex flex-col px-4 sm:px-6">
          {pairBlocks(blocks).map((band, index) => (
            <Band band={band} key={band[0].id} showDivider={index > 0} />
          ))}
        </div>
      ) : (
        /*
         * A section with nothing in it says so in words. Rendering an empty
         * frame would read as "we looked and there is nothing here", which is
         * a stronger claim than the one we can make.
         */
        <p className="px-4 py-6 text-sm leading-6 sm:px-6 text-[var(--ink-secondary)]">
          {data.identity.name}'s Common Data Set doesn't cover this section, or
          we haven't been able to read it. We don't fill the gap from an older
          edition.
        </p>
      )}
    </section>
  );
}

/** How many rows a group may have and still share a band with another. */
const PAIRABLE_ROWS = 8;

/**
 * Two short, unrelated tables side by side instead of queued vertically.
 *
 * "Required high-school units", "Class rank" and "Waitlist" are sixteen rows
 * between them with no dependency on each other, and stacked they are half a
 * screen of scrolling before the applicant pool. Only plain row groups pair —
 * a chart owns its full width, and the headline is the lead band.
 *
 * The pair is a BAND, not two cards. Both halves keep the same rows, the same
 * hairlines and the same left edge they would have alone; the only thing that
 * changes is that one sits beside the other from `lg:` up. A border or a fill
 * per half would be a card inside the section panel, which is the exact defect
 * this whole pass removed.
 */
function pairBlocks(blocks: readonly SectionBlock[]): SectionBlock[][] {
  const pairable = (block: SectionBlock) =>
    block.kind === "rows" &&
    !block.emphasis &&
    !block.collapsible &&
    block.title !== null &&
    block.rows.length <= PAIRABLE_ROWS;

  const bands: SectionBlock[][] = [];
  for (let i = 0; i < blocks.length; ) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (next && pairable(block) && pairable(next)) {
      bands.push([block, next]);
      i += 2;
      continue;
    }
    bands.push([block]);
    i += 1;
  }
  return bands;
}

function Band({
  band,
  showDivider,
}: {
  band: SectionBlock[];
  showDivider: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "py-6",
        band.length > 1 && "grid gap-6 lg:grid-cols-2 lg:gap-x-10",
        /* The band separator. A rule between groups, never a border around
         * one — the panel already owns the only perimeter in the section. */
        showDivider && "border-t border-[var(--school-fact-divider)]",
      )}
    >
      {band.map((block) => (
        <Block block={block} key={block.id} />
      ))}
    </div>
  );
}

function Block({ block }: { block: SectionBlock }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {block.title ? <GroupTitle>{block.title}</GroupTitle> : null}
      <div className="empty:hidden">
        <Mark block={block} />
      </div>
      {/* Directly under the mark it qualifies. A qualifier separated from
       * its chart by a table of other values is a qualifier for nothing. */}
      {block.foot ? <ChartFoot>{block.foot}</ChartFoot> : null}
      {/*
       * Everything the chart could not plot. Never omitted, never a zero-width
       * bar — the value renders as the sentence naming which kind of nothing
       * it is, in the same table as every other row on the page.
       */}
      {block.kind === "rows" && block.collapsible ? (
        <OverflowRows rows={block.rows} />
      ) : block.rows.length > 0 ? (
        <FactTable
          emphasis={block.kind === "rows" && block.emphasis}
          rows={block.rows}
        />
      ) : null}
    </div>
  );
}

/** Rows shown before the fold in the overflow bucket. */
const OVERFLOW_VISIBLE = 8;

/**
 * The overflow bucket, folded.
 *
 * This is the ONLY group on the tab that collapses, and only past eight rows.
 * Curated groups stay open — folding one would hide the thing the page exists
 * to show — but "Other published values" is by construction the metrics the
 * config had no place for, and a long tail of them stands between a student
 * and the next section.
 *
 * The count is on the trigger, never a bare "Show more": how much is behind a
 * fold is itself information, and a disclosure that will not say how much it
 * is holding is asking to be trusted rather than read.
 */
function OverflowRows({
  rows,
}: {
  rows: readonly FactTableRow[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  if (rows.length <= OVERFLOW_VISIBLE) return <FactTable rows={rows} />;

  const hidden = rows.length - OVERFLOW_VISIBLE;
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <FactTable rows={rows.slice(0, OVERFLOW_VISIBLE)} />
      <CollapsibleContent>
        <FactTable rows={rows.slice(OVERFLOW_VISIBLE)} />
      </CollapsibleContent>
      <CollapsibleTrigger
        className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-sm text-[var(--ink-secondary)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none"
        data-slot="overflow-toggle"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
        {open ? `Show ${hidden} fewer` : `Show ${hidden} more`}
      </CollapsibleTrigger>
    </Collapsible>
  );
}

function Mark({ block }: { block: SectionBlock }): React.ReactElement | null {
  switch (block.kind) {
    case "bars":
      return <FactBarChart block={block} />;
    case "bands":
      return <FactRangeChart block={block} />;
    case "ordinal":
      return <FactOrdinal block={block} />;
    default:
      /* A rows block's values ARE its rows, rendered by `Block`. */
      return null;
  }
}

/**
 * A group heading. Space above it is the separator — no rule, no eyebrow, no
 * number, no icon. Three of those would be decoration on a page whose job is
 * to be believed.
 */
function GroupTitle({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <h3 className="text-sm font-medium text-[var(--ink-secondary)]">
      {children}
    </h3>
  );
}
