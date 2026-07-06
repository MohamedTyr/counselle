import type { DeadlineUrgency } from "@/domain/school"

const DAY_MS = 24 * 60 * 60 * 1000

function dateOnlyUtcTime(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function getDeadlineTime(deadline: string | null) {
  if (!deadline) {
    return Number.POSITIVE_INFINITY
  }

  const time = Date.parse(`${deadline}T00:00:00Z`)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

export function formatDeadline(deadline: string | null) {
  const time = getDeadlineTime(deadline)

  if (!Number.isFinite(time)) {
    return "No deadline"
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(time))
}

export function getDeadlineUrgency(
  deadline: string | null,
  referenceDate = new Date(),
): DeadlineUrgency {
  const deadlineTime = getDeadlineTime(deadline)

  if (!Number.isFinite(deadlineTime)) {
    return "normal"
  }

  const daysUntil = Math.ceil(
    (deadlineTime - dateOnlyUtcTime(referenceDate)) / DAY_MS,
  )

  if (daysUntil < 0) {
    return "normal"
  }

  if (daysUntil <= 14) {
    return "close"
  }

  if (daysUntil <= 60) {
    return "upcoming"
  }

  return "normal"
}
