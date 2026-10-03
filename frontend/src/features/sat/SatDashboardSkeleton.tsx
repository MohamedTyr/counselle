import type React from "react";

import { PageContainer } from "@/components/workspace/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import { SatTopicTreeSkeleton } from "@/features/sat/SatTopicTree";

/** The `/app/sat` route's `HydrateFallback` — shown only on an initial
 * hard load of the lazy route (plan §5.1). Mirrors the loaded layout: the
 * status tabs, the topic sheets, then the session and activity sheets. */
export function SatDashboardSkeleton(): React.ReactElement {
  return (
    <PageContainer title={SAT_DASHBOARD_COPY.title} width="panel">
      <div aria-busy="true" className="@container/sat-dash flex flex-col gap-6">
        <Skeleton className="h-10 w-full max-w-md rounded-full" />
        <div className="flex flex-col gap-8 @[880px]/sat-dash:grid @[880px]/sat-dash:grid-cols-[minmax(0,1fr)_320px] @[880px]/sat-dash:items-start">
          <div className="order-2 min-w-0 @[880px]/sat-dash:order-none">
            <SatTopicTreeSkeleton />
          </div>
          <div className="order-1 flex flex-col gap-8 @[880px]/sat-dash:order-none">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
