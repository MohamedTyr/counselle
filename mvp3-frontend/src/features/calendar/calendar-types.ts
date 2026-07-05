import type { Dispatch, SetStateAction } from "react"

import type { CalendarEventKind } from "@/domain/calendar"
import type { Task } from "@/domain/task"

export type CalendarPageProps = {
  tasks: Task[]
  onTasksChange: Dispatch<SetStateAction<Task[]>>
}

export type CalendarTaskDateField = "due_at" | "planned_for"

export type CalendarDragPayload = {
  kind: Extract<CalendarEventKind, "task_due" | "task_work">
  taskId: string
}

export type CalendarTimeGridDropTarget = {
  dateKey: string
  minutes?: number
  placement: "all_day" | "time"
}
