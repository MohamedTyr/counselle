import type React from "react";

import { PageContainer } from "@/components/workspace/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";

/** The `/app/sat` route's `HydrateFallback` — shown only on an initial
 * hard load of the lazy route (plan §5.1). */
export function SatDashboardSkeleton(): React.ReactElement {
  return (
    <PageContainer title={SAT_DASHBOARD_COPY.title}>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-56 w-full max-w-72" />
      </div>
    </PageContainer>
  );
}
