import type { CalendarTimeGridEvent } from "@/components/ruixen/calendar-time-grid"
import type {
  CalendarMode,
  CounselleCalendarEvent,
  HardDeadline,
} from "@/domain/calendar"
import type { Task } from "@/domain/task"
import {
  categoryLabel,
  deadlineKindLabel,
} from "@/features/calendar/calendar-config"
import {
  formatEventTime,
  formatShortDate,
  getDateKey,
  getMinutesFromTimestamp,
  makeEventDate,
} from "@/features/calendar/calendar-dates"

export function getModeEvents({
  deadlines,
  mode,
  showDoneDueTasks,
  tasks,
}: {
  deadlines: HardDeadline[]
  mode: CalendarMode
  showDoneDueTasks: boolean
  tasks: Task[]
}): CounselleCalendarEvent[] {
  if (mode === "hard_deadlines") {
    return deadlines.map((deadline) => {
      const dateKey = getDateKey(deadline.deadline_at)

      return {
        id: `hard-${deadline.id}`,
        title: deadline.title,
        start: makeEventDate(dateKey),
        end: makeEventDate(dateKey),
        calendarId: "hard",
        kind: "hard_deadline",
        dateKey,
        deadlineId: deadline.id,
        deadlineKind: deadline.kind,
        schoolName: deadline.school_name,
        sourceLabel: deadline.source_label,
        subtitle: deadlineKindLabel[deadline.kind],
        _options: {
          disableDND: true,
          additionalClasses: ["calendar-sx-event--hard"],
        },
      }
    })
  }

  if (mode === "task_due_dates") {
    return tasks
      .filter(
        (task) => task.due_at && (showDoneDueTasks || task.status !== "done")
      )
      .map((task) => {
        const dateKey = getDateKey(task.due_at as string)

        return {
          id: `due-${task.id}`,
          title: task.title,
          start: makeEventDate(dateKey),
          end: makeEventDate(dateKey),
          calendarId: "due",
          kind: "task_due",
          dateKey,
          taskId: task.id,
          category: task.category,
          priority: task.priority,
          isDone: task.status === "done",
          subtitle: `Due ${formatShortDate(task.due_at as string)}`,
          _options: {
            disableDND: task.status === "done",
            additionalClasses: ["calendar-sx-event--due"],
          },
        }
      })
  }

  return tasks
    .filter((task) => task.planned_for)
    .map((task) => {
      const dateKey = getDateKey(task.planned_for as string)

      return {
        id: `work-${task.id}`,
        title: task.title,
        start: makeEventDate(dateKey),
        end: makeEventDate(dateKey),
        calendarId: "work",
        kind: "task_work",
        dateKey,
        taskId: task.id,
        category: task.category,
        priority: task.priority,
        isDone: task.status === "done",
        subtitle: formatEventTime(task.planned_for) ?? "Work",
        _options: {
          disableDND: task.status === "done",
          additionalClasses: ["calendar-sx-event--work"],
        },
      }
    })
}

export function getTimeGridEvents({
  deadlines,
  tasks,
}: {
  deadlines: HardDeadline[]
  tasks: Task[]
}): CalendarTimeGridEvent[] {
  const hardDeadlineEvents: CalendarTimeGridEvent[] = deadlines.map(
    (deadline) => ({
      allDay: true,
      date: getDateKey(deadline.deadline_at),
      id: `time-hard-${deadline.id}`,
      kind: "hard_deadline",
      meta: deadlineKindLabel[deadline.kind],
      title: deadline.title,
    })
  )

  const dueEvents: CalendarTimeGridEvent[] = tasks
    .filter((task) => task.due_at)
    .map((task) => ({
      allDay: true,
      date: getDateKey(task.due_at as string),
      id: `time-due-${task.id}`,
      kind: "task_due",
      meta: `Due ${formatShortDate(task.due_at as string)}`,
      taskId: task.status === "done" ? undefined : task.id,
      title: task.title,
    }))

  const workEvents: CalendarTimeGridEvent[] = tasks
    .filter((task) => task.planned_for)
    .map((task) => {
      const startMinutes = getMinutesFromTimestamp(task.planned_for as string)

      return {
        date: getDateKey(task.planned_for as string),
        endMinutes: startMinutes + 60,
        id: `time-work-${task.id}`,
        kind: "task_work",
        meta: formatEventTime(task.planned_for) ?? categoryLabel[task.category],
        startMinutes,
        taskId: task.status === "done" ? undefined : task.id,
        title: task.title,
      }
    })

  return [...hardDeadlineEvents, ...dueEvents, ...workEvents]
}

export function getCalendarModeCounts({
  deadlines,
  showDoneDueTasks,
  tasks,
}: {
  deadlines: HardDeadline[]
  showDoneDueTasks: boolean
  tasks: Task[]
}): Record<CalendarMode, number> {
  return {
    hard_deadlines: deadlines.length,
    task_due_dates: tasks.filter(
      (task) => task.due_at && (showDoneDueTasks || task.status !== "done")
    ).length,
    work_plan: tasks.filter((task) => task.planned_for).length,
  }
}
