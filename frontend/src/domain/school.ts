import type {
  ApplicationStatus,
  ApplicationView,
  DeadlineSource,
  ListType,
  Rollup,
  Round,
  TestPlan,
} from "@/api/workspace/types";

export type DeadlineUrgency = "close" | "upcoming" | "normal";

export type { ApplicationStatus, DeadlineSource, ListType, Round, TestPlan };
export type Progress = Rollup;

export type School = {
  id: string;
  unitid: number;
  cycleYear: number | null;
  schoolName: string;
  location: string;
  websiteUrl: string | null;
  status: ApplicationStatus;
  listType: ListType;
  round: Round;
  deadline: string | null;
  deadlineSource: DeadlineSource | null;
  deadlineCheckedAt: string | null;
  deadlineInheritedDate: string | null;
  deadlineInheritedCheckedAt: string | null;
  aidDeadline: string | null;
  aidDeadlineSource: DeadlineSource | null;
  aidDeadlineCheckedAt: string | null;
  aidDeadlineInheritedDate: string | null;
  aidDeadlineInheritedCheckedAt: string | null;
  scholarshipDeadline: string | null;
  notes: string | null;
  intendedMajor: string | null;
  testPlan: TestPlan | null;
  progress: Progress;
  essays: Progress;
};

export function formatSchoolLocation({
  school_city: city,
  school_state: state,
}: Pick<ApplicationView, "school_city" | "school_state">) {
  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? "Location unavailable";
}

export function schoolFromApplication(application: ApplicationView): School {
  return {
    id: application.id,
    unitid: application.school_unitid,
    cycleYear: application.cycle_year,
    schoolName: application.school_name,
    location: formatSchoolLocation(application),
    websiteUrl: application.website_url,
    status: application.status,
    listType: application.list_type,
    round: application.round,
    deadline: application.deadline,
    deadlineSource: application.deadline_source,
    deadlineCheckedAt: application.deadline_checked_at,
    deadlineInheritedDate: application.deadline_inherited_date,
    deadlineInheritedCheckedAt: application.deadline_inherited_checked_at,
    aidDeadline: application.aid_deadline,
    aidDeadlineSource: application.aid_deadline_source,
    aidDeadlineCheckedAt: application.aid_deadline_checked_at,
    aidDeadlineInheritedDate: application.aid_deadline_inherited_date,
    aidDeadlineInheritedCheckedAt: application.aid_deadline_inherited_checked_at,
    scholarshipDeadline: application.scholarship_deadline,
    notes: application.notes,
    intendedMajor: application.intended_major,
    testPlan: application.test_plan,
    progress: application.progress,
    essays: application.essays,
  };
}
