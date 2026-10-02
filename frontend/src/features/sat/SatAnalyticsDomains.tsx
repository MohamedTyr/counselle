/**
 * The Domains & skills tab (ui-spec §5; parity A10). Rows come from the
 * static topic tree, not from the data (S17/S18) — a skill with no
 * attempts still renders, as "Untested".
 */
import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { useSatTaxonomy } from "@/api/sat/hooks";
import type { SatSkillPerformance, SatStatsResponse } from "@/api/sat/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsMeter } from "@/features/sat/SatAnalyticsMeter";
import { formatDuration, masteryLevel, type MasteryLevel } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";

type Section = "all" | "reading" | "math";

/** One grid for the domain header and every skill row under it, so the
 * column labels in the header sit exactly over their values. */
const ROW_GRID_CLASS =
  "@[760px]/sat-analytics:grid @[760px]/sat-analytics:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_6rem_4rem_5.5rem] @[760px]/sat-analytics:items-center @[760px]/sat-analytics:gap-x-3";
const WIDE_ONLY_CLASS = "hidden @[760px]/sat-analytics:block";
const NARROW_ONLY_CLASS = "text-[var(--ink-faint)] @[760px]/sat-analytics:hidden";

function MasteryBadge({ level }: { level: MasteryLevel }): React.ReactElement {
  return (
    <Badge variant={level === "mastered" ? "success" : "secondary"}>
      {SAT_ANALYTICS_COPY.domains.mastery[level]}
    </Badge>
  );
}

