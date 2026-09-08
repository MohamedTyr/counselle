import type React from "react";

import { Skeleton } from "@/components/ui/skeleton";

/*
 * The About tab's loading state — rail + panel, shaped like the content it
 * replaces (DESIGN.md §15.2: two staggered-width `Skeleton` bars, never a
 * generic shimmer block). `aria-busy` so a screen reader knows the region is
 * still loading rather than reading "empty".
 */
const ROW_WIDTHS = ["w-2/3", "w-5/6", "w-1/2", "w-3/4", "w-2/5", "w-4/5"];

export function SchoolFactsSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      className="mx-auto grid w-full max-w-[1160px] items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8"
    >
      <div className="hidden flex-col gap-2 md:flex">
        {["w-full", "w-4/5", "w-5/6", "w-2/3", "w-3/4", "w-1/2"].map(
          (width, index) => (
            <Skeleton className={`h-8 rounded-[10px] ${width}`} key={index} />
          ),
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--school-facts-panel-border)] bg-[var(--school-facts-panel-surface)] px-4 py-5 sm:px-6">
        <Skeleton className="h-5 w-40" />
        <div className="flex flex-col gap-3.5">
          {ROW_WIDTHS.map((width, index) => (
            <div className="flex items-center justify-between gap-4" key={index}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
