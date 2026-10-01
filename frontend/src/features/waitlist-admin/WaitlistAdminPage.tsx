import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type React from "react";
import { LogInIcon, SearchXIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/workspace/PageContainer";
import type { WaitlistRow } from "@/features/landing/waitlist/contract";
import { formatRelativeTime } from "@/lib/time";
import { SessionEndedError, useWaitlist, type WaitlistData } from "./api";
import { Composition } from "./Composition";
import { DeleteSignupDialog } from "./DeleteSignupDialog";
import {
  activeFilters,
  applyFilters,
  dailyBuckets,
  facetCounts,
  filterLabel,
  narrowest,
  plural,
  sortRows,
  summary,
  type FilterKey,
} from "./derive";
import { HeaderActions } from "./HeaderActions";
import { Momentum } from "./Momentum";
import { useView } from "./params";
import { useLastSeen } from "./useLastSeen";
import { WaitlistTable } from "./WaitlistTable";
import { WaitlistToolbar } from "./WaitlistToolbar";

const CLOCK_MS = 30_000;

/** Re-renders every 30s so "Updated 2 min ago" and "today" stay true. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function PageSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading the waitlist</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-30 w-full" />
      </div>
      <div className="grid gap-6 rounded-2xl border p-4 md:grid-cols-3">
        {[0, 1, 2].map((column) => (
          <div className="flex flex-col gap-3" key={column}>
            <Skeleton className="h-4 w-20" />
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton className="h-5 w-full" key={row} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full max-w-md" />
        {Array.from({ length: 8 }, (_, row) => (
          <Skeleton className="h-9 w-full" key={row} />
        ))}
      </div>
    </div>
  );
}

function SessionEnded() {
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LogInIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Your session ended</EmptyTitle>
        <EmptyDescription>Sign in again to see the waitlist.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* A full reload, so Access can redirect to its login. */}
        <Button onClick={() => window.location.reload()}>Sign in again</Button>
      </EmptyContent>
    </Empty>
  );
}

