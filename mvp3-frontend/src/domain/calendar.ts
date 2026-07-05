import type { CalendarEvent } from "@schedule-x/calendar"

import type { Task } from "@/domain/task"

export type CalendarMode = "hard_deadlines" | "task_due_dates" | "work_plan"
export type CalendarEventKind = "hard_deadline" | "task_due" | "task_work"
export type CalendarSurfaceView = "month" | "time_grid"
export type HardDeadlineKind =
  | "application"
  | "aid"
  | "scholarship"
  | "recommendation"
  | "portal"
  | "document"

export type HardDeadline = {
  id: string
  title: string
  deadline_at: string
  kind: HardDeadlineKind
  school_name?: string
  source_label?: string
  verification_status?: "verified" | "needs_review" | "stale" | "user_entered"
}

export type CounselleCalendarEvent = CalendarEvent & {
  kind: CalendarEventKind
  dateKey: string
  subtitle: string
  taskId?: string
  deadlineId?: string
  category?: Task["category"]
  priority?: Task["priority"]
  isDone?: boolean
  deadlineKind?: HardDeadlineKind
  schoolName?: string
  sourceLabel?: string
}
