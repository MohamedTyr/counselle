import type React from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { satSheetClass } from "@/features/sat/sat-chrome-styles";
import { SatPracticeFrame } from "@/features/sat/SatPracticeFrame";

/** `/app/sat/practice`'s `HydrateFallback` (plan §5.1) — a hard load of the
 * lazy route. Also reused by `SatPractice.tsx` for the "session loading"
 * state (ui-spec §4.3): the frame renders at once, bars live, `Skeleton`
 * blocks fill the reading region (Q2a). One sheet on a phone, two beside it. */
export function SatPracticeSkeleton(): React.ReactElement {
  return (
    <SatPracticeFrame aria-busy="true">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 px-4 min-[861px]:px-6">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full min-[861px]:w-56" />
      </div>
      <div className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 px-4 pb-2 min-[861px]:grid-cols-2 min-[861px]:px-6">
        <div className={`${satSheetClass} flex-col gap-3 p-8 max-[860px]:hidden min-[861px]:flex`}>
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className={`${satSheetClass} flex flex-col gap-3 p-4 min-[861px]:p-8`}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
      <div className="flex h-16 shrink-0 items-center justify-between gap-4 px-4 min-[861px]:px-6">
        <Skeleton className="h-9 w-44 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
    </SatPracticeFrame>
  );
}
