import "temporal-polyfill/global"

export function getDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function dateKeyToDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function addMonths(date: Date, amount: number) {
  const nextDate = new Date(date)
  nextDate.setMonth(nextDate.getMonth() + amount, 1)
  return nextDate
}

export function addDays(date: Date, amount: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + amount)
  return nextDate
}

export function startOfLocalDay(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function formatShortDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatLongDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatMonthTitle(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatEventTime(value?: string) {
  if (!value) {
    return undefined
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function mergeDateWithExistingTime(
  nextDate: Date,
  currentValue: string | undefined,
  fallbackHour: number,
  fallbackMinute = 0
) {
  const currentDate = currentValue ? new Date(currentValue) : undefined
  const mergedDate = new Date(nextDate)

  mergedDate.setHours(
    currentDate?.getHours() ?? fallbackHour,
    currentDate?.getMinutes() ?? fallbackMinute,
    0,
    0
  )

  return mergedDate.toISOString()
}

export function mergeDateWithTargetTime(
  nextDate: Date,
  currentValue: string | undefined,
  fallbackHour: number,
  fallbackMinute = 0,
  targetMinutes?: number
) {
  const currentDate = currentValue ? new Date(currentValue) : undefined
  const mergedDate = new Date(nextDate)
  const targetHour =
    typeof targetMinutes === "number"
      ? Math.floor(targetMinutes / 60)
      : currentDate?.getHours()
  const targetMinute =
    typeof targetMinutes === "number"
      ? targetMinutes % 60
      : currentDate?.getMinutes()

  mergedDate.setHours(
    targetHour ?? fallbackHour,
    targetMinute ?? fallbackMinute,
    0,
    0
  )

  return mergedDate.toISOString()
}

export function plainDateFromDateKey(dateKey: string) {
  return Temporal.PlainDate.from(dateKey)
}

export function makeEventDate(dateKey: string) {
  return Temporal.PlainDate.from(dateKey)
}

export function getMinutesFromTimestamp(value: string) {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}
