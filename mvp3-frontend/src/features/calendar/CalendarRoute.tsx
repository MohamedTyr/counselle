import { useMemo, useRef, useState, type DragEvent } from "react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import type { CalendarMode, CalendarSurfaceView } from "@/domain/calendar"
import type { Task } from "@/domain/task"
import { createTimestamp, todayDate } from "@/domain/time"
import { CalendarDayPanel } from "@/features/calendar/CalendarDayPanel"
import { CalendarModeDot } from "@/features/calendar/CalendarModeDot"
import { CalendarScheduleXAdapter } from "@/features/calendar/CalendarScheduleXAdapter"
import { CalendarTimeGridAdapter } from "@/features/calendar/CalendarTimeGridAdapter"
import {
  calendarDragMimeType,
  calendarModes,
  modeMeta,
} from "@/features/calendar/calendar-config"
import {
  addDays,
  addMonths,
  dateKeyToDate,
  formatMonthTitle,
  getDateKey,
  mergeDateWithExistingTime,
  mergeDateWithTargetTime,
} from "@/features/calendar/calendar-dates"
import {
  getCalendarDragPayload,
  getDropDateKey,
} from "@/features/calendar/calendar-drag"
import {
  getDeadlinesWithoutPlannedWork,
  getHardDeadlineCounts,
} from "@/features/calendar/calendar-deadlines"
import {
  getCalendarModeCounts,
  getModeEvents,
  getTimeGridEvents,
} from "@/features/calendar/calendar-events"
import type {
  CalendarPageProps,
  CalendarTaskDateField,
  CalendarTimeGridDropTarget,
} from "@/features/calendar/calendar-types"
import { hardDeadlines } from "@/fixtures/calendar"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListChecks,
} from "lucide-react"

import "@/features/calendar/calendar.css"
import "@/features/calendar/calendar-time-grid.css"

