/**
 * `/app/sat` — the dashboard (plan §5.1, §5.2, §5.3; ui-spec §3). Owns the
 * filter-selection state — a `useState` mirrored to `localStorage`, distinct
 * from the launched filter that lives in the practice route's URL
 * (plan §5.3's "kept apart by lifetime" table).
 */
import { ChartColumn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useNavigation, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/workspace/PageContainer";
import { cn } from "@/lib/utils";

import { useSatCounts, useSatStats, useSatTaxonomy } from "@/api/sat/hooks";
import type { SatSolvedStatus } from "@/api/sat/types";
import { SAT_DASHBOARD_COPY, SAT_GREETINGS } from "@/features/sat/sat-copy";
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
import { isSatAnalyticsTab, SatAnalytics, type SatAnalyticsTab } from "@/features/sat/SatAnalytics";
import { SatFilterRail } from "@/features/sat/SatFilterRail";
import { SatTopicTree } from "@/features/sat/SatTopicTree";

function toggledSet<T>(current: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(current);
  if (next.has(item)) {
    next.delete(item);
  } else {
    next.add(item);
  }
  return next;
}

function withMembership<T>(
  current: ReadonlySet<T>,
  items: readonly T[],
  present: boolean,
): Set<T> {
  const next = new Set(current);
  for (const item of items) {
    if (present) {
      next.add(item);
    } else {
      next.delete(item);
    }
  }
  return next;
}

/** F20: never encode the full taxonomy/band list to say "all". */
function collapseIfFull<T>(selected: ReadonlySet<T>, full: readonly T[]): T[] {
  return selected.size >= full.length ? [] : Array.from(selected);
}

const ANALYTICS_PARAM = "analytics";

export function SatDashboard() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: taxonomy, isError: taxonomyError } = useSatTaxonomy();

  const [greeting] = useState(
    () => SAT_GREETINGS[Math.floor(Math.random() * SAT_GREETINGS.length)],
  );
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

  const countsQuery = useSatCounts({
    bands: filterState?.bands ?? [],
    status,
    excludeBluebook,
  });

  const statsQuery = useSatStats(todayKey);

  const isStarting =
    navigation.state === "loading" &&
    (navigation.location?.pathname.startsWith("/app/sat/practice") ?? false);

  const startDisabledReason =
    selectedSkills && selectedSkills.size === 0
      ? SAT_DASHBOARD_COPY.startDisabledNoSkill
      : selectedBands && selectedBands.size === 0
        ? SAT_DASHBOARD_COPY.startDisabledNoBand
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
          params.set(ANALYTICS_PARAM, params.get(ANALYTICS_PARAM) ?? "overview");
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

  return (
    <PageContainer
      actions={
        <Button
          loading={statsQuery.isLoading}
          onClick={() => handleAnalyticsOpenChange(true)}
          variant="outline"
        >
          <ChartColumn />
          {SAT_DASHBOARD_COPY.analyticsAction}
        </Button>
      }
      subtitle={`${greeting.main} — ${greeting.sub}`}
      title={SAT_DASHBOARD_COPY.title}
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
        <div className="@container/sat-dash">
          <div
            className={cn(
              "flex flex-col gap-6",
              "@[640px]/sat-dash:grid @[640px]/sat-dash:grid-cols-2",
              "@[640px]/sat-dash:[grid-template-areas:'filters_activity'_'topics_topics']",
              "@[936px]/sat-dash:grid-cols-[1fr_272px]",
              "@[936px]/sat-dash:[grid-template-areas:'topics_filters'_'topics_activity']",
              "@[1496px]/sat-dash:grid-cols-[252px_1fr_252px]",
              "@[1496px]/sat-dash:[grid-template-areas:'activity_topics_filters']",
            )}
          >
            <div className="min-w-0 [grid-area:filters]">
              {topicsAndFiltersReady && selectedBands ? (
                <SatFilterRail
                  bandTiers={bandTiers}
                  excludeBluebook={excludeBluebook}
                  isStarting={isStarting}
                  onExcludeBluebookChange={setExcludeBluebook}
                  onStart={handleStart}
                  onStatusChange={setStatus}
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
                  selectedBands={selectedBands}
                  startDisabledReason={startDisabledReason}
                  status={status}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
            </div>

            <div className="min-w-0 [grid-area:topics]">
              <SatTopicTree
                counts={countsQuery.data}
                isInitialLoading={
                  !topicsAndFiltersReady ||
                  (countsQuery.isLoading && !countsQuery.data)
                }
                isRefetching={
                  countsQuery.isFetching && Boolean(countsQuery.data)
                }
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

            <div className="min-w-0 [grid-area:activity]">
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
