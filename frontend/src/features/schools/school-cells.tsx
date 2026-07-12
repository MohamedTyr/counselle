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
import {
  formatDeadline,
  getDeadlineUrgency,
} from "@/features/schools/schools-deadline"
import { getProgressRatio } from "@/features/schools/schools-sort"
import { cn } from "@/lib/utils"

function getSchoolInitials(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)

  if (words.length === 0) {
    return "?"
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}

function faviconUrlFromWebsite(websiteUrl: string | null) {
  if (!websiteUrl) {
    return undefined
  }

  try {
    const hostname = new URL(websiteUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return undefined
  }
}

export function SchoolAvatar({
  name,
  websiteUrl,
}: {
  name: string
  websiteUrl: string | null
}) {
  return (
    <Avatar size="lg" className="rounded-lg">
      <AvatarImage
        alt=""
        className="rounded-lg"
        src={faviconUrlFromWebsite(websiteUrl)}
      />
      <AvatarFallback className="rounded-lg">
        {getSchoolInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function SchoolLogo({ school }: { school: School }) {
  return <SchoolAvatar name={school.schoolName} websiteUrl={school.websiteUrl} />
}

export function SchoolIdentity({
  school,
  layout = "table",
  onOpen,
}: {
  school: School
  layout?: "table" | "mobile"
  onOpen: (schoolId: string) => void
}) {
  const isMobile = layout === "mobile"

  return (
    <button
      aria-label={`Open ${school.schoolName} details`}
      className={cn(
        "group/school flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isMobile && "flex-1",
      )}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(school.id)
      }}
      type="button"
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
            {school.schoolName}
          </span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {school.location} · {school.cycleYear ? `${school.cycleYear - 1}-${String(school.cycleYear).slice(-2)}` : "Cycle unconfirmed"}
        </span>
      </span>
    </button>
  )
}

export function SchoolWebsiteLink({ school }: { school: School }) {
  if (!school.websiteUrl) {
    return null
  }

  return (
    <a
      aria-label={`Open ${school.schoolName} website`}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      href={school.websiteUrl}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLink aria-hidden="true" className="size-4" />
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
  const deadline = formatDeadline(school.deadline)

  if (getDeadlineUrgency(school.deadline) === "close") {
    return <Badge variant="error">{deadline}</Badge>
  }

  if (!school.deadline) {
    return <span className="text-sm text-muted-foreground">{deadline}</span>
  }

  return (
    <span className="text-sm text-foreground tabular-nums">
      {deadline}
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
