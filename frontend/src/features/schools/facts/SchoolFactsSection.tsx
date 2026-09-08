import type React from "react";

import { ChartFoot } from "@/features/schools/facts/charts/chart-shell";
import { FactDistributionChart } from "@/features/schools/facts/charts/FactDistributionChart";
import { FactOrdinal } from "@/features/schools/facts/charts/FactOrdinal";
import { FactRangeChart } from "@/features/schools/facts/charts/FactRangeChart";
import { FactTable } from "@/features/schools/facts/FactTable";
import {
  groupBlocks,
  type FactBlock,
} from "@/features/schools/facts/school-facts-blocks";
import {
  compressAbsences,
  toFactRow,
} from "@/features/schools/facts/school-facts-rows";
import { SchoolFactsDeadlines } from "@/features/schools/facts/SchoolFactsDeadlines";
import { TableBlock } from "@/features/schools/facts/TableBlock";
import type {
  DeadlinesBlock,
  Fact,
  FactGroup,
  FactSection,
} from "@/features/schools/facts/school-facts-types";

/*
 * One section of the About tab.
 *
 * ONE raised panel holding a list of groups, each a band inside it — not six
 * cards. Every student-facing sentence here (`section.line`, `group.foot`)
 * is already composed server-side; this component only lays it out.
 */
export function SchoolFactsSection({
  deadlines,
  section,
}: {
  /** Only read for `section.id === "applying"` — the deadlines block is the
   * section's first group everywhere else on the wire (plan §5.2). */
  deadlines: DeadlinesBlock;
  section: FactSection;
}): React.ReactElement {
  const isApplying = section.id === "applying";

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
        {/* `line` is null exactly when `fetch_state === "ok"` — the resolved
         * failure/re-check/not-published sentence, composed once server-side
         * (plan §5.1/§5.2). Never a client-authored word. */}
        {section.line ? (
          <p className="text-sm leading-6 text-[var(--ink-secondary)]">
            {section.line}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col divide-y divide-[var(--school-fact-divider)] px-4 sm:px-6">
        {isApplying && deadlines.rows.length > 0 ? (
          <div className="py-6">
            <SchoolFactsDeadlines deadlines={deadlines} />
          </div>
        ) : null}
        {section.groups.map((group) => (
          <Group group={group} key={group.id} />
        ))}
      </div>
      {/* The section-level period foot — "Where no year is shown, we don't
       * know which year the figure covers." — emitted once, server-side,
       * whenever this section holds at least one fact with no
       * `reported_period` (plan §5.2). Independent of `fetch_state`: an
       * `ok` section still needs it. Rendered once here, never per fact. */}
      {section.foot ? (
        <p className="border-t border-[var(--school-fact-divider)] px-4 py-4 text-xs leading-5 text-[var(--ink-muted)] sm:px-6">
          {section.foot}
        </p>
      ) : null}
    </section>
  );
}

function Group({ group }: { group: FactGroup }): React.ReactElement | null {
  if (group.facts.length === 0) return null;
  const blocks = groupBlocks(group.facts);

  return (
    <div className="flex flex-col gap-3 py-6">
      {group.label ? (
        <h3 className="text-sm font-medium text-[var(--ink-secondary)]">
          {group.label}
        </h3>
      ) : null}
      {blocks.map((block, index) => (
        <Block block={block} key={index} />
      ))}
      {/* The merged foot slot — an authored `foot:` or a resolved
       * `foot_ref:` (e.g. `BAND_CAPTION`) — renders under the group's
       * content, whenever the group renders at all. One slot, one
       * position, so a group never has two homes for its qualifier. */}
      {group.foot ? <ChartFoot>{group.foot}</ChartFoot> : null}
    </div>
  );
}

function Block({ block }: { block: FactBlock }): React.ReactElement | null {
  switch (block.renderKind) {
    case "rows":
      return <FactTable rows={compressAbsences(block.facts.map(toFactRow))} />;
    case "ordinal":
      return <OrdinalBlock facts={block.facts} />;
    case "band":
      return <BandBlock facts={block.facts} />;
    case "distribution":
      return <DistributionBlock facts={block.facts} />;
    case "table":
      return (
        <div className="flex flex-col gap-4">
          {block.facts.map((fact) => (
            <TableBlock fact={fact} key={fact.key} />
          ))}
        </div>
      );
  }
}

/** Every non-`value` band/distribution fact still renders — as a row naming
 * the state, never dropped and never a zero-width mark (plan §5.1/§7). */
function partitionByValue(facts: readonly Fact[]): [Fact[], Fact[]] {
  const value: Fact[] = [];
  const absent: Fact[] = [];
  for (const fact of facts) (fact.state === "value" ? value : absent).push(fact);
  return [value, absent];
}

function BandBlock({ facts }: { facts: Fact[] }): React.ReactElement {
  const [value, absent] = partitionByValue(facts);
  return (
    <div className="flex flex-col gap-5">
      {value.map((fact) => (
        <FactRangeChart fact={fact} key={fact.key} />
      ))}
      {absent.length > 0 ? (
        <FactTable rows={compressAbsences(absent.map(toFactRow))} />
      ) : null}
    </div>
  );
}

function DistributionBlock({ facts }: { facts: Fact[] }): React.ReactElement {
  const [value, absent] = partitionByValue(facts);
  return (
    <div className="flex flex-col gap-4">
      {value.map((fact) => (
        <FactDistributionChart fact={fact} key={fact.key} />
      ))}
      {absent.length > 0 ? (
        <FactTable rows={compressAbsences(absent.map(toFactRow))} />
      ) : null}
    </div>
  );
}

function OrdinalBlock({ facts }: { facts: Fact[] }): React.ReactElement {
  const [, absent] = partitionByValue(facts);
  return (
    <div className="flex flex-col gap-3">
      <FactOrdinal facts={facts} />
      {absent.length > 0 ? (
        <FactTable rows={compressAbsences(absent.map(toFactRow))} />
      ) : null}
    </div>
  );
}
