import type { Dispatch, SetStateAction } from "react"

import type { Task, TaskStatus } from "@/domain/task"

export type TaskView = "today" | "upcoming" | "all"
export type SortDirection = "asc" | "desc"
export type AllTaskColumnId =
  | "task"
  | "status"
  | "category"
  | "priority"
  | "workDate"
  | "dueDate"
  | "reminder"
export type AllTaskSortState = {
  columnId: AllTaskColumnId
  direction: SortDirection
}
export type AllTaskColumn = {
  id: AllTaskColumnId
  label: string
  width: number
}

export type TodayColumn = {
  id: TaskStatus
  title: string
  description: string
}

export type TaskLayoutMode = false | "position"
export type EditableTaskField =
  | "application_id"
  | "assignee"
  | "category"
  | "due_at"
  | "essay_id"
  | "needs_input"
  | "notes"
  | "planned_for"
  | "priority"
  | "reminder_at"
  | "status"
  | "title"

export type SelectionBox = {
  currentX: number
  currentY: number
  hasDragged: boolean
  startX: number
  startY: number
}

export type UpdateTask = (
  taskId: string,
  patch: Partial<Task>,
  options?: { touch?: boolean }
) => void

export type UpcomingGroup = {
  id: string
  title: string
  subtitle: string
  tasks: Task[]
}

export type SelectionBounds = {
  bottom: number
  left: number
  right: number
  top: number
}

export type SelectionSession = {
  additive: boolean
  baseIds: string[]
  pointerId: number
  startX: number
  startY: number
}

export type TasksPageProps =
  | {
      tasks: Task[]
      onTasksChange: Dispatch<SetStateAction<Task[]>>
    }
  | {
      tasks?: undefined
      onTasksChange?: undefined
    }
