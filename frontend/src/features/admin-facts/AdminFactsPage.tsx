import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { DatabaseZap } from "lucide-react";

import { useEnqueueFactsPass, useFactsStatus } from "@/api/admin/facts-status";
import { isTransportError } from "@/api/http/errors";
import { CoverageGapsSection } from "@/features/admin-facts/CoverageGapsSection";
import { RunPassButton } from "@/features/admin-facts/RunPassButton";
import { RecentPassesTable } from "@/features/admin-facts/RecentPassesTable";
import { TabHealthTable } from "@/features/admin-facts/TabHealthTable";
import { UnmappedLabelsSection } from "@/features/admin-facts/UnmappedLabelsSection";
import { StatTiles } from "@/features/admin-facts/StatTiles";
import { formatCountdown, formatDateTime } from "@/features/admin-facts/crawl-status";

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** The header meta line beside "Run a pass now": "Worker disabled" (exit
 * test: this exact string) when the flag is off, else "Last checked {date}
 * · next pass in {Nh Nm}" or nothing yet if there's no next-run estimate. */
function HeaderMeta({
  lastCheckedIso,
  nextRunAtIso,
  workerEnabled,
}: {
  lastCheckedIso: string | null;
  nextRunAtIso: string | null;
  workerEnabled: boolean;
}) {
  if (!workerEnabled) {
    return <>Worker disabled</>;
  }
  const parts: string[] = [];
  if (lastCheckedIso) {
    parts.push(`Last checked ${formatDateTime(lastCheckedIso)}`);
  }
  if (nextRunAtIso) {
    parts.push(`next pass in ${formatCountdown(nextRunAtIso)}`);
  }
  return <>{parts.length > 0 ? parts.join(" · ") : "No passes yet"}</>;
}

export function AdminFactsPage() {
  const statusQuery = useFactsStatus();
  const enqueueMutation = useEnqueueFactsPass();
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const runPass = () => {
    setConflictNotice(null);
    enqueueMutation.mutate(undefined, {
      onError: (error) => {
        if (isTransportError(error) && error.kind === "conflict") {
          setConflictNotice("A pass is already queued.");
          return;
        }
      },
    });
  };

  const status = statusQuery.data;

  return (
    <PageContainer
      actions={
        // Withheld until `status` loads: a not-yet-known worker/queue state
        // must never render as an actionable button (it would let a click
        // enqueue a pass before we know whether that's even allowed).
        status ? (
          <RunPassButton isPending={enqueueMutation.isPending} onRun={runPass} status={status} />
        ) : undefined
      }
      subtitle={
        status ? (
          <HeaderMeta
            lastCheckedIso={status.last_run?.finished_at ?? status.last_run?.started_at ?? null}
            nextRunAtIso={status.next_run_at}
            workerEnabled={status.worker_enabled}
          />
        ) : undefined
      }
      title="School data"
      width="panel"
    >
      {conflictNotice && (
        <p className="rounded-md border bg-card px-3 py-2 text-sm" role="status">
          {conflictNotice}
        </p>
      )}

      {statusQuery.isLoading ? (
        <DashboardSkeleton />
      ) : statusQuery.isError ? (
        <ErrorCard
          message="The workspace could not reach the school data service."
          onRetry={() => void statusQuery.refetch()}
          role="alert"
          title="Could not load crawl status"
        />
      ) : status && status.last_run === null ? (
        <Empty className="rounded-xl border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseZap aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No passes yet</EmptyTitle>
            <EmptyDescription>
              {status.worker_enabled
                ? "Start a pass to populate school facts."
                : "The crawler is switched off. Turn it on, or run python -m app.facts --once, to collect school facts."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <RunPassButton isPending={enqueueMutation.isPending} onRun={runPass} status={status} />
          </EmptyContent>
        </Empty>
      ) : status && status.last_run ? (
        <div className="flex flex-col gap-6">
          {!status.worker_enabled && (
            <Badge className="w-fit" variant="warning">
              Crawler disabled — showing the last completed pass
            </Badge>
          )}
          <StatTiles isRefetching={statusQuery.isFetching} status={status} />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">Per-tab health</h2>
            <TabHealthTable tabFailures={status.tab_failures} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">Recent passes</h2>
            <RecentPassesTable history={status.history} />
          </section>
          <UnmappedLabelsSection unmappedLabelCount={status.last_run.unmapped_label_count} />
          <CoverageGapsSection coverage={status.coverage} />
        </div>
      ) : null}
    </PageContainer>
  );
}
