export type ApplicationStatus =
  | "Considering"
  | "Applying"
  | "Submitted"
  | "Accepted"
  | "Rejected"
  | "Waitlisted"
  | "Withdrawn"

export type ListType = "Reach" | "Target" | "Safety"
export type Round =
  | "EA"
  | "ED"
  | "RD"
  | "Rolling"
  | "Priority"
  | "Scholarship deadline"
export type DeadlineUrgency = "close" | "upcoming" | "normal"

export type Progress = {
  completed: number
  total: number
}

export type School = {
  id: string
  name: string
  shortName: string
  location: string
  websiteUrl: string
  logoUrl: string
  status: ApplicationStatus
  listType: ListType
  round: Round
  nextDeadline: string
  deadlineUrgency: DeadlineUrgency
  progress: Progress
  essays: Progress
}
