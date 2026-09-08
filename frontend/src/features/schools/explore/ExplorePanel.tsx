import { SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ExploreQueryInput, ExploreSchoolCard } from "@/api/schools/explore";
import { useExplore } from "@/api/schools/explore";
import { useAddApplication, useApplications, useArchiveApplication } from "@/api/workspace/hooks";
import type { Round } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { countActiveFilters } from "@/features/schools/explore/explore-filter";
import { rangeDescriptors } from "@/features/schools/explore/explore-config";
import { ExploreFilterBar } from "@/features/schools/explore/ExploreFilterBar";
import { ExploreFilterPanel } from "@/features/schools/explore/ExploreFilterPanel";
import { ExploreResultsHeader } from "@/features/schools/explore/ExploreResultsHeader";
import { ExploreSearchField } from "@/features/schools/explore/ExploreSearchField";
import type { Narrowest } from "@/api/schools/explore";
import type { ExploreFilters, RangeKey } from "@/features/schools/explore/explore-types";
import { SchoolResultCard } from "@/features/schools/explore/SchoolResultCard";
import { SchoolResultCardSkeleton } from "@/features/schools/explore/SchoolResultCardSkeleton";
import { hasScoreBand } from "@/features/schools/explore/VerdictBand";
import { useExploreFilters } from "@/features/schools/explore/useExploreFilters";

/*
 * Explore -- composition and state. Filter/sort/page state lives in the
 * URL (`useExploreFilters`); the catalog itself is a real query
 * (`useExplore`) against `GET /v1/schools/explore`, which owns filtering,
 * sorting, and every exclusion/narrowest/facet-count computation. This
 * file's job is: build the request, join the student's own application
 * list onto the response for the on-list badge, and render.
 */

const BAND_CAPTION_ID = "explore-band-caption";
/** Stagger is capped so a large result set doesn't become a slideshow. */
const STAGGER_CAP = 8;
const STAGGER_STEP_MS = 30;
/** The query text is debounced separately from the URL write (300ms,
 *  `useExploreFilters`): this is what stops every keystroke from firing a
 *  request (plan §5.3: "`q` debounced 250ms client-side"). */
