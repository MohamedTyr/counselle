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
import type { TabFailure } from "@/api/admin/facts-status";
import { ADMIN_FACTS_TAB_NAMES } from "@/features/admin-facts/crawl-status";

/** One row per crawled tab (plan §5.5's 6-row per-tab health table). The
 * status shape only carries non-`ok` counts grouped by `(tab, status)`
 * (`FactsStatusResponse.tab_failures`) — there is no "ok" count to show
 * beside it, so a tab with nothing listed reads as "OK" rather than a
 * fabricated total. DESIGN.md §14.3: status is never colour alone — every
 * failure chip carries the word and the count, and three-or-more of the
 * same status on a tab also gets the `AlertTriangle` glyph. */
export function TabHealthTable({ tabFailures }: { tabFailures: TabFailure[] }) {
  const SEVERE_FAILURE_THRESHOLD = 3;
  return (
    <Table>
      <TableCaption className="sr-only">Per-tab crawl health</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Tab</TableHead>
          <TableHead>Failures</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ADMIN_FACTS_TAB_NAMES.map((tab) => {
          const failures = tabFailures.filter((entry) => entry.tab === tab);
          return (
            <TableRow key={tab}>
              <TableCell className="font-medium">{tab}</TableCell>
              <TableCell>
                {failures.length === 0 ? (
                  <Badge variant="success">OK</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {failures.map((failure) => (
                      <Badge key={failure.status} variant="error">
                        {failure.count >= SEVERE_FAILURE_THRESHOLD && (
                          <AlertTriangle aria-hidden="true" />
                        )}
                        {failure.count} {failure.status}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
