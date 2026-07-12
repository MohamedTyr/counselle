import type {
  ApplicationStatus,
  ApplicationView,
  ListType,
  Rollup,
  Round,
  TestPlan,
} from "@/api/workspace/types"

export type DeadlineUrgency = "close" | "upcoming" | "normal"

export type { ApplicationStatus, ListType, Round, TestPlan }
export type Progress = Rollup

export type School = {
  id: string
  unitid: number
  cycleYear: number | null
  platform: ApplicationView["platform"]
  checklist: ApplicationView["checklist"]
  schoolName: string
  location: string
  websiteUrl: string | null
  status: ApplicationStatus
  listType: ListType
  round: Round
  deadline: string | null
  aidDeadline: string | null
  scholarshipDeadline: string | null
  notes: string | null
  intendedMajor: string | null
  testPlan: TestPlan | null
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
    cycleYear: application.cycle_year,
    platform: application.platform,
    checklist: application.checklist,
    schoolName: application.school_name,
    location: formatSchoolLocation(application),
    websiteUrl: application.website_url,
    status: application.status,
    listType: application.list_type,
    round: application.round,
    deadline: application.deadline,
    aidDeadline: application.aid_deadline,
    scholarshipDeadline: application.scholarship_deadline,
    notes: application.notes,
    intendedMajor: application.intended_major,
    testPlan: application.test_plan,
    progress: application.progress,
    essays: application.essays,
  }
}
