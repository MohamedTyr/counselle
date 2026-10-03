/**
 * `/app/sat` — the dashboard (plan §5.1, §5.2, §5.3; ui-spec §3). Owns the
 * filter-selection state — a `useState` mirrored to `localStorage`, distinct
 * from the launched filter that lives in the practice route's URL
 * (plan §5.3's "kept apart by lifetime" table).
 */
import { ChartColumn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useNavigation, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/workspace/PageContainer";

import { useSatCounts, useSatStats, useSatTaxonomy } from "@/api/sat/hooks";
import type {
  SatCounts,
  SatSolvedStatus,
  SatStatsResponse,
} from "@/api/sat/types";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import {
  filterStateToSearchParams,
  loadSavedFilterState,
  saveFilterState,
  type FilterState,
} from "@/features/sat/sat-filters";
import {
  SatActivityRail,
  toLocalDateKey,
} from "@/features/sat/SatActivityRail";
import {
  isSatAnalyticsTab,
  SatAnalytics,
  type SatAnalyticsTab,
} from "@/features/sat/SatAnalytics";
import { formatStreak } from "@/features/sat/sat-format";
import {
  SatSessionSheet,
  SatStartBar,
  SatStatusToolbar,
} from "@/features/sat/SatFilterRail";
import {
  collapseIfFull,
  toggledSet,
  withMembership,
} from "@/features/sat/sat-dashboard-selection";
import {
  SatTopicTree,
  SatTopicTreeSkeleton,
} from "@/features/sat/SatTopicTree";

const ANALYTICS_PARAM = "analytics";

function sumCounts(counts: SatCounts | undefined): number | undefined {
  return counts
    ? Object.values(counts).reduce((sum, count) => sum + count, 0)
    : undefined;
}

/** The header's one stable line: where the student stands, not a greeting. */
function buildStatLine(
  stats: SatStatsResponse | undefined,
): string | undefined {
  if (!stats || stats.totalAttemptsCount === 0) return undefined;
  const parts = [
    `${stats.today.ebrwSolved + stats.today.mathSolved} solved today`,
  ];
  if (stats.currentStreakDays > 0)
    parts.push(formatStreak(stats.currentStreakDays));
  parts.push(`${Math.round(stats.firstTryOverallAccuracyPct)}% first try`);
  return parts.join(" · ");
}

export function SatDashboard() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: taxonomy, isError: taxonomyError } = useSatTaxonomy();

  const [today] = useState(() => new Date());
  const todayKey = useMemo(() => toLocalDateKey(today), [today]);

  const modules = useMemo(
    () =>
      taxonomy ? [...taxonomy.modules].sort((a, b) => a.order - b.order) : [],
    [taxonomy],
  );
  const allSkillCodes = useMemo(
    () =>
      modules.flatMap((moduleDef) =>
        moduleDef.domains.flatMap((domain) => domain.skills.map((s) => s.code)),
      ),
    [modules],
  );
  const bandTiers = taxonomy?.band_tiers ?? [];
  const allBands = useMemo(
    () => bandTiers.flatMap((tier) => tier.bands),
    [bandTiers],
  );

  const [selectedSkills, setSelectedSkills] = useState<Set<string> | null>(
    null,
  );
  const [selectedBands, setSelectedBands] = useState<Set<number> | null>(null);
  const [status, setStatus] = useState<SatSolvedStatus>("all");
  const [excludeBluebook, setExcludeBluebook] = useState(true);
  const [hasLoadedSaved, setHasLoadedSaved] = useState(false);

  // F20: the saved selection is validated against the taxonomy on load.
  useEffect(() => {
    if (!taxonomy || hasLoadedSaved) {
      return;
    }
    const saved = loadSavedFilterState(allSkillCodes);
    setSelectedSkills(
      new Set(saved.skills.length > 0 ? saved.skills : allSkillCodes),
    );
    setSelectedBands(new Set(saved.bands.length > 0 ? saved.bands : allBands));
    setStatus(saved.status);
    setExcludeBluebook(saved.excludeBluebook);
    setHasLoadedSaved(true);
    // Only ever runs once, the first time taxonomy is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomy, hasLoadedSaved]);

  // Sets are rebuilt (new identity) on every toggle, even when the resulting
  // membership is unchanged — so a sorted, joined key is what actually
  // identifies "did the selection change" for memoization purposes.
  const selectedSkillsKey = selectedSkills
    ? Array.from(selectedSkills).sort().join(",")
    : null;
  const selectedBandsKey = selectedBands
    ? Array.from(selectedBands)
        .sort((a, b) => a - b)
        .join(",")
    : null;

  const filterState: FilterState | null = useMemo(
    () =>
      selectedSkills && selectedBands
        ? {
            skills: collapseIfFull(selectedSkills, allSkillCodes),
            bands: collapseIfFull(selectedBands, allBands),
            status,
            excludeBluebook,
          }
        : null,
    // selectedSkills/selectedBands are read through their stable string keys
    // below so the memo only recomputes when membership actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedSkillsKey,
      selectedBandsKey,
      status,
      excludeBluebook,
      allSkillCodes,
      allBands,
    ],
  );

  // F10: persisted after every change, once the saved selection has loaded.
  useEffect(() => {
    if (!hasLoadedSaved || !filterState) {
      return;
    }
    saveFilterState(filterState);
  }, [hasLoadedSaved, filterState]);

  // One /counts query per status tab so each tab can show its own total; the
  // active one also feeds the topic rows, and the others stay cached for when
  // the student switches.
  const countsFilter = { bands: filterState?.bands ?? [], excludeBluebook };
  const countsByStatus = {
    all: useSatCounts({ ...countsFilter, status: "all" }),
    unsolved: useSatCounts({ ...countsFilter, status: "unsolved" }),
    incorrect: useSatCounts({ ...countsFilter, status: "incorrect" }),
    bookmarked: useSatCounts({ ...countsFilter, status: "bookmarked" }),
  };
  const countsQuery = countsByStatus[status];
  const statusTotals = {
    all: sumCounts(countsByStatus.all.data),
    unsolved: sumCounts(countsByStatus.unsolved.data),
    incorrect: sumCounts(countsByStatus.incorrect.data),
    bookmarked: sumCounts(countsByStatus.bookmarked.data),
  };

  const statsQuery = useSatStats(todayKey);

  const isStarting =
    navigation.state === "loading" &&
    (navigation.location?.pathname.startsWith("/app/sat/practice") ?? false);

  // What the session would draw from: the selected skills' questions under the
  // current status / difficulty / Bluebook filters. `null` until counts load.
  const questionCount =
    selectedSkills && countsQuery.data
      ? Array.from(selectedSkills).reduce(
          (sum, code) => sum + (countsQuery.data?.[code] ?? 0),
          0,
        )
      : null;

  const startDisabledReason =
    selectedSkills && selectedSkills.size === 0
      ? SAT_DASHBOARD_COPY.startDisabledNoSkill
      : selectedBands && selectedBands.size === 0
        ? SAT_DASHBOARD_COPY.startDisabledNoBand
        : questionCount === 0
          ? SAT_DASHBOARD_COPY.startDisabledNoMatch
          : null;

  function handleStart() {
    if (!filterState || startDisabledReason) {
      return;
    }
    const params = filterStateToSearchParams(filterState);
    const query = params.toString();
    navigate(`/app/sat/practice${query ? `?${query}` : ""}`);
  }

  // A19: the open tab lives in the URL while the dialog is open; absence
  // of the param means closed.
  const analyticsParam = searchParams.get(ANALYTICS_PARAM);
  const analyticsOpen = isSatAnalyticsTab(analyticsParam);
  const analyticsTab: SatAnalyticsTab = isSatAnalyticsTab(analyticsParam)
    ? analyticsParam
    : "overview";

  // `SatAnalytics` runs its own `/stats` and `/counts` queries — don't
  // mount it (and fire those) until the panel is actually opened once.
  // Stays mounted after that first open so the shell's own close
  // animation still plays on later closes.
  const [analyticsMounted, setAnalyticsMounted] = useState(analyticsOpen);
  useEffect(() => {
    if (analyticsOpen) setAnalyticsMounted(true);
  }, [analyticsOpen]);

  function handleAnalyticsOpenChange(next: boolean) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) {
          params.set(
            ANALYTICS_PARAM,
            params.get(ANALYTICS_PARAM) ?? "overview",
          );
        } else {
          params.delete(ANALYTICS_PARAM);
        }
        return params;
      },
      { replace: true },
    );
  }

  function handleAnalyticsTabChange(next: SatAnalyticsTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(ANALYTICS_PARAM, next);
        return params;
      },
      { replace: true },
    );
  }

  // A6: a drill launches the dashboard's *current* bands/status/Bluebook —
  // never the saved topic selection, which this never touches.
  function handleDrill(skillCode: string) {
    const drillFilter: FilterState = {
      bands: filterState?.bands ?? [],
      excludeBluebook,
      skills: [skillCode],
      status,
    };
    const params = filterStateToSearchParams(drillFilter);
    const query = params.toString();
    navigate(`/app/sat/practice${query ? `?${query}` : ""}`);
    handleAnalyticsOpenChange(false);
  }

  const topicsAndFiltersReady = Boolean(
    taxonomy && selectedSkills && selectedBands,
  );

  // The floating start bar only appears once the session sheet has scrolled
  // out of view; until then the sheet is the one Start.
  const sessionRef = useRef<HTMLDivElement>(null);
  const [sessionInView, setSessionInView] = useState(true);
  useEffect(() => {
    const node = sessionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setSessionInView(entry.isIntersecting),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [topicsAndFiltersReady, taxonomyError]);

  const isRefetching = countsQuery.isFetching && Boolean(countsQuery.data);
  const selectedSkillCount = selectedSkills?.size ?? 0;

  return (
    <PageContainer
      actions={
        <Button
          className="self-start transition-[background-color,border-color,box-shadow,color,scale] active:scale-[0.97] motion-reduce:transition-none sm:self-auto"
          loading={statsQuery.isLoading}
          onClick={() => handleAnalyticsOpenChange(true)}
          variant="outline"
        >
          <ChartColumn />
          {SAT_DASHBOARD_COPY.analyticsAction}
        </Button>
      }
      subtitle={buildStatLine(statsQuery.data)}
      title={SAT_DASHBOARD_COPY.title}
      width="panel"
    >
      {taxonomyError ? (
        <ErrorCard
          message={SAT_DASHBOARD_COPY.countsError.description}
          onRetry={() => {
            window.location.reload();
          }}
          retryLabel={SAT_DASHBOARD_COPY.countsError.retry}
          title={SAT_DASHBOARD_COPY.countsError.title}
        />
      ) : (
        <div className="@container/sat-dash flex flex-col gap-6">
          <SatStatusToolbar
            excludeBluebook={excludeBluebook}
            onExcludeBluebookChange={setExcludeBluebook}
            onStatusChange={setStatus}
            status={status}
            statusTotals={statusTotals}
          />

          {/* Below 880 cw one column — session, topics, activity — and the
           * rail's wrapper melts away (`contents`) so its two sheets can be
           * ordered around the topics. From 880 it is a real column, kept in
           * view while the long topic list scrolls past. */}
          <div className="flex flex-col gap-8 @[880px]/sat-dash:grid @[880px]/sat-dash:grid-cols-[minmax(0,1fr)_320px] @[880px]/sat-dash:items-start">
            <div className="order-2 min-w-0 @[880px]/sat-dash:order-none">
              {topicsAndFiltersReady ? (
                <SatTopicTree
                  counts={countsQuery.data}
                  isInitialLoading={countsQuery.isLoading && !countsQuery.data}
                  isRefetching={isRefetching}
                  modules={modules}
                  onModuleSelectAll={(codes, next) =>
                    setSelectedSkills((prev) =>
                      withMembership(prev ?? new Set(), codes, next),
                    )
                  }
                  onToggleDomain={(codes, next) =>
                    setSelectedSkills((prev) =>
                      withMembership(prev ?? new Set(), codes, next),
                    )
                  }
                  onToggleSkill={(code) =>
                    setSelectedSkills((prev) =>
                      toggledSet(prev ?? new Set(), code),
                    )
                  }
                  selectedSkills={selectedSkills ?? new Set()}
                />
              ) : (
                <SatTopicTreeSkeleton />
              )}
              {countsQuery.isError && (
                <div className="mt-4">
                  <ErrorCard
                    message={SAT_DASHBOARD_COPY.countsError.description}
                    onRetry={() => countsQuery.refetch()}
                    retryLabel={SAT_DASHBOARD_COPY.countsError.retry}
                    title={SAT_DASHBOARD_COPY.countsError.title}
                  />
                </div>
              )}
            </div>

            <div className="contents @[880px]/sat-dash:order-none @[880px]/sat-dash:flex @[880px]/sat-dash:flex-col @[880px]/sat-dash:gap-8 [@media(min-height:780px)]:@[880px]/sat-dash:sticky [@media(min-height:780px)]:@[880px]/sat-dash:top-6">
              <div
                className="order-1 min-w-0 @[880px]/sat-dash:order-none"
                ref={sessionRef}
              >
                {topicsAndFiltersReady && selectedBands ? (
                  <SatSessionSheet
                    bandTiers={bandTiers}
                    isRefetching={isRefetching}
                    isStarting={isStarting}
                    onStart={handleStart}
                    onToggleBand={(band) =>
                      setSelectedBands((prev) =>
                        toggledSet(prev ?? new Set(), band),
                      )
                    }
                    onToggleTier={(bands, next) =>
                      setSelectedBands((prev) =>
                        withMembership(prev ?? new Set(), bands, next),
                      )
                    }
                    questionCount={questionCount}
                    selectedBands={selectedBands}
                    selectedSkillCount={selectedSkillCount}
                    startDisabledReason={startDisabledReason}
                  />
                ) : (
                  <div aria-busy="true" className="flex flex-col gap-2">
                    <Skeleton className="h-7 w-20" />
                    <Skeleton className="h-64 w-full rounded-xl" />
                  </div>
                )}
              </div>
              <div className="order-3 min-w-0 @[880px]/sat-dash:order-none">
                <SatActivityRail
                  isError={statsQuery.isError}
                  isLoading={statsQuery.isLoading}
                  onRetry={() => statsQuery.refetch()}
                  stats={statsQuery.data}
                  today={today}
                />
              </div>
            </div>
          </div>

          {topicsAndFiltersReady && selectedBands && (
            <SatStartBar
              isStarting={isStarting}
              onStart={handleStart}
              questionCount={questionCount}
              selectedSkillCount={selectedSkillCount}
              startDisabledReason={startDisabledReason}
              visible={!sessionInView}
            />
          )}
        </div>
      )}
      {analyticsMounted && (
        <SatAnalytics
          onDrill={handleDrill}
          onOpenChange={handleAnalyticsOpenChange}
          onTabChange={handleAnalyticsTabChange}
          open={analyticsOpen}
          tab={analyticsTab}
          todayKey={todayKey}
        />
      )}
    </PageContainer>
  );
}
