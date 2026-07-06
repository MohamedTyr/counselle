import type { Progress, School } from "@/domain/school"
import {
  listTypeSortRank,
  roundSortRank,
  statusSortRank,
} from "@/features/schools/schools-config"
import { getDeadlineTime } from "@/features/schools/schools-deadline"
import type { ColumnId, SortState } from "@/features/schools/schools-types"

export function compareText(first: string, second: string) {
  return first.localeCompare(second, undefined, { sensitivity: "base" })
}

export function compareNumber(first: number, second: number) {
  return first - second
}

export function getProgressRatio(progress: Progress) {
  if (progress.total === 0) {
    return 0
  }

  return progress.completed / progress.total
}

export function compareProgress(first: Progress, second: Progress) {
  const ratioComparison = compareNumber(
    getProgressRatio(first),
    getProgressRatio(second)
  )

  if (ratioComparison !== 0) {
    return ratioComparison
  }

  const completedComparison = compareNumber(first.completed, second.completed)

  if (completedComparison !== 0) {
    return completedComparison
  }

  return compareNumber(first.total, second.total)
}

export function compareSchoolsByColumn(
  first: School,
  second: School,
  columnId: ColumnId
) {
  if (columnId === "school") {
    return compareText(first.schoolName, second.schoolName)
  }

  if (columnId === "status") {
    return compareNumber(
      statusSortRank[first.status],
      statusSortRank[second.status]
    )
  }

  if (columnId === "listType") {
    return compareNumber(
      listTypeSortRank[first.listType],
      listTypeSortRank[second.listType]
    )
  }

  if (columnId === "round") {
    return compareNumber(
      roundSortRank[first.round],
      roundSortRank[second.round]
    )
  }

  if (columnId === "nextDeadline") {
    return compareNumber(
      getDeadlineTime(first.deadline),
      getDeadlineTime(second.deadline),
    )
  }

  if (columnId === "progress") {
    return compareProgress(first.progress, second.progress)
  }

  return compareProgress(first.essays, second.essays)
}

export function sortSchools(schoolsToSort: School[], sortState: SortState) {
  const direction = sortState.direction === "asc" ? 1 : -1

  return [...schoolsToSort].sort((first, second) => {
    const columnComparison =
      compareSchoolsByColumn(first, second, sortState.columnId) * direction

    if (columnComparison !== 0) {
      return columnComparison
    }

    return compareText(first.schoolName, second.schoolName)
  })
}