function NoSignups() {
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No signups yet</EmptyTitle>
        <EmptyDescription>
          Signups from acceptra.ai appear here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoMatches({
  rows,
  view,
  onClearAll,
  onClearFilter,
}: {
  rows: WaitlistRow[];
  view: ReturnType<typeof useView>;
  onClearAll: () => void;
  onClearFilter: (key: FilterKey) => void;
}) {
  const found = narrowest(rows, view.filters);
  // With several filters that clash, dropping any one can still match
  // nothing; then the only useful offer is to clear them all.
  const relax = found && found.count > 0 ? found : null;
  const label = relax ? filterLabel(view.filters, relax.key) : null;
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No signups match</EmptyTitle>
        {relax && label ? (
          <EmptyDescription>
            {label} is the narrowest filter — {plural(relax.count, "signup")}{" "}
            match everything else.
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {relax && label ? (
          <Button onClick={() => onClearFilter(relax.key)} variant="outline">
            Relax {label}
          </Button>
        ) : null}
        <Button onClick={onClearAll} variant="ghost">
          Clear all filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}

function Dashboard({
  data,
  dataUpdatedAt,
  refreshFailed,
  onRetry,
  now,
  lastSeen,
  listRef,
  onDelete,
}: {
  data: WaitlistData;
  dataUpdatedAt: number;
  refreshFailed: boolean;
  onRetry: () => void;
  now: Date;
  lastSeen: string | null;
  listRef: RefObject<HTMLElement | null>;
  onDelete: (email: string) => void;
}) {
  const view = useView();
  // Bumped when the search is cleared from outside its field, so the field
  // remounts and drops any pending debounce.
  const [searchKey, setSearchKey] = useState(0);
  const clearAll = () => {
    view.clearAll();
    setSearchKey((key) => key + 1);
  };
  const clearFilter = (key: FilterKey) => {
    view.clearFilter(key);
    if (key === "q") setSearchKey((n) => n + 1);
  };
  const { rows } = data;
  const filtered = useMemo(
    () => applyFilters(rows, view.filters),
    [rows, view.filters],
  );
  const sorted = useMemo(
    () => sortRows(filtered, view.dir),
    [filtered, view.dir],
  );
  const facets = useMemo(
    () => facetCounts(rows, view.filters),
    [rows, view.filters],
  );
  const isFiltered = activeFilters(view.filters).length > 0;

  return (
    <>
      <Momentum
        buckets={dailyBuckets(rows, filtered, now)}
        filtered={isFiltered}
        lastSeen={lastSeen}
        summary={summary(rows, data.total, now, lastSeen)}
      />
      <Composition
        facets={facets}
        filters={view.filters}
        onChange={view.setFilters}
      />
      <section
        aria-label="Signups"
        className="flex flex-col gap-3 outline-none"
        ref={listRef}
        tabIndex={-1}
      >
        {refreshFailed ? (
          <Notice>
            Could not refresh. Showing the list from{" "}
            {formatRelativeTime(new Date(dataUpdatedAt).toISOString())}.
            <Button onClick={onRetry} size="xs" variant="outline">
              Try again
            </Button>
          </Notice>
        ) : null}
        {data.capped ? (
          <Notice>
            Showing the newest {rows.length.toLocaleString()} of{" "}
            {data.total.toLocaleString()} signups. Counts include all of them.
          </Notice>
        ) : null}
        <WaitlistToolbar
          filtered={isFiltered}
          filters={view.filters}
          onChange={view.setFilters}
          onClearAll={clearAll}
          searchKey={searchKey}
          shown={filtered.length}
          total={rows.length}
        />
        {sorted.length === 0 ? (
          <NoMatches
            onClearAll={clearAll}
            onClearFilter={clearFilter}
            rows={rows}
            view={view}
          />
        ) : (
          <WaitlistTable
            dir={view.dir}
            lastSeen={lastSeen}
            onDelete={onDelete}
            onDir={view.setDir}
            rows={sorted}
          />
        )}
      </section>
    </>
  );
}

export function WaitlistAdminPage(): React.ReactElement {
  const query = useWaitlist();
  const view = useView();
  const now = useNow();
  // Read once per page load, here rather than in Dashboard, so a remount
  // (empty list, then the first signup) never re-reads it mid-visit.
  const lastSeen = useLastSeen();
  const listRef = useRef<HTMLElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteSessionEnded, setDeleteSessionEnded] = useState(false);
  const { data } = query;

  const sessionEnded =
    query.error instanceof SessionEndedError || deleteSessionEnded;
  const filteredRows = useMemo(
    () => (data ? applyFilters(data.rows, view.filters) : null),
    [data, view.filters],
  );

  let body: React.ReactNode;
  if (sessionEnded) body = <SessionEnded />;
  else if (!data && query.isPending) body = <PageSkeleton />;
  else if (!data)
    body = (
      <ErrorCard
        message="The workspace could not reach the waitlist."
        onRetry={() => void query.refetch()}
        role="alert"
        title="Could not load the waitlist"
      />
    );
  else if (data.total === 0) body = <NoSignups />;
  else
    body = (
      <Dashboard
        data={data}
        dataUpdatedAt={query.dataUpdatedAt}
        lastSeen={lastSeen}
        listRef={listRef}
        now={now}
        onDelete={setDeleting}
        onRetry={() => void query.refetch()}
        refreshFailed={query.isError}
      />
    );

  return (
    <main className="flex h-dvh min-w-0">
      <PageContainer
        actions={
          <HeaderActions
            fetching={query.isFetching}
            filtered={activeFilters(view.filters).length > 0}
            onRefresh={() => void query.refetch()}
            rows={sessionEnded ? null : filteredRows}
          />
        }
        subtitle={
          data
            ? `Updated ${formatRelativeTime(new Date(query.dataUpdatedAt).toISOString())}`
            : undefined
        }
        title="Waitlist"
        width="full"
      >
        {body}
      </PageContainer>
      <DeleteSignupDialog
        email={deleting}
        onClose={() => setDeleting(null)}
        onSessionEnded={() => setDeleteSessionEnded(true)}
        returnFocusRef={listRef}
      />
    </main>
  );
}
