import type { CalendarMode, HardDeadlineKind } from "@/domain/calendar"
import type { Task } from "@/domain/task"

export const calendarDragMimeType = "application/counselle-calendar-event"

export const modeMeta: Record<
  CalendarMode,
  { label: string; shortLabel: string }
> = {
  hard_deadlines: {
    label: "Hard deadlines",
    shortLabel: "Hard",
  },
  task_due_dates: {
    label: "Task due dates",
    shortLabel: "Due",
  },
  work_plan: {
    label: "Work plan",
    shortLabel: "Work",
  },
}

export const calendarModes = Object.keys(modeMeta) as CalendarMode[]

export const categoryLabel: Record<Task["category"], string> = {
  aid: "Aid",
  essay: "Essay",
  form: "Form",
  lor: "LOR",
  other: "Other",
  research: "Research",
}

export const priorityLabel: Record<Task["priority"], string> = {
  high: "High",
  low: "Low",
  med: "Med",
}

export const deadlineKindLabel: Record<HardDeadlineKind, string> = {
  aid: "Aid",
  application: "Application",
  document: "Document",
  portal: "Portal",
  recommendation: "Recommendation",
  scholarship: "Scholarship",
}
