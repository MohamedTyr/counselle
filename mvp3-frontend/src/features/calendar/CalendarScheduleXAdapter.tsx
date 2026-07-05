import { ScheduleXCalendar } from "@schedule-x/react"
import {
  createCalendar,
  createViewList,
  createViewMonthGrid,
} from "@schedule-x/calendar"
import { useMemo, type DragEvent } from "react"

import type { CounselleCalendarEvent } from "@/domain/calendar"
import { todayDate } from "@/domain/time"
import { calendarDragMimeType } from "@/features/calendar/calendar-config"
import {
  getDateKey,
  plainDateFromDateKey,
} from "@/features/calendar/calendar-dates"
import type { CalendarDragPayload } from "@/features/calendar/calendar-types"
import { cn } from "@/lib/utils"

function CalendarEventChip({
  calendarEvent,
}: {
  calendarEvent: CounselleCalendarEvent
}) {
  const draggableKind =
    calendarEvent.kind === "task_due" || calendarEvent.kind === "task_work"
      ? calendarEvent.kind
      : undefined
  const isDraggable =
    Boolean(calendarEvent.taskId) &&
    Boolean(draggableKind) &&
    !calendarEvent.isDone

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (!isDraggable || !calendarEvent.taskId || !draggableKind) {
      event.preventDefault()
      return
    }

    const payload: CalendarDragPayload = {
      kind: draggableKind,
      taskId: calendarEvent.taskId,
    }

    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(calendarDragMimeType, JSON.stringify(payload))
  }

  return (
    <div
      className={cn(
        "calendar-sx-event-card",
        `calendar-sx-event-card--${calendarEvent.kind}`,
        calendarEvent.isDone && "is-done"
      )}
      draggable={isDraggable}
      onDragStart={handleDragStart}
    >
      <span className="calendar-sx-event-card-title">
        {calendarEvent.title}
      </span>
      <span className="calendar-sx-event-card-subtitle">
        {calendarEvent.subtitle}
      </span>
    </div>
  )
}

function CalendarMonthDate({
  date,
  hardDeadlineCounts,
  jsDate,
}: {
  date: number
  hardDeadlineCounts: Record<string, number>
  jsDate: Date
}) {
  const dateKey = getDateKey(jsDate)
  const hardCount = hardDeadlineCounts[dateKey] ?? 0

  return (
    <div
      className={cn(
        "calendar-sx-date-label",
        dateKey === getDateKey(todayDate) && "is-today"
      )}
    >
      <span>{date}</span>
      {hardCount > 0 && (
        <span
          aria-label={`${hardCount} hard deadline${hardCount === 1 ? "" : "s"}`}
          className="calendar-sx-hard-dot"
        >
          {hardCount}
        </span>
      )}
    </div>
  )
}

export function CalendarScheduleXAdapter({
  calendarDateKey,
  events,
  hardDeadlineCounts,
  isMobile,
  onSelectDate,
}: {
  calendarDateKey: string
  events: CounselleCalendarEvent[]
  hardDeadlineCounts: Record<string, number>
  isMobile: boolean
  onSelectDate: (dateKey: string) => void
}) {
  const customComponents = useMemo(
    () => ({
      monthGridDate: (props: { date: number; jsDate: Date }) => (
        <CalendarMonthDate
          date={props.date}
          hardDeadlineCounts={hardDeadlineCounts}
          jsDate={props.jsDate}
        />
      ),
      monthGridEvent: (props: { calendarEvent: CounselleCalendarEvent }) => (
        <CalendarEventChip calendarEvent={props.calendarEvent} />
      ),
    }),
    [hardDeadlineCounts]
  )
  const calendarApp = useMemo(() => {
    return createCalendar({
      calendars: {
        due: {
          colorName: "due",
          lightColors: {
            container: "#292318",
            main: "#b88a35",
            onContainer: "#f4efe4",
          },
          darkColors: {
            container: "#292318",
            main: "#b88a35",
            onContainer: "#f4efe4",
          },
        },
        hard: {
          colorName: "hard",
          lightColors: {
            container: "#2a1919",
            main: "#b85b52",
            onContainer: "#f6eeee",
          },
          darkColors: {
            container: "#2a1919",
            main: "#b85b52",
            onContainer: "#f6eeee",
          },
        },
        work: {
          colorName: "work",
          lightColors: {
            container: "#1f2422",
            main: "#7c907f",
            onContainer: "#eef4ef",
          },
          darkColors: {
            container: "#1f2422",
            main: "#7c907f",
            onContainer: "#eef4ef",
          },
        },
      },
      callbacks: {
        onClickDate(date) {
          onSelectDate(date.toString())
        },
        onClickPlusEvents(date) {
          onSelectDate(date.toString())
        },
        onEventClick(event) {
          onSelectDate((event as CounselleCalendarEvent).dateKey)
        },
      },
      defaultView: isMobile ? "list" : "month-grid",
      events,
      firstDayOfWeek: 7,
      isDark: true,
      isResponsive: false,
      monthGridOptions: {
        nEventsPerDay: 2,
      },
      selectedDate: plainDateFromDateKey(calendarDateKey),
      views: [createViewMonthGrid(), createViewList()],
    })
  }, [calendarDateKey, events, isMobile, onSelectDate])

  return (
    <ScheduleXCalendar
      calendarApp={calendarApp}
      customComponents={customComponents}
    />
  )
}
