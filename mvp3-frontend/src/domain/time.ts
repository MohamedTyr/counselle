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
