import type { Task } from "@/domain/task"
import { todayDate } from "@/domain/time"

export function formatShortDate(value?: string) {
  if (!value) {
    return "No due date"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}

export function formatPickerDate(value?: string) {
  if (!value) {
    return "Pick date"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export function startOfLocalDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function getCalendarDayDiff(value: Date, from: Date) {
  return Math.round(
    (startOfLocalDay(value).getTime() - startOfLocalDay(from).getTime()) /
      86_400_000
  )
}

export function getDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function getTodayPlannedForValue() {
  const date = new Date(todayDate)
  date.setHours(9, 0, 0, 0)
  return date.toISOString()
}

export function isTaskPlannedForToday(task: Task) {
  return task.planned_for
    ? getDateKey(new Date(task.planned_for)) === getDateKey(todayDate)
    : false
}

export function formatPlannedDateLabel(value?: string) {
  if (!value) {
    return "Unplanned"
  }

  const plannedDate = new Date(value)
  const dayDiff = getCalendarDayDiff(plannedDate, todayDate)

  if (dayDiff === 0) {
    return "Today"
  }

  if (dayDiff === 1) {
    return "Tomorrow"
  }

  if (dayDiff === -1) {
    return "Yesterday"
  }

  return formatShortDate(value)
}

export function getPlanningDate(task: Task) {
  if (task.planned_for) {
    return new Date(task.planned_for)
  }

  if (task.due_at) {
    return new Date(task.due_at)
  }

  return null
}

export function getPlanningDateLabel(task: Task) {
  if (task.planned_for) {
    return `Work ${formatPlannedDateLabel(task.planned_for)}`
  }

  if (task.due_at) {
    return `Due ${formatShortDate(task.due_at)}`
  }

  return "No date"
}

export function formatReminderLabel(value?: string) {
  return value ? formatShortDate(value) : "None"
}

export function mergeDateWithTime(
  selectedDate: Date,
  currentValue: string | undefined,
  defaultHour: number,
  defaultMinute: number
) {
  const currentDate = currentValue ? new Date(currentValue) : undefined
  const nextDate = new Date(selectedDate)

  nextDate.setHours(
    currentDate?.getHours() ?? defaultHour,
    currentDate?.getMinutes() ?? defaultMinute,
    0,
    0
  )

  return nextDate.toISOString()
}

export function getDueState(task: Task) {
  if (!task.due_at) {
    return "none"
  }

  const dueDate = new Date(task.due_at)
  const diffDays = Math.ceil(
    (dueDate.getTime() - todayDate.getTime()) / 86_400_000
  )

  if (diffDays < 0) {
    return "overdue"
  }

  if (diffDays <= 7) {
    return "soon"
  }

  return "normal"
}
