import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CrawlRunSummary, FactsStatus } from "@/api/admin/facts-status";
import { crawlRunBadge, formatDateTime, formatDurationShort } from "@/features/admin-facts/crawl-status";

function StatTile({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1 text-sm">{children}</div>
    </Card>
  );
}

function LastPassTile({ lastRun, queuedOrRunning }: { lastRun: CrawlRunSummary | null; queuedOrRunning: boolean }) {
  const badge = crawlRunBadge(lastRun, queuedOrRunning);
  return (
    <StatTile label="Last pass">
      <Badge variant={badge.variant}>{badge.label}</Badge>
      {lastRun && (
        <>
          <p className="text-foreground">{formatDateTime(lastRun.started_at)}</p>
          {lastRun.duration_s !== null && (
            <p className="text-muted-foreground">{formatDurationShort(lastRun.duration_s)}</p>
          )}
        </>
      )}
    </StatTile>
  );
}

function PagesTile({ lastRun }: { lastRun: CrawlRunSummary | null }) {
  return (
    <StatTile label="Pages">
      <p className="font-medium text-foreground tabular-nums">
        {(lastRun?.pages_fetched ?? 0).toLocaleString()} fetched
      </p>
      <p className="text-muted-foreground tabular-nums">
        {(lastRun?.pages_changed ?? 0).toLocaleString()} changed
      </p>
      <p className="text-muted-foreground tabular-nums">
        {(lastRun?.pages_failed ?? 0).toLocaleString()} failed
      </p>
    </StatTile>
  );
}

function SchoolsTile({ coverage }: { coverage: FactsStatus["coverage"] }) {
  return (
    <StatTile label="Schools">
      <p className="font-medium text-foreground tabular-nums">
        {coverage.schools_with_facts.toLocaleString()} of{" "}
        {coverage.schools_total.toLocaleString()} have facts
      </p>
      {coverage.sitemap_slugs !== null && (
        <p className="text-muted-foreground tabular-nums">
          {coverage.crosswalk_matched.toLocaleString()} of{" "}
          {coverage.sitemap_slugs.toLocaleString()} slugs matched
        </p>
      )}
    </StatTile>
  );
}

function NeedsAttentionTile({
  status,
}: {
  status: FactsStatus;
}) {
  const failingTabs = status.tab_failures.length;
  const unmappedCount = status.last_run?.unmapped_label_count ?? 0;
  const unmatchedSlugs = status.coverage.crosswalk_unmatched;
  return (
    <StatTile label="Needs attention">
      <p className="tabular-nums">
        <span className="font-medium text-foreground">{failingTabs}</span>{" "}
        {failingTabs === 1 ? "tab" : "tabs"} with failures
      </p>
      <p className="tabular-nums">
        <span className="font-medium text-foreground">{unmappedCount}</span> unmapped labels
      </p>
      <p className="tabular-nums">
        <span className="font-medium text-foreground">{unmatchedSlugs}</span> unmatched slugs
      </p>
    </StatTile>
  );
}

/** The four-tile row (plan §5.5 / appendix E): last pass, pages,
 * schools covered, needs-attention. `aria-live`/`aria-busy` on the wrapper
 * (appendix E's A11y note): the row's content changes on a 30s poll with no
 * user action, so a screen reader needs to be told, and needs to be told
 * *not* mid-refetch (which would announce a half-updated row). */
export function StatTiles({
  isRefetching,
  status,
}: {
  isRefetching: boolean;
  status: FactsStatus;
}) {
  return (
    <div
      aria-busy={isRefetching}
      aria-live="polite"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4"
    >
      <LastPassTile lastRun={status.last_run} queuedOrRunning={status.queued_or_running} />
      <PagesTile lastRun={status.last_run} />
      <SchoolsTile coverage={status.coverage} />
      <NeedsAttentionTile status={status} />
    </div>
  );
}
