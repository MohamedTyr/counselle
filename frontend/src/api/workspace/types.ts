export type Actor = "student" | "counselle"
export type ApplicationStatus =
  | "Considering"
  | "Applying"
  | "Submitted"
  | "Deferred"
  | "Accepted"
  | "Enrolled"
  | "Rejected"
  | "Waitlisted"
  | "Withdrawn"
export type ListType = "Reach" | "Target" | "Safety"
export type Round = "EA" | "ED" | "ED2" | "REA" | "RD" | "Rolling" | "Priority"
export type TaskStatus = "todo" | "doing" | "waiting" | "done"
export type TaskCategory =
  | "essay"
  | "lor"
  | "aid"
  | "research"
  | "other"
  | "form"
  | "interview"
export type TaskPriority = "low" | "med" | "high"
export type TestPlan = "submit" | "withhold" | "undecided"
export type Assignee = "student" | "counselle"
export type EssayStatus =
  | "Not started"
  | "Drafting"
  | "Needs review"
  | "Ready"
  | "Submitted"
export type EssayType =
  | "Personal statement"
  | "Supplement"
  | "Scholarship"
  | "Optional"
export type WorkspaceObjectType =
  | "application"
  | "task"
  | "essay"
  | "activity"
  | "honor"
export type ChangeOp = "created" | "updated" | "archived" | "restored"

export type Rollup = {
  completed: number
  total: number
}

export type Application = {
  id: string
  user_id: string
  school_unitid: number
  status: ApplicationStatus
  list_type: ListType
  round: Round
  deadline: string | null
  aid_deadline: string | null
  scholarship_deadline: string | null
  notes: string | null
  intended_major: string | null
  test_plan: TestPlan | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ApplicationView = Application & {
  school_name: string
  school_city: string | null
  school_state: string | null
  website_url: string | null
  progress: Rollup
  essays: Rollup
}

export type SchoolSearchResult = {
  unitid: number
  name: string
  city: string | null
  state: string | null
  website_url: string | null
  on_list: boolean
}

export type ApplicationCreate = {
  unitid: number
  list_type: ListType
  round: Round
  deadline?: string | null
}

export type ApplicationPatch = Partial<{
  status: ApplicationStatus
  list_type: ListType
  round: Round
  deadline: string | null
  aid_deadline: string | null
  scholarship_deadline: string | null
  notes: string | null
  intended_major: string | null
  test_plan: TestPlan | null
}>

export type SeededWorkspaceIds = {
  task_ids: string[]
  essay_ids: string[]
}

export type ApplicationAddResult = {
  application: ApplicationView
  seeded: SeededWorkspaceIds
}

export type Task = {
  id: string
  user_id: string
  application_id: string | null
  essay_id: string | null
  title: string
  notes: string | null
  status: TaskStatus
  category: TaskCategory
  priority: TaskPriority
  assignee: Assignee
  needs_input: boolean
  due_at: string | null
  planned_for: string | null
  reminder_at: string | null
  completed_at: string | null
  archived_via_application: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type TaskCreate = {
  title: string
  application_id?: string | null
  essay_id?: string | null
  notes?: string | null
  status?: TaskStatus
  category?: TaskCategory
  priority?: TaskPriority
  assignee?: Assignee
  needs_input?: boolean
  due_at?: string | null
  planned_for?: string | null
  reminder_at?: string | null
}

export type TaskPatch = Partial<{
  title: string
  application_id: string | null
  essay_id: string | null
  notes: string | null
  status: TaskStatus
  category: TaskCategory
  priority: TaskPriority
  assignee: Assignee
  needs_input: boolean
  due_at: string | null
  planned_for: string | null
  reminder_at: string | null
}>

export type EssaySummary = {
  id: string
  user_id: string
  application_id: string | null
  title: string
  essay_type: EssayType
  status: EssayStatus
  prompt: string | null
  preview: string
  word_count: number
  word_limit: number | null
  comment_count: number
  suggestion_count: number
  archived_via_application: string | null
  school_name: string | null
  school_city: string | null
  school_state: string | null
  deadline: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type TiptapContent = Record<string, unknown>

export type Essay = EssaySummary & {
  content: TiptapContent
  comments: Record<string, unknown>[]
  suggestions: Record<string, unknown>[]
}

export type EssayCreate = {
  title: string
  application_id?: string | null
  essay_type?: EssayType
  status?: EssayStatus
  prompt?: string | null
  content?: TiptapContent
  word_count?: number
  word_limit?: number | null
}

export type EssayPatch = Partial<{
  title: string
  application_id: string | null
  essay_type: EssayType
  status: EssayStatus
  prompt: string | null
  content: TiptapContent
  word_limit: number | null
  deadline: string | null
  expected_updated_at: string | null
}>

export type Activity = {
  id: string
  user_id: string
  sort_order: number
  activity_type: string
  position: string
  organization: string
  description: string
  grades: string[]
  timing: string[]
  hours_per_week: number | null
  weeks_per_year: number | null
  continue_in_college: boolean | null
  story: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ActivityCreate = Partial<{
  activity_type: string
  position: string
  organization: string
  description: string
  grades: string[]
  timing: string[]
  hours_per_week: number | null
  weeks_per_year: number | null
  continue_in_college: boolean | null
  story: string | null
}>

export type ActivityPatch = ActivityCreate

export type Honor = {
  id: string
  user_id: string
  sort_order: number
  title: string
  grades: string[]
  levels: string[]
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type HonorCreate = Partial<{
  title: string
  grades: string[]
  levels: string[]
}>

export type HonorPatch = HonorCreate

export type ApplicationDetail = {
  application: ApplicationView
  tasks: Task[]
  essays: EssaySummary[]
}

export type ChangeEventData = {
  object_type: WorkspaceObjectType
  object_id: string
  op: ChangeOp
  actor: Actor
  application_id: string | null
}

export type ChangeEvent = {
  id: number
  v: 1
  type: `${WorkspaceObjectType}.${ChangeOp}` | string
  data: ChangeEventData
}
