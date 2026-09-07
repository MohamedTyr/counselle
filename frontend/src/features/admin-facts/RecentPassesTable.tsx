import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CrawlRunSummary } from "@/api/admin/facts-status";
import { crawlRunBadge, formatDateTime, formatDurationShort } from "@/features/admin-facts/crawl-status";

/** The last `facts_admin_history_limit` passes (plan §5.5's recent-passes
 * table), newest first — `history` already arrives in that order and
 * already-capped from the server, so this renders it verbatim. */
export function RecentPassesTable({ history }: { history: CrawlRunSummary[] }) {
  return (
    <Table>
      <TableCaption className="sr-only">Recent crawl passes</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Pages</TableHead>
          <TableHead>Changed</TableHead>
          <TableHead>Errors</TableHead>
          <TableHead>Build rotations</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((run) => {
          const badge = crawlRunBadge(run, false);
          return (
            <TableRow key={run.id}>
              <TableCell>{formatDateTime(run.started_at)}</TableCell>
              <TableCell className="tabular-nums">
                {run.duration_s !== null ? formatDurationShort(run.duration_s) : "—"}
              </TableCell>
              <TableCell className="tabular-nums">{run.pages_fetched.toLocaleString()}</TableCell>
              <TableCell className="tabular-nums">{run.pages_changed.toLocaleString()}</TableCell>
              <TableCell className="tabular-nums">{run.pages_failed.toLocaleString()}</TableCell>
              <TableCell className="tabular-nums">{run.build_id_rotations}</TableCell>
              <TableCell>
                <Badge variant={badge.variant}>
                  {badge.severe && <AlertTriangle aria-hidden="true" />}
                  {badge.label}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
