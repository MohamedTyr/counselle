export const demoNowIso = "2026-07-01T12:00:00"
export const demoTodayIso = demoNowIso
export const demoActivityNowIso = demoNowIso

export const todayDate = new Date(demoTodayIso)

let demoIdSequence = 0

export function getDemoNowDate() {
  return new Date(demoNowIso)
}

export function createTimestamp(date: Date = getDemoNowDate()) {
  return date.toISOString()
}

export function createDemoId(prefix: string) {
  demoIdSequence += 1
  return `${prefix}-${getDemoNowDate().getTime()}-${demoIdSequence}`
}

export function formatRelativeTime(iso: string) {
  const timestamp = new Date(iso).getTime()
  const now = Date.now()
  const diffSeconds = Math.round((timestamp - now) / 1000)
  const absoluteSeconds = Math.abs(diffSeconds)

  const divisions: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ]

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  })

  for (const [unit, secondsInUnit] of divisions) {
    if (absoluteSeconds >= secondsInUnit) {
      return formatter.format(Math.round(diffSeconds / secondsInUnit), unit)
    }
  }

  return formatter.format(diffSeconds, "second")
}
