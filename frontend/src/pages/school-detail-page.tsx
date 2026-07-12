import { useNavigate, useParams } from "react-router"

import { useApplication } from "@/api/workspace/hooks"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SchoolWorkspace } from "@/features/schools/SchoolWorkspace"

function hasValidReference(data: unknown): data is NonNullable<ReturnType<typeof useApplication>["data"]> {
  if (!data || typeof data !== "object" || !("reference" in data)) return false
  const reference = data.reference
  return Boolean(
    reference &&
      typeof reference === "object" &&
      "status" in reference &&
      (reference.status === "cycle_required" || reference.status === "loaded") &&
      "prompts" in reference &&
      Array.isArray(reference.prompts) &&
      "prompt_groups" in reference &&
      Array.isArray(reference.prompt_groups) &&
      "requirements" in reference &&
      Array.isArray(reference.requirements) &&
      "populated" in reference &&
      typeof reference.populated === "boolean",
  )
}

function SchoolWorkspaceSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-6">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-72 w-full" />
    </section>
  )
}

export function SchoolDetailPage() {
  const navigate = useNavigate()
  const { applicationId } = useParams()
  const detail = useApplication(applicationId ?? null)

  if (!applicationId || detail.isLoading || (!detail.data && !detail.isError)) {
    return <SchoolWorkspaceSkeleton />
  }

  if (detail.isError || !detail.data || !hasValidReference(detail.data)) {
    return (
      <section className="flex min-h-0 flex-1 items-start p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-xl border bg-card p-6">
          <h1 className="font-heading text-lg font-medium">Could not load school workspace</h1>
          <p className="text-sm text-muted-foreground">
            The school details or reference catalog could not be loaded. This is not shown as an empty catalog because that would hide a data failure.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void detail.refetch()}>Try again</Button>
            <Button onClick={() => void navigate("/app/schools")} variant="outline">Back to schools</Button>
          </div>
        </div>
      </section>
    )
  }

  return <SchoolWorkspace detail={detail.data} onRetry={() => void detail.refetch()} />
}
