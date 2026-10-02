/**
 * The dashboard's Topics (plan §5.2; ui-spec §3.2; parity F11-F13): one
 * raised sheet per section (Reading and Writing, Math), each a group label
 * with its live selected count above domain subheads and light skill rows,
 * all rendered from the same `SatModuleSection`.
 */
import type React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import type { SatCounts, SatDomainDef, SatModuleDef } from "@/api/sat/types";

export interface SatTopicTreeProps {
  modules: readonly SatModuleDef[];
  counts: SatCounts | undefined;
  /** True only while there is no `counts` at all yet (first load) — a
   * refetch with `keepPreviousData` dims the numbers instead (§3.2). */
  isInitialLoading: boolean;
  isRefetching: boolean;
  selectedSkills: ReadonlySet<string>;
  onToggleSkill: (code: string) => void;
  onToggleDomain: (skillCodes: readonly string[], nextChecked: boolean) => void;
  onModuleSelectAll: (
    skillCodes: readonly string[],
    nextChecked: boolean,
  ) => void;
}

const ROW_BASE =
  "flex cursor-pointer items-center gap-3 rounded-lg px-2 outline-none transition-colors duration-150 ease-out hover:bg-[var(--canvas-hover)] focus-within:bg-[var(--canvas-hover)] active:bg-[var(--canvas-active)] motion-reduce:transition-none";

function domainSkillCodes(domain: SatDomainDef): string[] {
  return domain.skills.map((skill) => skill.code);
}

function domainCheckState(
  domain: SatDomainDef,
  selectedSkills: ReadonlySet<string>,
): boolean | "indeterminate" {
  const codes = domainSkillCodes(domain);
  const selectedCount = codes.filter((code) => selectedSkills.has(code)).length;
  if (selectedCount === 0) return false;
  return selectedCount === codes.length ? true : "indeterminate";
}

function domainCount(
  domain: SatDomainDef,
  counts: SatCounts | undefined,
): number {
  return domain.skills.reduce(
    (sum, skill) => sum + (counts?.[skill.code] ?? 0),
    0,
  );
}

function Count({
  dimmed,
  value,
}: {
  dimmed: boolean;
  value: number;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "text-xs tabular-nums text-[var(--ink-faint)]",
        dimmed &&
          "opacity-64 transition-opacity duration-150 motion-reduce:transition-none",
      )}
    >
      {value.toLocaleString("en-US")}
    </span>
  );
}

function SectionSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 p-2">
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton className="h-8 w-full rounded-lg" key={index} />
      ))}
    </div>
  );
}

/** Two placeholder sheets for the moments before the taxonomy has loaded. */
export function SatTopicTreeSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className="@container/sat-topics">
      <div className="grid grid-cols-1 items-start gap-8 @[640px]/sat-topics:grid-cols-2 @[640px]/sat-topics:gap-6">
        {[0, 1].map((index) => (
          <div key={index}>
            <Skeleton className="mb-2 h-7 w-44" />
            <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-1 shadow-[var(--elevation-1)]">
              <SectionSkeleton />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SatDomainBlock({
  domain,
  counts,
  isRefetching,
  selectedSkills,
  onToggleSkill,
  onToggleDomain,
}: {
  domain: SatDomainDef;
  counts: SatCounts | undefined;
  isRefetching: boolean;
  selectedSkills: ReadonlySet<string>;
  onToggleSkill: (code: string) => void;
  onToggleDomain: (skillCodes: readonly string[], nextChecked: boolean) => void;
}): React.ReactElement {
  const codes = domainSkillCodes(domain);
  return (
    <div className="flex flex-col py-1 not-first:border-t not-first:border-[var(--hairline)]">
      <label className={cn(ROW_BASE, "h-10")}>
        <Checkbox
          checked={domainCheckState(domain, selectedSkills)}
          className="rounded-full"
          onCheckedChange={(checked) =>
            onToggleDomain(codes, checked !== false)
          }
        />
        <span className="min-w-0 flex-1 text-sm leading-5 font-semibold">
          {domain.name}
        </span>
        <Count dimmed={isRefetching} value={domainCount(domain, counts)} />
      </label>
      {domain.skills.map((skill) => (
        <label
          className={cn(ROW_BASE, "group/skill min-h-9 py-1.5 pl-9")}
          key={skill.code}
        >
          <Checkbox
            checked={selectedSkills.has(skill.code)}
            className="rounded-full"
            onCheckedChange={() => onToggleSkill(skill.code)}
          />
          <span className="min-w-0 flex-1 text-sm leading-5 text-[var(--ink-secondary)] group-has-[[data-state=checked]]/skill:text-[var(--ink)]">
            {skill.name}
          </span>
          <Count dimmed={isRefetching} value={counts?.[skill.code] ?? 0} />
        </label>
      ))}
    </div>
  );
}

function SatModuleSection({
  moduleDef,
  counts,
  isInitialLoading,
  isRefetching,
  selectedSkills,
  onToggleSkill,
  onToggleDomain,
  onModuleSelectAll,
}: Omit<SatTopicTreeProps, "modules"> & {
  moduleDef: SatModuleDef;
}): React.ReactElement {
  const allCodes = moduleDef.domains.flatMap(domainSkillCodes);
  const selectedCount = allCodes.filter((code) =>
    selectedSkills.has(code),
  ).length;
  const allSelected = allCodes.length > 0 && selectedCount === allCodes.length;

  return (
    <section className="min-w-0" data-slot="sat-module-section">
      <div className="mb-2 flex h-7 items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-baseline gap-2 text-chrome font-semibold">
          <span className="truncate">{moduleDef.long_label}</span>
          <span className="text-xs font-normal tabular-nums text-[var(--ink-faint)]">
            {selectedCount} of {allCodes.length} selected
          </span>
        </h2>
        <button
          className="-mr-2 h-7 shrink-0 cursor-pointer rounded-full px-2.5 text-xs text-[var(--ink-secondary)] outline-none transition-[color,background-color,scale] duration-150 ease-out hover:bg-[var(--canvas-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.97] motion-reduce:transition-none"
          onClick={() => onModuleSelectAll(allCodes, !allSelected)}
          type="button"
        >
          {allSelected
            ? SAT_DASHBOARD_COPY.deselectAll
            : SAT_DASHBOARD_COPY.selectAll}
        </button>
      </div>
      <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-raised)] p-1 shadow-[var(--elevation-1)]">
        {isInitialLoading ? (
          <SectionSkeleton />
        ) : (
          moduleDef.domains.map((domain) => (
            <SatDomainBlock
              counts={counts}
              domain={domain}
              isRefetching={isRefetching}
              key={domain.code}
              onToggleDomain={onToggleDomain}
              onToggleSkill={onToggleSkill}
              selectedSkills={selectedSkills}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function SatTopicTree({
  modules,
  ...rest
}: SatTopicTreeProps): React.ReactElement {
  return (
    <div className="@container/sat-topics" data-slot="sat-topic-tree">
      <div className="grid grid-cols-1 items-start gap-8 @[640px]/sat-topics:grid-cols-2 @[640px]/sat-topics:gap-6">
        {modules.map((moduleDef) => (
          <SatModuleSection
            key={moduleDef.code}
            moduleDef={moduleDef}
            {...rest}
          />
        ))}
      </div>
    </div>
  );
}
