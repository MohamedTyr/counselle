import type { DragEvent } from "react"

import { calendarDragMimeType } from "@/features/calendar/calendar-config"
import type { CalendarDragPayload } from "@/features/calendar/calendar-types"

const draggableEventKinds = new Set(["task_due", "task_work"])

function isCalendarDragKind(
  value: unknown
): value is CalendarDragPayload["kind"] {
  return typeof value === "string" && draggableEventKinds.has(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function parseCalendarDragPayload(
  rawPayload: string
): CalendarDragPayload | undefined {
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

  if (!isCalendarDragKind(payload.kind) || !isNonEmptyString(payload.taskId)) {
    return undefined
  }

  return {
    kind: payload.kind,
    taskId: payload.taskId,
  }
}

export function getDropDateKey(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return undefined
  }

  return target.closest<HTMLElement>(".sx__month-grid-day[data-date]")?.dataset
    .date
}

export function getCalendarDragPayload(event: DragEvent<HTMLElement>) {
  const rawPayload = event.dataTransfer.getData(calendarDragMimeType)

  if (!rawPayload) {
    return undefined
  }

  return parseCalendarDragPayload(rawPayload)
}
