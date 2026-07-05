"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getDemoNowDate } from "@/domain/time"
import { cn } from "@/lib/utils"
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelRight,
} from "lucide-react"
import { motion } from "motion/react"
import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type WheelEvent,
} from "react"

export type CalendarTimeGridEventKind =
  "hard_deadline" | "task_due" | "task_work"

export type CalendarTimeGridEvent = {
  id: string
  title: string
  date: string
  kind: CalendarTimeGridEventKind
  allDay?: boolean
  endMinutes?: number
  meta?: string
  startMinutes?: number
  taskId?: string
}

type CalendarTimeGridProps = {
  dayCount: number
  events: CalendarTimeGridEvent[]
  onDayCountChange: (dayCount: number) => void
  onEventDrop: (
    event: CalendarTimeGridEvent,
    target: {
      dateKey: string
      minutes?: number
      placement: "all_day" | "time"
    }
  ) => void
  onNextRange: () => void
  onPreviousRange: () => void
  onReturnToMonth: () => void
  onShiftRange: (dayOffset: number) => void
  onToday: () => void
  startDate: Date
}

type DayModel = {
  date: Date
  dateKey: string
  dayNumber: number
  isToday: boolean
  weekday: string
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const localTimeZoneLabel = "GMT+3"
const referenceTimeZoneLabel = "PDT"
const referenceOffsetHours = -10
const startMinutes = 8 * 60
const endMinutes = 24 * 60
const hourHeight = 48
const minimumEventHeight = 44
const snapMinutes = 15
const dayCountOptions = [1, 3, 5, 7, 9, 14]
const timeGridDragMimeType = "application/counselle-time-grid-event"

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function getDateKey(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
    value.getDate()
  )}`
}

function addDays(value: Date, amount: number) {
  const nextDate = new Date(value)
  nextDate.setDate(nextDate.getDate() + amount)
  return nextDate
}

function getMonthTitle(value: Date) {
  return value.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

function formatHour(totalMinutes: number) {
  const wrappedMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour = Math.floor(wrappedMinutes / 60)
  const suffix = hour >= 12 ? "PM" : "AM"
  const hour12 = hour % 12 || 12

  return `${hour12}${suffix}`
}

function getEventTop(minutes: number) {
  return ((minutes - startMinutes) / 60) * hourHeight
}

function getEventHeight(event: CalendarTimeGridEvent) {
  const eventStart = event.startMinutes ?? startMinutes
  const eventEnd = event.endMinutes ?? eventStart + 60
  const rawHeight = ((eventEnd - eventStart) / 60) * hourHeight

  return Math.max(minimumEventHeight, rawHeight)
}

function getClampedMinutes(minutes: number) {
  return Math.min(endMinutes, Math.max(startMinutes, minutes))
}

function getSnappedMinutes(minutes: number) {
  return getClampedMinutes(Math.round(minutes / snapMinutes) * snapMinutes)
}

function getMinutesFromPointer(event: DragEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  const pointerOffset = event.clientY - rect.top
  return getSnappedMinutes(startMinutes + (pointerOffset / hourHeight) * 60)
}

function parseTimeGridDragPayload(rawPayload: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawPayload)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined
  }

  const payload = parsed as Record<string, unknown>

  if (typeof payload.eventId !== "string" || payload.eventId.length === 0) {
    return undefined
  }

  return { eventId: payload.eventId }
}

function getDragPayload(event: DragEvent<HTMLElement>) {
  const rawPayload = event.dataTransfer.getData(timeGridDragMimeType)

  if (!rawPayload) {
    return undefined
  }

  return parseTimeGridDragPayload(rawPayload)
}

function isTaskEvent(event: CalendarTimeGridEvent) {
  return Boolean(event.taskId) && event.kind !== "hard_deadline"
}

function getDays(startDate: Date, dayCount: number): DayModel[] {
  const todayKey = getDateKey(getDemoNowDate())

  return Array.from({ length: dayCount }).map((_, index) => {
    const date = addDays(startDate, index)

    return {
      date,
      dateKey: getDateKey(date),
      dayNumber: date.getDate(),
      isToday: getDateKey(date) === todayKey,
      weekday: dayNames[date.getDay()],
    }
  })
}

export function CalendarTimeGrid({
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
}: CalendarTimeGridProps) {
  const [dragOverAllDayKey, setDragOverAllDayKey] = useState<string | null>(
    null
  )
  const [dropPreview, setDropPreview] = useState<{
    dateKey: string
    minutes: number
  } | null>(null)
  const wheelNavigationRef = useRef({ lastShiftAt: 0, remainder: 0 })
  const days = getDays(startDate, dayCount)
  const hours = Array.from(
    { length: (endMinutes - startMinutes) / 60 + 1 },
    (_, index) => startMinutes + index * 60
  )
  const bodyHeight = ((endMinutes - startMinutes) / 60) * hourHeight
  const now = getDemoNowDate()
  const nowDateKey = getDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNowLine =
    days.some((day) => day.dateKey === nowDateKey) &&
    nowMinutes >= startMinutes &&
    nowMinutes <= endMinutes
  const nowTop = getEventTop(nowMinutes)
  const eventsByDay = days.reduce<Record<string, CalendarTimeGridEvent[]>>(
    (map, day) => ({
      ...map,
      [day.dateKey]: events.filter((event) => event.date === day.dateKey),
    }),
    {}
  )
  const eventsById = events.reduce<Record<string, CalendarTimeGridEvent>>(
    (map, event) => ({ ...map, [event.id]: event }),
    {}
  )

  function clearDropState() {
    setDragOverAllDayKey(null)
    setDropPreview(null)
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX
    const isHorizontalIntent =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)

    if (!isHorizontalIntent || horizontalDelta === 0) {
      return
    }

    const navigation = wheelNavigationRef.current
    const now = window.performance.now()
    navigation.remainder += horizontalDelta

    if (
      Math.abs(navigation.remainder) < 90 ||
      now - navigation.lastShiftAt < 180
    ) {
      return
    }

    onShiftRange(navigation.remainder > 0 ? 1 : -1)
    navigation.remainder = 0
    navigation.lastShiftAt = now
  }

  function handleEventDragStart(
    event: DragEvent<HTMLElement>,
    calendarEvent: CalendarTimeGridEvent
  ) {
    if (!isTaskEvent(calendarEvent)) {
      event.preventDefault()
      return
    }

    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(
      timeGridDragMimeType,
      JSON.stringify({ eventId: calendarEvent.id })
    )
  }

  function handleAllDayDragOver(
    event: DragEvent<HTMLDivElement>,
    dateKey: string
  ) {
    if (!event.dataTransfer.types.includes(timeGridDragMimeType)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDropPreview(null)
    setDragOverAllDayKey(dateKey)
  }

  function handleAllDayDrop(event: DragEvent<HTMLDivElement>, dateKey: string) {
    const payload = getDragPayload(event)
    const draggedEvent = payload ? eventsById[payload.eventId] : undefined
    clearDropState()

    if (!draggedEvent) {
      return
    }

    event.preventDefault()
    onEventDrop(draggedEvent, { dateKey, placement: "all_day" })
  }

  function handleTimeDragOver(
    event: DragEvent<HTMLDivElement>,
    dateKey: string
  ) {
    if (!event.dataTransfer.types.includes(timeGridDragMimeType)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDragOverAllDayKey(null)
    setDropPreview({ dateKey, minutes: getMinutesFromPointer(event) })
  }

  function handleTimeDrop(event: DragEvent<HTMLDivElement>, dateKey: string) {
    const payload = getDragPayload(event)
    const draggedEvent = payload ? eventsById[payload.eventId] : undefined
    const minutes = getMinutesFromPointer(event)
    clearDropState()

    if (!draggedEvent) {
      return
    }

    event.preventDefault()
    onEventDrop(draggedEvent, { dateKey, minutes, placement: "time" })
  }

  return (
    <section className="calendar-time-grid">
      <header className="calendar-time-grid-header">
        <h2>{getMonthTitle(startDate)}</h2>
        <div className="calendar-time-grid-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" type="button" variant="outline">
                {dayCount} {dayCount === 1 ? "day" : "days"}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-28">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  onValueChange={(value) => onDayCountChange(Number(value))}
                  value={String(dayCount)}
                >
                  {dayCountOptions.map((option) => (
                    <DropdownMenuRadioItem key={option} value={String(option)}>
                      {option} {option === 1 ? "day" : "days"}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={onToday} size="xs" type="button" variant="outline">
            <CalendarDays data-icon="inline-start" />
            Today
          </Button>
          <Button
            aria-label="Previous date range"
            onClick={onPreviousRange}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            aria-label="Next date range"
            onClick={onNextRange}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            aria-label="Return to month view"
            onClick={onReturnToMonth}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="calendar-time-grid-scroll" onWheel={handleWheel}>
        <div
          className="calendar-time-grid-canvas"
          style={
            {
              "--calendar-time-grid-columns": dayCount,
              "--calendar-time-grid-height": `${bodyHeight}px`,
              "--calendar-time-grid-min-width": `${104 + dayCount * 154}px`,
            } as CSSProperties
          }
        >
          <div className="calendar-time-grid-days">
            <div className="calendar-time-grid-timezone-row">
              <span>+</span>
              <span>{referenceTimeZoneLabel}</span>
              <span>{localTimeZoneLabel}</span>
            </div>
            {days.map((day) => (
              <div className="calendar-time-grid-day-head" key={day.dateKey}>
                <span>{day.weekday}</span>
                <span
                  className={cn(
                    "calendar-time-grid-day-number",
                    day.isToday && "is-today"
                  )}
                >
                  {day.dayNumber}
                </span>
              </div>
            ))}
          </div>

          <div className="calendar-time-grid-all-day">
            <div className="calendar-time-grid-all-day-label">All-day</div>
            {days.map((day) => {
              const dayEvents = (eventsByDay[day.dateKey] ?? []).filter(
                (event) => event.allDay
              )

              return (
                <div
                  className={cn(
                    "calendar-time-grid-all-day-cell",
                    dragOverAllDayKey === day.dateKey && "is-drop-target"
                  )}
                  key={day.dateKey}
                  onDragLeave={() => setDragOverAllDayKey(null)}
                  onDragOver={(event) =>
                    handleAllDayDragOver(event, day.dateKey)
                  }
                  onDrop={(event) => handleAllDayDrop(event, day.dateKey)}
                >
                  {dayEvents.slice(0, 2).map((event) => (
                    <div
                      className="calendar-time-grid-all-day-chip"
                      data-kind={event.kind}
                      draggable={isTaskEvent(event)}
                      key={event.id}
                      onDragEnd={clearDropState}
                      onDragStart={(dragEvent) =>
                        handleEventDragStart(dragEvent, event)
                      }
                      title={event.title}
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <div className="calendar-time-grid-body">
            <div className="calendar-time-grid-time-rail">
              {hours.slice(0, -1).map((minutes) => (
                <div
                  className="calendar-time-grid-hour-label"
                  key={minutes}
                  style={{ top: getEventTop(minutes) }}
                >
                  <span>{formatHour(minutes + referenceOffsetHours * 60)}</span>
                  <span>{formatHour(minutes)}</span>
                </div>
              ))}
            </div>

            <div className="calendar-time-grid-slots">
              {hours.map((minutes) => (
                <div
                  className="calendar-time-grid-horizontal-line"
                  key={minutes}
                  style={{ top: getEventTop(minutes) }}
                />
              ))}

              {days.map((day, dayIndex) => (
                <div
                  className="calendar-time-grid-day-column"
                  key={day.dateKey}
                  onDragLeave={() => setDropPreview(null)}
                  onDragOver={(event) => handleTimeDragOver(event, day.dateKey)}
                  onDrop={(event) => handleTimeDrop(event, day.dateKey)}
                  style={
                    {
                      "--calendar-time-grid-day-index": dayIndex,
                    } as CSSProperties
                  }
                >
                  {(eventsByDay[day.dateKey] ?? [])
                    .filter((event) => !event.allDay)
                    .map((event, eventIndex) => {
                      const eventStart = getClampedMinutes(
                        event.startMinutes ?? startMinutes
                      )

                      return (
                        <motion.div
                          animate={{ opacity: 1, y: 0 }}
                          className="calendar-time-grid-event"
                          data-kind={event.kind}
                          draggable={isTaskEvent(event)}
                          initial={{ opacity: 0, y: 4 }}
                          key={event.id}
                          onDragEnd={clearDropState}
                          onDragStartCapture={(dragEvent) =>
                            handleEventDragStart(dragEvent, event)
                          }
                          style={
                            {
                              "--calendar-time-grid-event-height": `${getEventHeight(
                                event
                              )}px`,
                              "--calendar-time-grid-event-offset": `${eventIndex * 5}px`,
                              "--calendar-time-grid-event-top": `${getEventTop(
                                eventStart
                              )}px`,
                            } as CSSProperties
                          }
                          transition={{ duration: 0.16, ease: "easeOut" }}
                        >
                          <span>{event.title}</span>
                          {event.meta && <small>{event.meta}</small>}
                        </motion.div>
                      )
                    })}
                  {dropPreview?.dateKey === day.dateKey && (
                    <div
                      className="calendar-time-grid-drop-marker"
                      style={{ top: getEventTop(dropPreview.minutes) }}
                    >
                      <span>{formatHour(dropPreview.minutes)}</span>
                    </div>
                  )}
                </div>
              ))}

              {showNowLine && (
                <div
                  className="calendar-time-grid-now-line"
                  style={{ top: nowTop }}
                >
                  <span>
                    {now.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default CalendarTimeGrid
