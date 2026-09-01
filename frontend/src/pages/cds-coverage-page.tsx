import { FileStack, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { isTransportError } from "@/api/http/errors";
import { useCoverage } from "@/api/cds-admin/hooks";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/workspace/PageHeader";
import { CdsErrorCard } from "@/features/cds-admin/CdsErrorCard";
import { CdsUnavailable } from "@/features/cds-admin/CdsUnavailable";
import { CoverageCounters } from "@/features/cds-admin/coverage/CoverageCounters";
import { CoverageFilters } from "@/features/cds-admin/coverage/CoverageFilters";
import { CoverageGrid } from "@/features/cds-admin/coverage/CoverageGrid";
import { CoverageSkeleton } from "@/features/cds-admin/coverage/CoverageSkeleton";
import {
  coverageFiltersFromUrlState,
  coverageUrlStateToParams,
  hasActiveCoverageFilters,
  isCoverageFindModeIdle,
  parseCoverageUrlState,
  type CoverageUrlState,
} from "@/features/cds-admin/coverage/coverage-params";

/**
 * Coverage — the CDS admin home screen (`/app/admin/cds`, DESIGN.md §3).
 * Schools × academic years, answering "what do we have?" in one glance.
 *
 * The central problem this screen solves: ~2,746 schools exist and a
 * handful have any CDS activity, so the default ("Tracked") scope loads
 * only schools with >=1 `cds_school_years` row (a handful of rows, no
 * scrolling — not the same thing as "has a document"; a tracked school can
 * still show "none" in a given year), and "All schools" is a find mode —
 * with an empty query the API returns zero rows and the real school count
 * (enforced server-side in `coverage_grid`'s idle branch), not a row dump
 * (see `coverage-params.ts`).
 */
export function CdsCoveragePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const state = useMemo(
    () => parseCoverageUrlState(searchParams),
    [searchParams],
  );
  const filters = useMemo(() => coverageFiltersFromUrlState(state), [state]);
  const coverage = useCoverage(filters);

  function updateState(patch: Partial<CoverageUrlState>) {
    setSearchParams(coverageUrlStateToParams({ ...state, ...patch }), {
      replace: true,
    });
  }

  const isUnavailable =
    isTransportError(coverage.error) && coverage.error.status === 503;
  const activeFilters = hasActiveCoverageFilters(state);
  const findModeIdle = isCoverageFindModeIdle(state);

  // A with_documents→all scope change swaps `CoverageFilters` out for
  // `CoverageSkeleton` and back whenever the new scope is a fresh query-key
  // (cache miss) — this page component itself never unmounts across that
  // swap, so a token counted here (not inside CoverageFilters, which does
  // unmount/remount across it) survives to tell the remounted filter bar a
  // real transition happened and it should focus the search box. Computed
  // during render, not an effect, so it's ready before the first paint of
  // whichever branch renders below.
  const prevScopeRef = useRef(state.scope);
  const focusSearchTokenRef = useRef(0);
  if (prevScopeRef.current !== "all" && state.scope === "all") {
    focusSearchTokenRef.current += 1;
  }
  prevScopeRef.current = state.scope;
  const showNoDocumentsYet =
    coverage.data !== undefined &&
    coverage.data.rows.length === 0 &&
    !activeFilters &&
    state.scope === "with_documents";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 md:px-10">
      <PageHeader
        actions={
          <Button render={<Link to="/app/admin/cds/upload" />} variant="outline">
            <Upload data-icon="inline-start" />
            Batch upload
          </Button>
        }
        title="CDS Coverage"
      />

      {coverage.isLoading ? (
        <CoverageSkeleton />
      ) : coverage.isError ? (
        isUnavailable ? (
          <div className="mt-4 min-h-0 flex-1">
            <CdsUnavailable />
          </div>
        ) : (
          <div className="mt-4">
            <CdsErrorCard
              message="The coverage grid could not reach the server."
              onRetry={() => void coverage.refetch()}
              title="Could not load coverage"
            />
          </div>
        )
      ) : coverage.data === undefined ? null : showNoDocumentsYet ? (
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileStack />
            </EmptyMedia>
            <EmptyTitle>No CDS documents yet</EmptyTitle>
            <EmptyDescription>
              Upload a batch of PDFs to get started.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/app/admin/cds/upload" />}>
              <Upload data-icon="inline-start" />
              Batch upload
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {/* find-mode-idle always renders zero rows (coverage_grid's idle
              branch), but `counters` still describes the Tracked activity
              set the backend groups from before the idle short-circuit —
              a school/edition count for a scope that isn't on screen. There
              is no honest per-scope number to show instead (the idle branch
              never counts the full catalog), so the line is omitted rather
              than showing a count that describes something else (root
              DESIGN.md §1.1: never a plausible-looking value that isn't
              real). */}
          {!findModeIdle && (
            <CoverageCounters
              className="mt-4"
              counters={coverage.data.counters}
              failedActive={state.failed}
              needsReviewActive={state.needsReview}
              onToggleFailed={() => updateState({ failed: !state.failed })}
              onToggleNeedsReview={() =>
                updateState({ needsReview: !state.needsReview })
              }
            />
          )}
          <CoverageFilters
            className="mt-3"
            focusSearchToken={focusSearchTokenRef.current}
            onChange={updateState}
            state={state}
            years={coverage.data.years}
          />
          <div className="mt-5 min-h-0 flex-1 pb-6">
            <CoverageGrid
              emptyMessage={
                findModeIdle
                  ? `Search ${coverage.data.total.toLocaleString()} schools by name to add a document.`
                  : "No schools match these filters."
              }
              onOpenDocument={(documentId) =>
                void navigate(`/app/admin/cds/documents/${documentId}`)
              }
              onOpenUpload={(schoolId, year) =>
                void navigate(
                  `/app/admin/cds/upload?school_id=${schoolId}&year=${year}`,
                )
              }
              rows={coverage.data.rows}
              years={coverage.data.years}
            />
          </div>
        </>
      )}
    </section>
  );
}