function SkillRow({
  onDrill,
  skill,
  stat,
}: {
  skill: { code: string; name: string };
  stat: SatSkillPerformance | undefined;
  onDrill: (skillCode: string) => void;
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.domains;
  const started = (stat?.uniqueQuestions ?? 0) > 0;
  const level = masteryLevel(stat?.firstTryAccuracyPct ?? 0, stat?.uniqueQuestions ?? 0);
  const dash = <span className="text-[var(--ink-faint)]">—</span>;
  return (
    <li
      className={cn(
        ROW_GRID_CLASS,
        "flex flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--canvas-hover)] border-b border-[var(--hairline)] last:border-b-0",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm">{skill.name}</span>
          {started ? (
            <MasteryBadge level={level} />
          ) : (
            <span className="text-xs text-[var(--ink-faint)] @[760px]/sat-analytics:hidden">
              {copy.mastery.untested}
            </span>
          )}
        </div>
        <Button
          className="@[760px]/sat-analytics:hidden"
          onClick={() => onDrill(skill.code)}
          size="sm"
          variant="ghost"
        >
          {copy.practice}
        </Button>
      </div>
      <div
        className={cn(
          "flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-secondary)] tabular-nums @[760px]/sat-analytics:contents",
          started ? "flex" : "hidden @[760px]/sat-analytics:contents",
        )}
      >
        <div className="flex items-center gap-2 @[760px]/sat-analytics:gap-3">
          <span className={NARROW_ONLY_CLASS}>{copy.columns.firstTry}</span>
          <AnalyticsMeter
            className="w-14 @[760px]/sat-analytics:w-20"
            label={`${skill.name} ${copy.columns.firstTry}`}
            value={started ? (stat?.firstTryAccuracyPct ?? 0) : null}
          />
          <span className="w-8 text-right text-sm text-[var(--ink)] @[760px]/sat-analytics:w-9">
            {started ? `${stat?.firstTryAccuracyPct}%` : dash}
          </span>
        </div>
        <span className="@[760px]/sat-analytics:text-sm">
          <span className={NARROW_ONLY_CLASS}>{copy.columns.overall} </span>
          {started ? `${stat?.overallAccuracyPct}%` : dash}
        </span>
        <span className="@[760px]/sat-analytics:text-sm">
          <span className={NARROW_ONLY_CLASS}>{copy.columns.questions} </span>
          {started ? copy.questionsCell(stat?.uniqueQuestions ?? 0, stat?.totalAttempts ?? 0) : dash}
        </span>
        <span className="@[760px]/sat-analytics:text-sm">
          <span className={NARROW_ONLY_CLASS}>{copy.columns.pace} </span>
          {started ? formatDuration(stat?.avgTimeSeconds ?? 0) : dash}
        </span>
      </div>
      <Button
        className={cn(WIDE_ONLY_CLASS, "justify-self-end")}
        onClick={() => onDrill(skill.code)}
        size="sm"
        variant="ghost"
      >
        {copy.practice}
      </Button>
    </li>
  );
}

function ColumnHeader(): React.ReactElement {
  const columns = SAT_ANALYTICS_COPY.domains.columns;
  return (
    <>
      <span className={WIDE_ONLY_CLASS}>{columns.firstTry}</span>
      <span className={WIDE_ONLY_CLASS}>{columns.overall}</span>
      <span className={WIDE_ONLY_CLASS}>{columns.questions}</span>
      <span className={WIDE_ONLY_CLASS}>{columns.pace}</span>
      <span aria-hidden="true" className={WIDE_ONLY_CLASS} />
    </>
  );
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

  const scopedModules = section === "all" ? modules : modules.filter((m) => m.code === section);
  const query = search.trim().toLowerCase();

  const totalSkillsInScope = scopedModules.reduce(
    (sum, mod) => sum + mod.domains.reduce((s, d) => s + d.skills.length, 0),
    0,
  );

  if (taxonomyQuery.isLoading || !taxonomyQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-full" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const sections = scopedModules.flatMap((mod) =>
    mod.domains.map((domain) => {
      const domainNameMatches = query.length > 0 && domain.name.toLowerCase().includes(query);
      const skills = domain.skills.filter(
        (skill) =>
          query.length === 0 ||
          domainNameMatches ||
          skill.name.toLowerCase().includes(query) ||
          skill.code.toLowerCase().includes(query),
      );
      if (skills.length === 0) return null;
      const perf = stats.domainStats[domain.code];
      return (
        <section className="flex flex-col gap-2" key={domain.code}>
          <div className={cn(analyticsSheetClass, "overflow-hidden")}>
            <div
              className={cn(
                ROW_GRID_CLASS,
                "flex flex-col gap-0.5 border-b border-[var(--hairline)] bg-[var(--canvas)] px-3 pt-2.5 pb-2 text-xs text-[var(--ink-secondary)]",
              )}
            >
              <div className="flex min-w-0 flex-col">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <span className="truncate">{domain.name}</span>
                  <Badge variant="secondary">{mod.code === "math" ? SAT_ANALYTICS_COPY.sections.math : SAT_ANALYTICS_COPY.sections.ebrw}</Badge>
                </h4>
                <span className="tabular-nums">
                  {copy.domainSummaryLine(
                    perf?.uniqueQuestions ?? 0,
                    perf?.firstTryAccuracyPct ?? 0,
                    perf?.avgTimeSeconds ?? 0,
                  )}
                </span>
              </div>
              <ColumnHeader />
            </div>
            <ul>
              {skills.map((skill) => (
                <SkillRow key={skill.code} onDrill={onDrill} skill={skill} stat={stats.skillStats[skill.code]} />
              ))}
            </ul>
          </div>
        </section>
      );
    }),
  );

  const body = sections.filter((section) => section !== null);
  const anyMatch = body.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 @[640px]/sat-analytics:flex-row @[640px]/sat-analytics:items-center @[640px]/sat-analytics:justify-between">
        <Tabs onValueChange={(value) => setSection(value as Section)} value={section}>
          <TabsList aria-label={SAT_ANALYTICS_COPY.sections.ebrw} className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" variant="pill">
            <TabsTab value="all">{segments.all}</TabsTab>
            <TabsTab value="reading">{segments.ebrw}</TabsTab>
            <TabsTab value="math">{segments.math}</TabsTab>
          </TabsList>
        </Tabs>
        <InputGroup className="w-full @[640px]/sat-analytics:max-w-xs">
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