export function CalendarPage({ tasks, onTasksChange }: CalendarPageProps) {
  const isMobile = useIsMobile()
  const dropTargetRef = useRef<HTMLElement | null>(null)
  const demoTodayDateKey = getDateKey(todayDate)
  const [mode, setMode] = useState<CalendarMode>("hard_deadlines")
  const [surfaceView, setSurfaceView] = useState<CalendarSurfaceView>("month")
  const [selectedDateKey, setSelectedDateKey] = useState(demoTodayDateKey)
  const [calendarDateKey, setCalendarDateKey] = useState(demoTodayDateKey)
  const [timeGridStartDateKey, setTimeGridStartDateKey] =
    useState(demoTodayDateKey)
  const [timeGridDayCount, setTimeGridDayCount] = useState(9)
  const [showDoneDueTasks, setShowDoneDueTasks] = useState(false)
  const selectedDate = dateKeyToDate(selectedDateKey)
  const calendarDate = dateKeyToDate(calendarDateKey)
  const timeGridStartDate = dateKeyToDate(timeGridStartDateKey)
  const selectedHardDeadlines = hardDeadlines.filter(
    (deadline) => getDateKey(deadline.deadline_at) === selectedDateKey
  )
  const selectedDueTasks = tasks.filter(
    (task) =>
      task.due_at &&
      getDateKey(task.due_at) === selectedDateKey &&
      (showDoneDueTasks || task.status !== "done")
  )
  const selectedWorkTasks = tasks.filter(
    (task) =>
      task.planned_for && getDateKey(task.planned_for) === selectedDateKey
  )
  const needsPlanningTasks = tasks.filter(
    (task) => task.due_at && !task.planned_for && task.status !== "done"
  )
  const selectedWarningDeadlines = getDeadlinesWithoutPlannedWork(
    selectedHardDeadlines,
    tasks
  )
  const hardDeadlineCounts = useMemo(
    () => getHardDeadlineCounts(hardDeadlines),
    []
  )
  const modeCounts = getCalendarModeCounts({
    deadlines: hardDeadlines,
    showDoneDueTasks,
    tasks,
  })
  const events = useMemo(
    () =>
      getModeEvents({
        deadlines: hardDeadlines,
        mode,
        showDoneDueTasks,
        tasks,
      }),
    [mode, showDoneDueTasks, tasks]
  )
  const timeGridEvents = useMemo(
    () => getTimeGridEvents({ deadlines: hardDeadlines, tasks }),
    [tasks]
  )

  function selectDate(dateKey: string) {
    setSelectedDateKey(dateKey)
    setCalendarDateKey(dateKey)
  }

  function updateTaskDate(
    taskId: string,
    field: CalendarTaskDateField,
    value: string
  ) {
    const timestamp = createTimestamp()
    onTasksChange((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              [field]: value,
              updated_at: timestamp,
            }
          : task
      )
    )
  }

  function clearDropTarget() {
    dropTargetRef.current?.classList.remove("calendar-sx-drop-target")
    dropTargetRef.current = null
  }

  function handleCalendarDragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes(calendarDragMimeType)) {
      return
    }

    const dayElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>(".sx__month-grid-day[data-date]")
        : null

    if (!dayElement) {
      clearDropTarget()
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"

    if (dropTargetRef.current !== dayElement) {
      clearDropTarget()
      dayElement.classList.add("calendar-sx-drop-target")
      dropTargetRef.current = dayElement
    }
  }

  function handleCalendarDrop(event: DragEvent<HTMLElement>) {
    const dropDateKey = getDropDateKey(event.target)
    const payload = getCalendarDragPayload(event)
    clearDropTarget()

    if (!dropDateKey || !payload) {
      return
    }

    const task = tasks.find((candidate) => candidate.id === payload.taskId)

    if (!task) {
      return
    }

    event.preventDefault()
    const dropDate = dateKeyToDate(dropDateKey)

    if (payload.kind === "task_due") {
      updateTaskDate(
        task.id,
        "due_at",
        mergeDateWithExistingTime(dropDate, task.due_at, 23, 59)
      )
    } else {
      updateTaskDate(
        task.id,
        "planned_for",
        mergeDateWithExistingTime(dropDate, task.planned_for, 9)
      )
    }

    selectDate(dropDateKey)
  }

  function goToPreviousMonth() {
    const nextDate = addMonths(calendarDate, -1)
    selectDate(getDateKey(nextDate))
  }

  function goToNextMonth() {
    const nextDate = addMonths(calendarDate, 1)
    selectDate(getDateKey(nextDate))
  }

  function goToToday() {
    selectDate(demoTodayDateKey)
  }

  function goToPreviousTimeGridRange() {
    setTimeGridStartDateKey(getDateKey(addDays(timeGridStartDate, -1)))
  }

  function goToNextTimeGridRange() {
    setTimeGridStartDateKey(getDateKey(addDays(timeGridStartDate, 1)))
  }

  function shiftTimeGridRange(dayOffset: number) {
    setTimeGridStartDateKey(getDateKey(addDays(timeGridStartDate, dayOffset)))
  }

  function goToTodayTimeGridRange() {
    setTimeGridStartDateKey(demoTodayDateKey)
  }

  function handleTimeGridEventDrop(
    calendarEvent: Parameters<
      typeof CalendarTimeGridAdapter
    >[0]["events"][number],
    target: CalendarTimeGridDropTarget
  ) {
    if (!calendarEvent.taskId) {
      return
    }

    const task = tasks.find(
      (candidate) => candidate.id === calendarEvent.taskId
    )

    if (!task || task.status === "done") {
      return
    }

    const dropDate = dateKeyToDate(target.dateKey)

    if (calendarEvent.kind === "task_due") {
      updateTaskDate(
        task.id,
        "due_at",
        mergeDateWithTargetTime(
          dropDate,
          task.due_at,
          23,
          59,
          target.placement === "time" ? target.minutes : undefined
        )
      )
    }

    if (calendarEvent.kind === "task_work") {
      updateTaskDate(
        task.id,
        "planned_for",
        mergeDateWithTargetTime(
          dropDate,
          task.planned_for,
          9,
          0,
          target.placement === "time" ? target.minutes : undefined
        )
      )
    }

    selectDate(target.dateKey)
  }

  function planTaskForSelectedDate(task: Task) {
    updateTaskDate(
      task.id,
      "planned_for",
      mergeDateWithExistingTime(selectedDate, task.planned_for, 9)
    )
  }

  if (surfaceView === "time_grid") {
    return (
      <CalendarTimeGridAdapter
        dayCount={timeGridDayCount}
        events={timeGridEvents}
        onDayCountChange={setTimeGridDayCount}
        onEventDrop={handleTimeGridEventDrop}
        onNextRange={goToNextTimeGridRange}
        onPreviousRange={goToPreviousTimeGridRange}
        onReturnToMonth={() => setSurfaceView("month")}
        onShiftRange={shiftTimeGridRange}
        onToday={goToTodayTimeGridRange}
        startDate={timeGridStartDate}
      />
    )
  }

  return (
    <section className="calendar-page relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm text-muted-foreground">Calendar</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {formatMonthTitle(calendarDate)}
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <Tabs
              onValueChange={(value) => setMode(value as CalendarMode)}
              value={mode}
            >
              <TabsList className="w-full flex-wrap justify-start gap-y-1 sm:w-fit">
                {calendarModes.map((modeId) => (
                  <TabsTab
                    className="sm:h-7 sm:px-2 sm:text-xs"
                    key={modeId}
                    value={modeId}
                  >
                    <CalendarModeDot mode={modeId} />
                    <span className="hidden sm:inline">
                      {modeMeta[modeId].label}
                    </span>
                    <span className="sm:hidden">
                      {modeMeta[modeId].shortLabel}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {modeCounts[modeId]}
                    </span>
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-1.5">
              <Button
                aria-label="Previous month"
                onClick={goToPreviousMonth}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                onClick={goToToday}
                size="sm"
                type="button"
                variant="outline"
              >
                <CalendarDays aria-hidden="true" data-icon="inline-start" />
                Today
              </Button>
              <Button
                onClick={() => {
                  setTimeGridStartDateKey(demoTodayDateKey)
                  setSurfaceView("time_grid")
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <CalendarDays aria-hidden="true" data-icon="inline-start" />9
                days
              </Button>
              <Button
                aria-label="Next month"
                onClick={goToNextMonth}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div className="calendar-layout">
          <div
            className="calendar-main-surface calendar-sx"
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                clearDropTarget()
              }
            }}
            onDragOver={handleCalendarDragOver}
            onDrop={handleCalendarDrop}
          >
            {mode === "task_due_dates" && (
              <div className="mb-3 flex justify-end px-1">
                <Button
                  onClick={() => setShowDoneDueTasks((current) => !current)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <ListChecks aria-hidden="true" data-icon="inline-start" />
                  {showDoneDueTasks ? "Hide done" : "Show done"}
                </Button>
              </div>
            )}

            <CalendarScheduleXAdapter
              calendarDateKey={calendarDateKey}
              events={events}
              hardDeadlineCounts={hardDeadlineCounts}
              isMobile={isMobile}
              onSelectDate={selectDate}
            />
          </div>

          <CalendarDayPanel
            mode={mode}
            needsPlanningTasks={needsPlanningTasks}
            onPlanTask={planTaskForSelectedDate}
            selectedDate={selectedDate}
            selectedDueTasks={selectedDueTasks}
            selectedHardDeadlines={selectedHardDeadlines}
            selectedWarningDeadlines={selectedWarningDeadlines}
            selectedWorkTasks={selectedWorkTasks}
          />
        </div>
      </div>
    </section>
  )
}
