import type React from "react";

import { FactTable } from "@/features/schools/facts/FactTable";
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
          {blocks.map((block, index) => (
            <Block block={block} key={block.id} showDivider={index > 0} />
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

function Block({
  block,
  showDivider,
}: {
  block: SectionBlock;
  showDivider: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-6",
        /* The band separator. A rule between groups, never a border around
         * one — the panel already owns the only perimeter in the section. */
        showDivider && "border-t border-[var(--school-fact-divider)]",
      )}
    >
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
      {block.rows.length > 0 ? (
        <FactTable
          emphasis={block.kind === "rows" && block.emphasis}
          rows={block.rows}
        />
      ) : null}
    </div>
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
