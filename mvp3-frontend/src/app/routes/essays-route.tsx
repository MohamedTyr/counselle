import { useNavigate } from "react-router"
import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"
import type { EssayLibraryCardData } from "@/domain/essay"

const LazyEssaysPage = lazy(() =>
  import("@/pages/essays-page").then((module) => ({
    default: module.EssaysPage,
  }))
)

export function Component() {
  const navigate = useNavigate()

  function handleOpenEssay(essay: EssayLibraryCardData) {
    void navigate(`/essays/${essay.id}`)
  }

  return (
    <Suspense fallback={<RoutePageFallback />}>
      <LazyEssaysPage onOpenEssay={handleOpenEssay} />
    </Suspense>
  )
}
