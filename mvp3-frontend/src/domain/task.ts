export type TaskStatus = "todo" | "doing" | "waiting" | "done"
export type TaskCategory =
  | "essay"
  | "lor"
  | "aid"
  | "research"
  | "other"
  | "form"
export type TaskPriority = "low" | "med" | "high"
export type TaskAssignee = "student" | "counselle"

export type Task = {
  id: string
  title: string
  notes?: string
  due_at?: string
  planned_for?: string
  status: TaskStatus
  category: TaskCategory
  assignee: TaskAssignee
  created_at: string
  updated_at: string
  completed_at?: string
  needs_input?: boolean
  reminder_at?: string
  priority: TaskPriority
}
