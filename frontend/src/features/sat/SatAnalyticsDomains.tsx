/**
 * The Domains & skills tab (ui-spec §5; parity A10). Rows come from the
 * static topic tree, not from the data (S17/S18) — a skill with no
 * attempts still renders, as "No attempts yet".
 */
import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { useSatTaxonomy } from "@/api/sat/hooks";
import type { SatSkillPerformance, SatStatsResponse } from "@/api/sat/types";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsMeter } from "@/features/sat/SatAnalyticsMeter";
import { formatDuration } from "@/features/sat/sat-analytics";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { analyticsSheetClass } from "@/features/sat/sat-analytics-styles";
import { cn } from "@/lib/utils";

type Section = "all" | "reading" | "math";

/** One grid for the domain header and every skill row under it, so the
 * column labels in the header sit exactly over their values. */
const ROW_GRID_CLASS =
  "@[760px]/sat-analytics:grid @[760px]/sat-analytics:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_6rem_4rem_5.5rem] @[760px]/sat-analytics:items-center @[760px]/sat-analytics:gap-x-3";
const WIDE_ONLY_CLASS = "hidden @[760px]/sat-analytics:block";
/** Column labels sit inline on narrow layouts and become screen-reader
 * only on wide ones, where the pinned header carries them visually. */
const CELL_LABEL_CLASS = "text-[var(--ink-faint)] @[760px]/sat-analytics:sr-only";

function PracticeButton({
  className,
  onDrill,
  skill,
}: {
  className?: string;
  skill: { code: string; name: string };
  onDrill: (skillCode: string) => void;
}): React.ReactElement {
  const label = SAT_ANALYTICS_COPY.domains.practice;
  return (
    <Button
      aria-label={`${label} ${skill.name}`}
      className={cn("h-7 px-3 text-xs", className)}
      onClick={() => onDrill(skill.code)}
      size="sm"
      variant="outline"
    >
      {label}
    </Button>
  );
}

