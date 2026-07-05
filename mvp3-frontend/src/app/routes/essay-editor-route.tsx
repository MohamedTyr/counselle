import { Navigate, useNavigate, useParams } from "react-router"
import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"
import { essays } from "@/fixtures/essays"

const EssayEditorPage = lazy(() =>
  import("@/pages/essay-editor-page").then((module) => ({
    default: module.EssayEditorPage,
  }))
)

export function Component() {
  const navigate = useNavigate()
  const { essayId } = useParams()
  const essay = essays.find((candidateEssay) => candidateEssay.id === essayId)

  if (!essay) {
    return <Navigate replace to="/essays" />
  }

  return (
    <Suspense fallback={<RoutePageFallback />}>
      <EssayEditorPage essay={essay} onBack={() => void navigate("/essays")} />
    </Suspense>
  )
}
