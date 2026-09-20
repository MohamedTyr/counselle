/**
 * The dashboard's Topics panel (plan §5.2; ui-spec §3.2; parity F11-F13):
 * one raised panel holding the two module columns (EBRW, Math), rendered
 * from the same `SatModuleColumn` so the ~120 lines liprep duplicates per
 * module are written once here.
 */
import type React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
  onModuleSelectAll: (skillCodes: readonly string[], nextChecked: boolean) => void;
}

function domainSkillCodes(domain: SatDomainDef): string[] {
  return domain.skills.map((skill) => skill.code);
}

function domainCheckState(
  domain: SatDomainDef,
  selectedSkills: ReadonlySet<string>,
): "checked" | "indeterminate" | "unchecked" {
  const codes = domainSkillCodes(domain);
  const selectedCount = codes.filter((code) => selectedSkills.has(code)).length;
  if (selectedCount === 0) return "unchecked";
  if (selectedCount === codes.length) return "checked";
  return "indeterminate";
}

function domainCount(domain: SatDomainDef, counts: SatCounts | undefined): number {
  return domain.skills.reduce((sum, skill) => sum + (counts?.[skill.code] ?? 0), 0);
}

function ModuleColumnSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 py-2">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton className="h-9 w-full" key={index} />
      ))}
    </div>
  );
}

function SatModuleColumn({
  moduleDef,
  counts,
  isInitialLoading,
  isRefetching,
  selectedSkills,
  onToggleSkill,
  onToggleDomain,
  onModuleSelectAll,
}: {
  moduleDef: SatModuleDef;
  counts: SatCounts | undefined;
  isInitialLoading: boolean;
  isRefetching: boolean;
  selectedSkills: ReadonlySet<string>;
  onToggleSkill: (code: string) => void;
  onToggleDomain: (skillCodes: readonly string[], nextChecked: boolean) => void;
  onModuleSelectAll: (skillCodes: readonly string[], nextChecked: boolean) => void;
}): React.ReactElement {
  const allCodes = moduleDef.domains.flatMap(domainSkillCodes);
  const allSelected = allCodes.length > 0 && allCodes.every((code) => selectedSkills.has(code));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between px-4">
        <span className="text-sm font-semibold">{moduleDef.short_label}</span>
        <Button
          onClick={() => onModuleSelectAll(allCodes, !allSelected)}
          size="sm"
          variant="ghost"
        >
          {allSelected ? SAT_DASHBOARD_COPY.deselectAll : SAT_DASHBOARD_COPY.selectAll}
        </Button>
      </div>
      {isInitialLoading ? (
        <ModuleColumnSkeleton />
      ) : (
        moduleDef.domains.map((domain) => {
          const state = domainCheckState(domain, selectedSkills);
          const codes = domainSkillCodes(domain);
          return (
            <div key={domain.code}>
              <label
                className="flex h-9 cursor-pointer items-center gap-2 border-t border-[var(--hairline)] px-4 hover:bg-[var(--surface-hover)]"
              >
                <Checkbox
                  checked={state === "checked" ? true : state === "indeterminate" ? "indeterminate" : false}
                  onCheckedChange={(checked) => onToggleDomain(codes, checked !== false)}
                />
                <span className="flex-1 font-medium text-sm">{domain.name}</span>
                <span
                  className={cn(
                    "text-sm tabular-nums text-[var(--ink-secondary)]",
                    isRefetching && "opacity-64 transition-opacity duration-150",
                  )}
                >
                  {domainCount(domain, counts)}
                </span>
              </label>
              {domain.skills.map((skill) => (
                <label
                  className="flex min-h-9 cursor-pointer items-center gap-2 border-t border-[var(--hairline)] py-1.5 pr-4 pl-10 hover:bg-[var(--surface-hover)]"
                  key={skill.code}
                >
                  <Checkbox
                    checked={selectedSkills.has(skill.code)}
                    onCheckedChange={() => onToggleSkill(skill.code)}
                  />
                  <span className="flex-1 text-sm">{skill.name}</span>
                  <span
                    className={cn(
                      "text-sm tabular-nums text-[var(--ink-secondary)]",
                      isRefetching && "opacity-64 transition-opacity duration-150",
                    )}
                  >
                    {counts?.[skill.code] ?? 0}
                  </span>
                </label>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

export function SatTopicTree({
  modules,
  counts,
  isInitialLoading,
  isRefetching,
  selectedSkills,
  onToggleSkill,
  onToggleDomain,
  onModuleSelectAll,
}: SatTopicTreeProps): React.ReactElement {
  return (
    <div
      className="@container/sat-topics rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] py-2 shadow-[var(--elevation-1)]"
      data-slot="sat-topic-tree"
    >
      <div className="flex flex-col @[640px]/sat-topics:flex-row @[640px]/sat-topics:divide-x @[640px]/sat-topics:divide-[var(--hairline)]">
        {modules.map((moduleDef) => (
          <SatModuleColumn
            counts={counts}
            isInitialLoading={isInitialLoading}
            isRefetching={isRefetching}
            key={moduleDef.code}
            moduleDef={moduleDef}
            onModuleSelectAll={onModuleSelectAll}
            onToggleDomain={onToggleDomain}
            onToggleSkill={onToggleSkill}
            selectedSkills={selectedSkills}
          />
        ))}
      </div>
    </div>
  );
}
