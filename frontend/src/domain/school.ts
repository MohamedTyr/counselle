import type {
  ApplicationStatus,
  ApplicationView,
  ListType,
  Rollup,
  Round,
} from "@/api/workspace/types"

export type DeadlineUrgency = "close" | "upcoming" | "normal"

export type { ApplicationStatus, ListType, Round }
export type Progress = Rollup

export type School = {
  id: string
  unitid: number
  schoolName: string
  location: string
  websiteUrl: string | null
  status: ApplicationStatus
  listType: ListType
  round: Round
  deadline: string | null
  progress: Progress
  essays: Progress
}

export function formatSchoolLocation({
  school_city: city,
  school_state: state,
}: Pick<ApplicationView, "school_city" | "school_state">) {
  if (city && state) {
    return `${city}, ${state}`
  }

  return city ?? state ?? "Location unavailable"
}

export function schoolFromApplication(application: ApplicationView): School {
  return {
    id: application.id,
    unitid: application.school_unitid,
    schoolName: application.school_name,
    location: formatSchoolLocation(application),
    websiteUrl: application.website_url,
    status: application.status,
    listType: application.list_type,
    round: application.round,
    deadline: application.deadline,
    progress: application.progress,
    essays: application.essays,
  }
}
