import {
  CalendarTimeGrid,
  type CalendarTimeGridEvent,
} from "@/components/ruixen/calendar-time-grid"
import type { CalendarTimeGridDropTarget } from "@/features/calendar/calendar-types"

export function CalendarTimeGridAdapter({
  dayCount,
  events,
  onDayCountChange,
  onEventDrop,
  onNextRange,
  onPreviousRange,
  onReturnToMonth,
  onShiftRange,
  onToday,
  startDate,
}: {
  dayCount: number
  events: CalendarTimeGridEvent[]
  onDayCountChange: (dayCount: number) => void
  onEventDrop: (
    calendarEvent: CalendarTimeGridEvent,
    target: CalendarTimeGridDropTarget
  ) => void
  onNextRange: () => void
  onPreviousRange: () => void
  onReturnToMonth: () => void
  onShiftRange: (dayOffset: number) => void
  onToday: () => void
  startDate: Date
}) {
  return (
    <section className="calendar-page relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 md:p-3">
        <CalendarTimeGrid
          dayCount={dayCount}
          events={events}
          onDayCountChange={onDayCountChange}
          onEventDrop={onEventDrop}
          onNextRange={onNextRange}
          onPreviousRange={onPreviousRange}
          onReturnToMonth={onReturnToMonth}
          onShiftRange={onShiftRange}
          onToday={onToday}
          startDate={startDate}
        />
      </div>
    </section>
  )
}
