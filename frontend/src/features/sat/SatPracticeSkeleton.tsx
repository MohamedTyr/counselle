import type React from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** `/app/sat/practice`'s `HydrateFallback` (plan §5.1) — a hard load of the
 * lazy route. Also reused by `SatPractice.tsx` for the "session loading"
 * state (ui-spec §4.3): the frame renders at once, bars live, `Skeleton`
 * blocks fill the reading region (Q2a). */
export function SatPracticeSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className="flex h-dvh flex-col bg-[var(--canvas)]">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--chrome)] px-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-0 divide-x divide-[var(--hairline)]">
        <div className="flex flex-col gap-3 overflow-hidden px-10 py-6">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-3 overflow-hidden px-10 py-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
      <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-t border-[var(--hairline)] bg-[var(--chrome)] px-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}
