import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"

const SchoolsPage = lazy(() =>
  import("@/pages/schools-page").then((module) => ({
    default: module.SchoolsPage,
  }))
)

export function Component() {
  return (
    <Suspense fallback={<RoutePageFallback />}>
      <SchoolsPage />
    </Suspense>
  )
}
