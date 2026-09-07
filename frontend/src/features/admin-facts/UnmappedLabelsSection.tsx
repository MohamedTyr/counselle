import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnmappedLabels } from "@/api/admin/facts-status";

/**
 * "Unmapped labels" (plan §5.5/appendix E, F23): a collapsed-by-default
 * section that only queries the paged `/admin/facts/unmapped` endpoint once
 * opened — a shape change at CollegeData can surface thousands of these, so
 * they stay off the polled status payload and load lazily here instead.
 */
export function UnmappedLabelsSection({ unmappedLabelCount }: { unmappedLabelCount: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const query = useUnmappedLabels(page, open);
  const pageSize = query.data?.items.length ?? 0;
  const total = query.data?.total ?? 0;
  const hasNextPage = page * pageSize < total;

  return (
    <Collapsible
      onOpenChange={(next) => {
        setOpen(next);
      }}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <Button className="w-full justify-between" variant="outline">
          <span>
            {unmappedLabelCount} unmapped {unmappedLabelCount === 1 ? "label" : "labels"} the
            mapper did not recognise in the last pass
          </span>
          <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        {query.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {query.isError && (
          <p className="text-sm text-destructive" role="alert">
            Could not load unmapped labels.
          </p>
        )}
        {query.data && (
          <>
            <ScrollArea className="h-64 rounded-md border">
              <ul className="divide-y">
                {query.data.items.map((item) => (
                  <li
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    key={`${item.source_path}:${item.label}`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{item.source_path}</span>{" "}
                      <span className="font-medium text-foreground">{item.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {item.school_count} {item.school_count === 1 ? "school" : "schools"}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {page} of {Math.max(1, Math.ceil(total / (pageSize || 1)))} · {total} total
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="sm"
                  variant="outline"
                >
                  Previous
                </Button>
                <Button
                  disabled={!hasNextPage}
                  onClick={() => setPage((current) => current + 1)}
                  size="sm"
                  variant="outline"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