const QUERY_DEBOUNCE_MS = 250;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function ExplorePanel() {
  const applications = useApplications();
  const addApplication = useAddApplication();
  const archiveApplication = useArchiveApplication();
  const {
    clearAll,
    filters,
    loadMore,
    page,
    profile,
    setFilters,
    setProfile,
    setRange,
    setSort,
    sort,
    toggleIncludeMissing,
  } = useExploreFilters();

  const [panelOpen, setPanelOpen] = useState(false);
  const [addingUnitid, setAddingUnitid] = useState<number | null>(null);
  const debouncedQuery = useDebouncedValue(filters.query, QUERY_DEBOUNCE_MS);

  const queryInput: ExploreQueryInput = useMemo(
    () => ({
      act: profile.act,
      admit_max: filters.ranges.admit.max,
      admit_min: filters.ranges.admit.min,
      calendar: filters.calendar,
      campus_setting: filters.campusSetting,
      control: filters.control === "any" ? null : filters.control,
      cost_max: filters.ranges.cost.max,
      cost_min: filters.ranges.cost.min,
      deadline_before: filters.deadlineBefore,
      entrance_difficulty: filters.entranceDifficulty,
      gender: filters.gender === "any" ? null : filters.gender,
      grad_four_max: filters.ranges.gradFour.max,
      grad_four_min: filters.ranges.gradFour.min,
      grad_six_max: filters.ranges.gradSix.max,
      grad_six_min: filters.ranges.gradSix.min,
      hbcu: filters.hbcu,
      home_state: profile.homeState,
      housing_max: filters.ranges.housing.max,
      housing_min: filters.ranges.housing.min,
      hsi: filters.hsi,
      include_missing: filters.includeMissing,
      include_rolling: filters.includeRolling,
      international_max: filters.ranges.international.max,
      international_min: filters.ranges.international.min,
      land_grant: filters.landGrant,
      major: filters.major,
      merit_aid_max: filters.ranges.meritAid.max,
      merit_aid_min: filters.ranges.meritAid.min,
      need_fully_met_max: filters.ranges.needFullyMet.max,
      need_fully_met_min: filters.ranges.needFullyMet.min,
      need_met_max: filters.ranges.needMet.max,
      need_met_min: filters.ranges.needMet.min,
      no_application_fee: filters.noApplicationFee,
      offers_early_action: filters.offersEarlyAction,
      offers_early_decision: filters.offersEarlyDecision,
      q: debouncedQuery || null,
      ratio_max: filters.ranges.ratio.max,
      ratio_min: filters.ranges.ratio.min,
      region: filters.region,
      religious_affiliation: filters.religiousAffiliation,
      retention_max: filters.ranges.retention.max,
      retention_min: filters.ranges.retention.min,
      rolling_admission: filters.rollingAdmission,
      sat_ebrw: profile.satEbrw,
      sat_math: profile.satMath,
      score_fit: filters.scoreFit,
      size_bucket: filters.sizeBucket,
      sort: `${sort.key}:${sort.direction}`,
      state: filters.states,
      test_policy: filters.testPolicy === "any" ? null : filters.testPolicy,
      tribal: filters.tribal,
    }),
    [debouncedQuery, filters, profile, sort],
  );

  const explore = useExplore(queryInput, page);
  const data = explore.data;

  /** Real applications joined onto the catalog rows, so a school the
   *  student has already added shows the on-list treatment. */
  const applicationIdByUnitid = useMemo(() => {
    const map = new Map<number, string>();

    for (const application of applications.data ?? []) {
      map.set(application.school_unitid, application.id);
    }

    return map;
  }, [applications.data]);

  const schools = data?.schools ?? [];
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);
  const showBandCaption = schools.some((school) => hasScoreBand(school.fields, profile));

  /* Stagger the opening view and nothing else. Cards are keyed by unitid,
   * so a card that survives a filter change keeps its DOM node. */
  const shouldStagger = activeCount === 0 && filters.query === "" && page === 1;

  async function handleAdd(school: ExploreSchoolCard) {
    const { deadline_regular, is_rolling, offers_early_decision, offers_early_action } =
      school.fields;
    const round: Round = is_rolling
      ? "Rolling"
      : offers_early_decision
        ? "ED"
        : offers_early_action
          ? "EA"
          : "RD";

    setAddingUnitid(school.unitid);

    try {
      const created = await addApplication.mutateAsync({
        cycle_year: deadline_regular
          ? Number(deadline_regular.slice(0, 4))
          : new Date().getFullYear() + 1,
        deadline: deadline_regular,
        list_type: "Target",
        round,
        unitid: school.unitid,
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

  return (
    <div className="flex flex-col gap-4">
      <ExploreSearchField
        onChange={(query) => setFilters((current) => ({ ...current, query }))}
        value={filters.query}
      />

      <div className="flex flex-col gap-3">
        <ExploreFilterBar
          activeCount={activeCount}
          controlCounts={data?.control_counts ?? { private: 0, private_for_profit: 0, public: 0 }}
          filters={filters}
          onChange={setFilters}
          onRangeChange={setRange}
          onTogglePanel={() => setPanelOpen((open) => !open)}
          panelOpen={panelOpen}
          profile={profile}
          regionOptions={data?.filter_options.region ?? []}
        />
        <ExploreFilterPanel
          activeCount={activeCount}
          campusSettingOptions={data?.filter_options.campus_setting ?? []}
          entranceDifficultyNote={data?.entrance_difficulty_note ?? null}
          filters={filters}
          onChange={setFilters}
          onClearAll={clearAll}
          onOpenChange={setPanelOpen}
          onRangeChange={setRange}
          open={panelOpen}
          religiousAffiliationNote={data?.religious_affiliation_note ?? null}
          religiousAffiliationOptions={data?.filter_options.religious_affiliation ?? []}
        />
      </div>

      {explore.isError ? (
        <ErrorCard
          message="The workspace could not reach the school catalog."
          onRetry={() => void explore.refetch()}
          title="Could not load schools"
        />
      ) : (
        <ExploreResultsHeader
          bandCaption={data?.band_caption ?? ""}
          bandCaptionId={BAND_CAPTION_ID}
          browsableTotal={data?.browsable_total ?? 0}
          catalogTotal={data?.catalog_total ?? 0}
          exclusions={data?.exclusions ?? []}
          factsObservedFrom={data?.facts_observed_from ?? null}
          onIncludeMissing={toggleIncludeMissing}
          onProfileChange={setProfile}
          onSortChange={setSort}
          profile={profile}
          showBandCaption={showBandCaption}
          sort={sort}
          sortedNullTail={data?.sorted_null_tail ?? null}
          total={data?.total ?? 0}
          totalIsCapped={data?.total_is_capped ?? false}
        />
      )}

      {explore.isError ? null : explore.isLoading ? (
        <ResultsGrid>
          {Array.from({ length: 6 }, (_, index) => (
            <SchoolResultCardSkeleton key={index} />
          ))}
        </ResultsGrid>
      ) : data && data.total === 0 ? (
        <NoResults
          activeCount={activeCount}
          narrowest={data.narrowest}
          onClearAll={clearAll}
          onRelax={(key) => setFilters((current) => relaxFilter(current, key))}
        />
      ) : data ? (
        <>
          <ResultsGrid>
            {schools.map((school, index) => (
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
                  bandCaptionId={showBandCaption ? BAND_CAPTION_ID : null}
                  href={`/app/schools/${school.unitid}`}
                  isAdding={addingUnitid === school.unitid}
                  onAdd={handleAdd}
                  onList={applicationIdByUnitid.has(school.unitid)}
                  profile={profile}
                  school={school}
                />
              </div>
            ))}
          </ResultsGrid>

          {schools.length < data.total ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-[var(--ink-muted)] tabular-nums">
                Showing {schools.length} of {data.total_is_capped ? `${data.total}+` : data.total}
              </p>
              <Button onClick={loadMore} variant="outline">
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
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

/** Resets exactly the one filter `narrowest.key` named -- the wire key,
 *  not a client-invented one, so it always exists on `ExploreFilters`. A
 *  range key relaxes to no bound; every other kind relaxes to its own
 *  default. `satMath`/`satEbrw`/`act` name the score-fit predicate, not
 *  the profile scores themselves -- relaxing them turns `scoreFit` back to
 *  "any" rather than clearing the student's own numbers. */
function relaxFilter(filters: ExploreFilters, key: string): ExploreFilters {
  if (rangeDescriptors.some((descriptor) => descriptor.key === key)) {
    return {
      ...filters,
      ranges: { ...filters.ranges, [key as RangeKey]: { max: null, min: null } },
    };
  }

  switch (key) {
    case "q":
      return { ...filters, query: "" };
    case "state":
      return { ...filters, states: [] };
    case "region":
      return { ...filters, region: [] };
    case "sizeBucket":
      return { ...filters, sizeBucket: [] };
    case "control":
      return { ...filters, control: "any" };
    case "testPolicy":
      return { ...filters, testPolicy: "any" };
    case "campusSetting":
      return { ...filters, campusSetting: [] };
    case "religiousAffiliation":
      return { ...filters, religiousAffiliation: null };
    case "gender":
      return { ...filters, gender: "any" };
    case "hbcu":
      return { ...filters, hbcu: false };
    case "hsi":
      return { ...filters, hsi: false };
    case "tribal":
      return { ...filters, tribal: false };
    case "landGrant":
      return { ...filters, landGrant: false };
    case "entranceDifficulty":
      return { ...filters, entranceDifficulty: null };
    case "calendar":
      return { ...filters, calendar: null };
    case "major":
      return { ...filters, major: null };
    case "noApplicationFee":
      return { ...filters, noApplicationFee: false };
    case "offersEarlyDecision":
      return { ...filters, offersEarlyDecision: false };
    case "offersEarlyAction":
      return { ...filters, offersEarlyAction: false };
    case "rollingAdmission":
      return { ...filters, rollingAdmission: false };
    case "deadlineBefore":
      return { ...filters, deadlineBefore: null };
    case "satMath":
    case "satEbrw":
    case "act":
      return { ...filters, scoreFit: "any" };
    default:
      return filters;
  }
}

/** Names the culprit and hands over the fix. A generic "no results found"
 *  is a dead end, and the student has no way to know which of a dozen
 *  active filters did the damage. */
function NoResults({
  activeCount,
  narrowest,
  onClearAll,
  onRelax,
}: {
  activeCount: number;
  narrowest: Narrowest | null;
  onClearAll: () => void;
  onRelax: (key: string) => void;
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
            ? `${narrowest.label} is the narrowest filter — ${narrowest.remaining_without_it} schools match everything else.`
            : "Nothing in the catalog matches this combination."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {narrowest ? (
          <Button onClick={() => onRelax(narrowest.key)}>Relax {narrowest.label.toLowerCase()}</Button>
        ) : null}
        <Button disabled={activeCount === 0} onClick={onClearAll} variant="outline">
          Clear all filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}
