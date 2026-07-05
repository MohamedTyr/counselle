import { ExternalLink } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type {
  ApplicationStatus,
  ListType,
  Progress,
  School,
} from "@/domain/school"
import {
  listTypeVariant,
  statusVariant,
} from "@/features/schools/schools-config"
import { getProgressRatio } from "@/features/schools/schools-sort"
import { cn } from "@/lib/utils"

export function SchoolLogo({ school }: { school: School }) {
  return (
    <Avatar size="lg" className="rounded-lg">
      <AvatarImage
        alt={`${school.name} logo`}
        className="rounded-lg"
        src={school.logoUrl}
      />
      <AvatarFallback className="rounded-lg">{school.shortName}</AvatarFallback>
    </Avatar>
  )
}

export function SchoolLink({
  school,
  layout = "table",
}: {
  school: School
  layout?: "table" | "mobile"
}) {
  const isMobile = layout === "mobile"

  return (
    <a
      aria-label={`Open ${school.name} website`}
      className={cn(
        "group/school flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isMobile && "flex-1"
      )}
      href={school.websiteUrl}
      rel="noreferrer"
      target="_blank"
    >
      <SchoolLogo school={school} />
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(
            "flex min-w-0 gap-1.5 font-medium",
            isMobile ? "items-start" : "items-center"
          )}
        >
          <span className={isMobile ? "leading-tight" : "truncate"}>
            {school.name}
          </span>
          <ExternalLink
            aria-hidden="true"
            className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/school:opacity-100 group-focus-visible/school:opacity-100"
          />
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {school.location}
        </span>
      </span>
    </a>
  )
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant={statusVariant[status]}>{status}</Badge>
}

export function ListTypeBadge({ listType }: { listType: ListType }) {
  return <Badge variant={listTypeVariant[listType]}>{listType}</Badge>
}

export function DeadlineValue({ school }: { school: School }) {
  if (school.deadlineUrgency === "close") {
    return <Badge variant="error">{school.nextDeadline}</Badge>
  }

  return (
    <span className="text-sm text-foreground tabular-nums">
      {school.nextDeadline}
    </span>
  )
}

export function ProgressValue({ progress }: { progress: Progress }) {
  const percentage = Math.round(getProgressRatio(progress) * 100)

  return (
    <div className="flex min-w-[116px] items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/75"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm tabular-nums">
        {progress.completed}/{progress.total}
      </span>
    </div>
  )
}

export function EssaysValue({ essays }: { essays: Progress }) {
  if (essays.total === 0) {
    return <span className="text-sm text-muted-foreground">None</span>
  }

  return (
    <span
      aria-label={`${essays.completed} of ${essays.total} essays complete`}
      className="text-sm tabular-nums"
    >
      {essays.completed}/{essays.total}
    </span>
  )
}
