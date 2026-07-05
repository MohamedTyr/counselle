import type { HardDeadline } from "@/domain/calendar"
import type { Task } from "@/domain/task"
import { categoryLabel } from "@/features/calendar/calendar-config"
import { getDateKey, startOfLocalDay } from "@/features/calendar/calendar-dates"

export function getTaskSearchText(task: Task) {
  return [task.title, task.notes, categoryLabel[task.category]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function isTaskRelatedToDeadline(task: Task, deadline: HardDeadline) {
  const schoolName = deadline.school_name?.toLowerCase()
  const taskText = getTaskSearchText(task)

  if (schoolName) {
    const schoolTokens = schoolName.split(/\s+/).filter(Boolean)
    const hasSchoolMatch =
      taskText.includes(schoolName) ||
      schoolTokens.some((token) => token.length > 2 && taskText.includes(token))

    if (!hasSchoolMatch) {
      return false
    }
  }

  if (deadline.kind === "aid") {
    return task.category === "aid" || taskText.includes("aid")
  }

  if (deadline.kind === "scholarship") {
    return taskText.includes("scholarship") || task.category === "essay"
  }

  if (deadline.kind === "document" || deadline.kind === "portal") {
    return task.category === "form" || task.category === "research"
  }

  return true
}

export function hasPlannedWorkBeforeDeadline(
  deadline: HardDeadline,
  tasks: Task[]
) {
  const deadlineDay = startOfLocalDay(deadline.deadline_at).getTime()

  return tasks.some((task) => {
    if (!task.planned_for || task.status === "done") {
      return false
    }

    if (!isTaskRelatedToDeadline(task, deadline)) {
      return false
    }

    return startOfLocalDay(task.planned_for).getTime() < deadlineDay
  })
}

export function getHardDeadlineCounts(deadlines: HardDeadline[]) {
  return deadlines.reduce<Record<string, number>>((counts, deadline) => {
    const dateKey = getDateKey(deadline.deadline_at)
    return { ...counts, [dateKey]: (counts[dateKey] ?? 0) + 1 }
  }, {})
}

export function getDeadlinesWithoutPlannedWork(
  deadlines: HardDeadline[],
  tasks: Task[]
) {
  return deadlines.filter(
    (deadline) => !hasPlannedWorkBeforeDeadline(deadline, tasks)
  )
}
