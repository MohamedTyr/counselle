import type { Task } from "@/domain/task"
import type {
  AllTaskSortState,
  SortDirection,
} from "@/features/tasks/task-types"
import {
  categoryLabel,
  prioritySortRank,
  statusLabel,
} from "@/features/tasks/task-config"
import { getPlanningDate } from "@/features/tasks/task-dates"

export function compareDateValues(
  firstValue: string | undefined,
  secondValue: string | undefined,
  direction: SortDirection
) {
  if (!firstValue && !secondValue) {
    return 0
  }

  if (!firstValue) {
    return 1
  }

  if (!secondValue) {
    return -1
  }

  const firstTime = new Date(firstValue).getTime()
  const secondTime = new Date(secondValue).getTime()

  return direction === "asc" ? firstTime - secondTime : secondTime - firstTime
}

export function compareTextValues(
  firstValue: string,
  secondValue: string,
  direction: SortDirection
) {
  const comparison = firstValue.localeCompare(secondValue, undefined, {
    sensitivity: "base",
  })

  return direction === "asc" ? comparison : -comparison
}

export function compareNumberValues(
  firstValue: number,
  secondValue: number,
  direction: SortDirection
) {
  return direction === "asc"
    ? firstValue - secondValue
    : secondValue - firstValue
}

export function compareAllTasksByColumn(
  first: Task,
  second: Task,
  sortState: AllTaskSortState
) {
  switch (sortState.columnId) {
    case "task":
      return compareTextValues(first.title, second.title, sortState.direction)
    case "status":
      return compareTextValues(
        statusLabel[first.status],
        statusLabel[second.status],
        sortState.direction
      )
    case "category":
      return compareTextValues(
        categoryLabel[first.category],
        categoryLabel[second.category],
        sortState.direction
      )
    case "priority":
      return compareNumberValues(
        prioritySortRank[first.priority],
        prioritySortRank[second.priority],
        sortState.direction
      )
    case "workDate":
      return compareDateValues(
        first.planned_for,
        second.planned_for,
        sortState.direction
      )
    case "dueDate":
      return compareDateValues(first.due_at, second.due_at, sortState.direction)
    case "reminder":
      return compareDateValues(
        first.reminder_at,
        second.reminder_at,
        sortState.direction
      )
  }
}

export function sortAllTasks(tasks: Task[], sortState: AllTaskSortState) {
  return [...tasks].sort((first, second) => {
    const columnComparison = compareAllTasksByColumn(first, second, sortState)

    if (columnComparison !== 0) {
      return columnComparison
    }

    const planningComparison = compareTasksByPlanningDate(first, second)

    if (planningComparison !== 0) {
      return planningComparison
    }

    return first.id.localeCompare(second.id)
  })
}

export function compareTasksByPlanningDate(first: Task, second: Task) {
  const firstDate = getPlanningDate(first)
  const secondDate = getPlanningDate(second)

  if (firstDate && secondDate) {
    const dateComparison = firstDate.getTime() - secondDate.getTime()

    if (dateComparison !== 0) {
      return dateComparison
    }
  }

  if (firstDate && !secondDate) {
    return -1
  }

  if (!firstDate && secondDate) {
    return 1
  }

  const priorityComparison =
    prioritySortRank[first.priority] - prioritySortRank[second.priority]

  if (priorityComparison !== 0) {
    return priorityComparison
  }

  return first.title.localeCompare(second.title, undefined, {
    sensitivity: "base",
  })
}

export function sortPlanningTasks(tasks: Task[]) {
  return [...tasks].sort(compareTasksByPlanningDate)
}
