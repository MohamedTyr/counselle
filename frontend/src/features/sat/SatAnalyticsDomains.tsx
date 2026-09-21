/**
 * The Domains & skills tab (ui-spec §5; parity A10). Rows come from the
 * static topic tree, not from the data (S17/S18) — a skill with no
 * attempts still renders, as "Untested".
 */
import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { useSatTaxonomy } from "@/api/sat/hooks";
import type { SatModuleDef, SatSkillPerformance, SatStatsResponse } from "@/api/sat/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { masteryLevel, type MasteryLevel } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";
import { formatAttemptSeconds } from "@/features/sat/sat-format";

type Section = "all" | "reading" | "math";

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  developing: "Developing",
  mastered: "Mastered",
  needsFocus: "Needs focus",
  untested: "Untested",
};

function MasteryBadge({ level }: { level: MasteryLevel }): React.ReactElement {
  return (
    <Badge variant={level === "mastered" ? "success" : "secondary"}>{MASTERY_LABEL[level]}</Badge>
  );
}

function moduleLabel(module: SatModuleDef): string {
  return module.short_label;
}

export function SatAnalyticsDomains({
  onDrill,
  stats,
}: {
  stats: SatStatsResponse;
  onDrill: (skillCode: string) => void;
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.domains;
  const taxonomyQuery = useSatTaxonomy();
  const [section, setSection] = useState<Section>("all");
  const [search, setSearch] = useState("");

  const modules = useMemo(
    () => (taxonomyQuery.data ? [...taxonomyQuery.data.modules].sort((a, b) => a.order - b.order) : []),
    [taxonomyQuery.data],
  );

  const ebrwDomainCount = modules.find((m) => m.code === "reading")?.domains.length ?? 0;
  const mathDomainCount = modules.find((m) => m.code === "math")?.domains.length ?? 0;
  const segments = copy.sectionSegments(ebrwDomainCount, mathDomainCount, ebrwDomainCount + mathDomainCount);
  const options: readonly SegmentedControlOption<Section>[] = [
    { label: segments.all, value: "all" },
    { label: segments.ebrw, value: "reading" },
    { label: segments.math, value: "math" },
  ];

  const scopedModules = section === "all" ? modules : modules.filter((m) => m.code === section);
  const query = search.trim().toLowerCase();

  const totalSkillsInScope = scopedModules.reduce(
    (sum, mod) => sum + mod.domains.reduce((s, d) => s + d.skills.length, 0),
    0,
  );

  if (taxonomyQuery.isLoading || !taxonomyQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  let anyMatch = false;

  const body = scopedModules.map((mod) => {
    const domainRows = mod.domains
      .map((domain) => {
        const domainNameMatches = query.length > 0 && domain.name.toLowerCase().includes(query);
        const skills = domain.skills.filter(
          (skill) =>
            query.length === 0 ||
            domainNameMatches ||
            skill.name.toLowerCase().includes(query) ||
            skill.code.toLowerCase().includes(query),
        );
        if (skills.length === 0) return null;
        anyMatch = true;
        const perf = stats.domainStats[domain.code];
        return { domain, perf, skills };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (domainRows.length === 0) return null;

    return (
      <div className="flex flex-col gap-4" key={mod.code}>
        {domainRows.map(({ domain, perf, skills }) => (
          <div className="flex flex-col gap-2" key={domain.code}>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{moduleLabel(mod)}</Badge>
              <h4 className="text-sm font-semibold">{domain.name}</h4>
              <span className="text-xs text-[var(--ink-secondary)]">
                {copy.domainSummaryLine(
                  perf?.uniqueQuestions ?? 0,
                  perf?.firstTryAccuracyPct ?? 0,
                  perf?.avgTimeSeconds ?? 0,
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 @[960px]/sat-analytics:gap-0">
              {skills.map((skill) => {
                const skillStat: SatSkillPerformance | undefined = stats.skillStats[skill.code];
                const level = masteryLevel(skillStat?.firstTryAccuracyPct ?? 0, skillStat?.uniqueQuestions ?? 0);
                return (
                  <div
                    className="flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-accent @[960px]/sat-analytics:flex-row @[960px]/sat-analytics:items-center @[960px]/sat-analytics:justify-between"
                    key={skill.code}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm">{skill.name}</span>
                      <MasteryBadge level={level} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-secondary)]">
                      <div className="flex w-24 items-center gap-2">
                        <Meter className="w-16" max={100} min={0} value={skillStat?.firstTryAccuracyPct ?? 0}>
                          <MeterTrack>
                            <MeterIndicator variant="neutral" />
                          </MeterTrack>
                        </Meter>
                        <span className="tabular-nums">{skillStat?.firstTryAccuracyPct ?? 0}%</span>
                      </div>
                      <span className="tabular-nums">{skillStat?.overallAccuracyPct ?? 0}%</span>
                      <span className="tabular-nums">
                        {skillStat?.uniqueQuestions ?? 0} ({skillStat?.totalAttempts ?? 0})
                      </span>
                      <span className="tabular-nums">{formatAttemptSeconds(skillStat?.avgTimeSeconds ?? 0)}</span>
                      <Button onClick={() => onDrill(skill.code)} size="sm" variant="ghost">
                        {copy.practice}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 @[640px]/sat-analytics:flex-row @[640px]/sat-analytics:items-center @[640px]/sat-analytics:justify-between">
        <SegmentedControl label={segments.all} onValueChange={setSection} options={options} value={section} />
        <InputGroup className="w-full max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={copy.searchPlaceholder}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.searchPlaceholder}
            value={search}
          />
        </InputGroup>
      </div>

      {query.length > 0 && !anyMatch ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="font-heading text-base font-medium">{copy.noSkillsMatch.title}</p>
          <p className="text-sm text-[var(--ink-secondary)]">
            {copy.noSkillsMatch.description(totalSkillsInScope)}
          </p>
          <Button onClick={() => setSearch("")} variant="outline">
            {copy.noSkillsMatch.clearSearch}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">{body}</div>
      )}
    </div>
  );
}