function SkillStats({
  skill,
  stat,
}: {
  skill: { name: string };
  stat: SatSkillPerformance | undefined;
}): React.ReactElement {
  const copy = SAT_ANALYTICS_COPY.domains;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-secondary)] tabular-nums @[760px]/sat-analytics:contents">
      <div className="flex items-center gap-2 @[760px]/sat-analytics:gap-3">
        <span className={CELL_LABEL_CLASS}>{copy.columns.firstTry}</span>
        <AnalyticsMeter
          className="w-14 @[760px]/sat-analytics:w-20"
          label={`${skill.name} ${copy.columns.firstTry}`}
          value={stat?.firstTryAccuracyPct ?? 0}
        />
        <span className="w-8 text-right text-sm text-[var(--ink)] @[760px]/sat-analytics:w-9">
          {stat?.firstTryAccuracyPct}%
        </span>
      </div>
      <span className="@[760px]/sat-analytics:text-sm">
        <span className={CELL_LABEL_CLASS}>{copy.columns.overall} </span>
        {stat?.overallAccuracyPct}%
      </span>
      <span className="@[760px]/sat-analytics:text-sm">
        <span className={CELL_LABEL_CLASS}>{copy.columns.questions} </span>
        {copy.questionsCell(stat?.uniqueQuestions ?? 0, stat?.totalAttempts ?? 0)}
      </span>
      <span className="@[760px]/sat-analytics:text-sm">
        <span className={CELL_LABEL_CLASS}>{copy.columns.pace} </span>
        {formatDuration(stat?.avgTimeSeconds ?? 0)}
      </span>
    </div>
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
  const started = (stat?.uniqueQuestions ?? 0) > 0;
  return (
    <li
      className={cn(
        ROW_GRID_CLASS,
        "flex flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--canvas-hover)] border-b border-[var(--hairline)] last:border-b-0",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-sm">{skill.name}</span>
        <PracticeButton className="@[760px]/sat-analytics:hidden" onDrill={onDrill} skill={skill} />
      </div>
      {started ? (
        <SkillStats skill={skill} stat={stat} />
      ) : (
        <span className="text-xs text-[var(--ink-faint)] @[760px]/sat-analytics:col-span-4">
          {SAT_ANALYTICS_COPY.domains.noAttempts}
        </span>
      )}
      <PracticeButton className={cn(WIDE_ONLY_CLASS, "justify-self-end")} onDrill={onDrill} skill={skill} />
    </li>
  );
}

/** Wide layouts only: the column labels stay pinned at the top of the
 * scroll area so every domain group below them is still labelled. */
function StickyColumnHeader(): React.ReactElement {
  const columns = SAT_ANALYTICS_COPY.domains.columns;
  return (
    <div
      aria-hidden="true"
      className={cn(
        ROW_GRID_CLASS,
        "sticky top-0 z-10 -mb-4 hidden border-b border-[var(--hairline)] bg-[var(--canvas)] px-[calc(0.75rem+1px)] py-2 text-xs text-[var(--ink-secondary)] @[760px]/sat-analytics:grid",
      )}
    >
      <span>{columns.skill}</span>
      <span>{columns.firstTry}</span>
      <span>{columns.overall}</span>
      <span>{columns.questions}</span>
      <span>{columns.pace}</span>
      <span />
    </div>
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
    () =>
      taxonomyQuery.data
        ? [...taxonomyQuery.data.modules].sort((a, b) => a.order - b.order)
        : [],
    [taxonomyQuery.data],
  );

  const skillCount = (code: string): number =>
    modules
      .find((m) => m.code === code)
      ?.domains.reduce((sum, d) => sum + d.skills.length, 0) ?? 0;
  const ebrwSkillCount = skillCount("reading");
  const mathSkillCount = skillCount("math");
  const segments = copy.sectionSegments(
    ebrwSkillCount,
    mathSkillCount,
    ebrwSkillCount + mathSkillCount,
  );

  const scopedModules =
    section === "all" ? modules : modules.filter((m) => m.code === section);
  const query = search.trim().toLowerCase();

  const totalSkillsInScope = scopedModules.reduce(
    (sum, mod) => sum + mod.domains.reduce((s, d) => s + d.skills.length, 0),
    0,
  );

  if (taxonomyQuery.isError) {
    return (
      <ErrorCard
        message={SAT_ANALYTICS_COPY.loadFailed.description}
        onRetry={() => taxonomyQuery.refetch()}
        retryLabel={SAT_ANALYTICS_COPY.loadFailed.retry}
        title={SAT_ANALYTICS_COPY.loadFailed.title}
      />
    );
  }
  if (taxonomyQuery.isLoading || !taxonomyQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-full" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const groups = scopedModules
    .flatMap((mod) => mod.domains)
    .map((domain) => {
      const domainNameMatches =
        query.length > 0 && domain.name.toLowerCase().includes(query);
      const skills = domain.skills.filter(
        (skill) =>
          query.length === 0 ||
          domainNameMatches ||
          skill.name.toLowerCase().includes(query) ||
          skill.code.toLowerCase().includes(query),
      );
      return { domain, skills };
    })
    .filter((group) => group.skills.length > 0);

  const body = groups.map(({ domain, skills }) => (
    <section className="flex flex-col gap-2" key={domain.code}>
      <div className={cn(analyticsSheetClass, "overflow-hidden")}>
        <h4 className="truncate border-b border-[var(--hairline)] bg-[var(--canvas)] px-3 pt-2.5 pb-2 text-sm font-semibold text-[var(--ink)]">
          {domain.name}
        </h4>
        <ul>
          {skills.map((skill) => (
            <SkillRow
              key={skill.code}
              onDrill={onDrill}
              skill={skill}
              stat={stats.skillStats[skill.code]}
            />
          ))}
        </ul>
      </div>
    </section>
  ));
  const anyMatch = body.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 @[640px]/sat-analytics:flex-row @[640px]/sat-analytics:items-center @[640px]/sat-analytics:justify-between">
        <Tabs
          onValueChange={(value) => setSection(value as Section)}
          value={section}
        >
          <TabsList
            aria-label={SAT_ANALYTICS_COPY.sections.label}
            className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            variant="pill"
          >
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
          <p className="font-heading text-base font-medium">
            {copy.noSkillsMatch.title}
          </p>
          <p className="text-sm text-[var(--ink-secondary)]">
            {copy.noSkillsMatch.description(totalSkillsInScope)}
          </p>
          <Button onClick={() => setSearch("")} variant="outline">
            {copy.noSkillsMatch.clearSearch}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <StickyColumnHeader />
          {body}
        </div>
      )}
    </div>
  );
}
