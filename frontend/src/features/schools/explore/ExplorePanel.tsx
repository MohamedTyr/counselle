import { SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAddApplication, useApplications } from "@/api/workspace/hooks";
import { useArchiveApplication } from "@/api/workspace/hooks";
import type { ListType, Round } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { classifyFit } from "@/features/schools/explore/classify-fit";
import {
  countActiveFilters,
  relaxFilter,
  runExplore,
} from "@/features/schools/explore/explore-filter";
import {
  exploreFixtures,
  exploreStates,
} from "@/features/schools/explore/explore-fixtures";
import type {
  ExploreSchool,
  NarrowestFilter,
} from "@/features/schools/explore/explore-types";
import { ExploreFilterBar } from "@/features/schools/explore/ExploreFilterBar";
import { ExploreFilterPanel } from "@/features/schools/explore/ExploreFilterPanel";
import { ExploreResultsHeader } from "@/features/schools/explore/ExploreResultsHeader";
import { ExploreSearchField } from "@/features/schools/explore/ExploreSearchField";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";
import { SchoolResultCardSkeleton } from "@/features/schools/explore/SchoolResultCardSkeleton";
import { useExploreFilters } from "@/features/schools/explore/useExploreFilters";

/*
 * Explore — composition and state.
 *
 * Data is fixtures in this pass (see explore-fixtures.ts, which is loud
 * about it). The seam for the real query is the `catalog` memo below: it
 * takes the raw rows and joins the user's real applications onto them, so
 * swapping fixtures for a fetch is a one-line change and everything
 * downstream already handles nulls, exclusions, and the on-list state.
 */

const PAGE_SIZE = 8;
/** Stagger is capped so a large result set doesn't become a slideshow. */
const STAGGER_CAP = 8;
const STAGGER_STEP_MS = 30;

function earliestRound(school: ExploreSchool) {
  const dated = school.rounds
    .filter((round) => round.deadline !== null)
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));

  return dated[0] ?? school.rounds[0] ?? null;
}

