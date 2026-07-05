import type { CalendarMode } from "@/domain/calendar"

export function CalendarModeDot({ mode }: { mode: CalendarMode }) {
  return <span className="calendar-mode-dot" data-calendar-mode={mode} />
}
