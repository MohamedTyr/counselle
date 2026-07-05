import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"

const ActivitiesPage = lazy(() =>
  import("@/pages/activities-page").then((module) => ({
    default: module.ActivitiesPage,
  }))
)

export function Component() {
  return (
    <Suspense fallback={<RoutePageFallback />}>
      <ActivitiesPage />
    </Suspense>
  )
}