export function ExplorePanel() {
  const applications = useApplications();
  const addApplication = useAddApplication();
  const archiveApplication = useArchiveApplication();
  const {
    clearAll,
    filters,
    profile,
    setFilters,
    setProfile,
    setRange,
    setSort,
    sort,
    toggleIncludeMissing,
  } = useExploreFilters();

  const [panelOpen, setPanelOpen] = useState(false);
  const [addingUnitid, setAddingUnitid] = useState<string | null>(null);

  /** Real applications joined onto the catalog rows: a school the student
   *  has already added shows the on-list treatment and gets a real link to
   *  its workspace page. Explore never invents a link to a page that isn't
   *  there. */
  const applicationIdByUnitid = useMemo(() => {
    const map = new Map<number, string>();

    for (const application of applications.data ?? []) {
      map.set(application.school_unitid, application.id);
    }

    return map;
  }, [applications.data]);

  const catalog = useMemo(
    () =>
      exploreFixtures.map((school) => ({
        ...school,
        onList:
          school.onList || applicationIdByUnitid.has(Number(school.unitid)),
      })),
    [applicationIdByUnitid],
  );

  const result = useMemo(
    () => runExplore(catalog, filters, profile, sort),
    [catalog, filters, profile, sort],
  );
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  /* Pagination is derived, not synced. Holding the result set it belongs to
   * means a filter change resets the page during the same render that
   * produced the new results — no effect, no cascading second render, no
   * frame where 24 stale cards are still on screen. */
  const [pagination, setPagination] = useState({
    count: PAGE_SIZE,
    of: result,
  });
  const visibleCount = pagination.of === result ? pagination.count : PAGE_SIZE;

  /* Stagger the opening view and nothing else. Cards are keyed by unitid,
   * so a card that survives a filter change keeps its DOM node and never
   * re-animates; this only has to stop a *filtered* set from cascading in,
   * which is the reflex that turns a fast filter into a slideshow. */
  const shouldStagger = activeCount === 0 && filters.query === "";

  async function handleAdd(school: ExploreSchool) {
    const round = earliestRound(school);
    const verdict = classifyFit(school, profile);
    const deadline = round?.deadline ?? null;

    setAddingUnitid(school.unitid);

    try {
      const created = await addApplication.mutateAsync({
        cycle_year: deadline
          ? Number(deadline.slice(0, 4))
          : new Date().getFullYear() + 1,
        deadline,
        list_type:
          verdict.category === "Unknown"
            ? "Target"
            : (verdict.category as ListType),
        round: (round?.code ?? "RD") as Round,
        unitid: Number(school.unitid),
      });

      toast.success(`${created.application.school_name} added to your list`, {
        action: {
          label: "Undo",
          onClick: () => {
            void archiveApplication.mutateAsync(created.application.id);
          },
        },
      });
    } catch {
      // The workspace mutation hook owns rollback and the error toast.
    } finally {
      setAddingUnitid(null);
    }
  }

  const visible = result.schools.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-4">
      <ExploreSearchField
        onChange={(query) => setFilters((current) => ({ ...current, query }))}
        value={filters.query}
      />

      <div className="flex flex-col gap-3">
        <ExploreFilterBar
          activeCount={activeCount}
          controlCounts={result.controlCounts}
          filters={filters}
          onChange={setFilters}
          onRangeChange={setRange}
          onTogglePanel={() => setPanelOpen((open) => !open)}
          panelOpen={panelOpen}
          profile={profile}
          states={exploreStates}
        />
        <ExploreFilterPanel
          activeCount={activeCount}
          filters={filters}
          onChange={setFilters}
          onClearAll={clearAll}
          onOpenChange={setPanelOpen}
          onRangeChange={setRange}
          open={panelOpen}
        />
      </div>

      <ExploreResultsHeader
        count={result.schools.length}
        exclusions={result.exclusions}
        onIncludeMissing={toggleIncludeMissing}
        onProfileChange={setProfile}
        onSortChange={setSort}
        profile={profile}
        sort={sort}
        states={exploreStates}
      />

      {applications.isLoading ? (
        <ResultsGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <SchoolResultCardSkeleton key={index} />
          ))}
        </ResultsGrid>
      ) : result.schools.length === 0 ? (
        <NoResults
          activeCount={activeCount}
          narrowest={result.narrowest}
          onClearAll={clearAll}
          onRelax={(key) => setFilters((current) => relaxFilter(current, key))}
        />
      ) : (
        <>
          <ResultsGrid>
            {visible.map((school, index) => {
              const applicationId = applicationIdByUnitid.get(
                Number(school.unitid),
              );

              return (
                // `grid` so the stagger wrapper passes the row's stretch
                // through to the card (otherwise the card collapses to
                // content height and the row goes ragged), and `min-w-0`
                // because the track's minimum is an explicit 340px rather
                // than `auto` — without it a grid item wider than its track
                // overflows and paints over its neighbour.
                <div
                  className="grid min-w-0 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-150 motion-reduce:animate-none"
                  key={school.unitid}
                  style={{
                    animationDelay: shouldStagger
                      ? `${Math.min(index, STAGGER_CAP) * STAGGER_STEP_MS}ms`
                      : undefined,
                  }}
                >
                  <SchoolResultCard
                    href={
                      applicationId ? `/app/schools/${applicationId}` : null
                    }
                    isAdding={addingUnitid === school.unitid}
                    onAdd={handleAdd}
                    profile={profile}
                    school={school}
                  />
                </div>
              );
            })}
          </ResultsGrid>

          {visibleCount < result.schools.length ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-[var(--ink-muted)] tabular-nums">
                Showing {visible.length} of {result.schools.length}
              </p>
              <Button
                onClick={() =>
                  setPagination({
                    count: visibleCount + PAGE_SIZE,
                    of: result,
                  })
                }
                variant="outline"
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ResultsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-stretch gap-3.5">
      {children}
    </div>
  );
}

/** Names the culprit and hands over the fix. A generic "no results found"
 *  is a dead end, and the student has no way to know which of nine active
 *  filters did the damage. */
function NoResults({
  activeCount,
  narrowest,
  onClearAll,
  onRelax,
}: {
  activeCount: number;
  narrowest: NarrowestFilter | null;
  onClearAll: () => void;
  onRelax: (key: NarrowestFilter["key"]) => void;
}) {
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>No schools match</EmptyTitle>
        <EmptyDescription>
          {narrowest
            ? `${narrowest.label} is the narrowest filter — ${narrowest.remainingWithoutIt} schools match everything else.`
            : "Nothing in the catalog matches this combination."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {narrowest ? (
          <Button onClick={() => onRelax(narrowest.key)}>
            Relax {narrowest.label.toLowerCase()}
          </Button>
        ) : null}
        <Button
          disabled={activeCount === 0}
          onClick={onClearAll}
          variant="outline"
        >
          Clear all filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}
