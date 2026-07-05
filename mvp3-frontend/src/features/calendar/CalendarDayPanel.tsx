import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { CalendarMode, HardDeadline } from "@/domain/calendar"
import type { Task } from "@/domain/task"
import { CalendarModeDot } from "@/features/calendar/CalendarModeDot"
import {
  categoryLabel,
  deadlineKindLabel,
  priorityLabel,
} from "@/features/calendar/calendar-config"
import {
  formatEventTime,
  formatLongDate,
  formatShortDate,
} from "@/features/calendar/calendar-dates"
import { AlertTriangle, CalendarCheck2, CalendarClock } from "lucide-react"

function DayPanelSection({
  children,
  count,
  mode,
  title,
}: {
  children: ReactNode
  count: number
  mode: CalendarMode
  title: string
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarModeDot mode={mode} />
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      {children}
    </section>
  )
}

function PanelEventRow({
  meta,
  subtitle,
  title,
}: {
  meta?: string
  subtitle: string
  title: string
}) {
  return (
    <div className="calendar-panel-event">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {meta && (
        <Badge className="self-start" size="sm" variant="outline">
          {meta}
        </Badge>
      )}
    </div>
  )
}

function NeedsPlanningRail({
  onPlanTask,
  selectedDate,
  tasks,
}: {
  onPlanTask: (task: Task) => void
  selectedDate: Date
  tasks: Task[]
}) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <section className="calendar-needs-planning">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">
            Needs planning
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Due-dated tasks that still need a work day.
          </p>
        </div>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {tasks.slice(0, 4).map((task) => (
          <div className="calendar-planning-task" key={task.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {task.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Due {formatShortDate(task.due_at as string)}
              </p>
            </div>
            <Button
              onClick={() => onPlanTask(task)}
              size="xs"
              type="button"
              variant="outline"
            >
              <CalendarCheck2 aria-hidden="true" data-icon="inline-start" />
              {formatShortDate(selectedDate)}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

export function CalendarDayPanel({
  mode,
  needsPlanningTasks,
  onPlanTask,
  selectedDate,
  selectedDueTasks,
  selectedHardDeadlines,
  selectedWarningDeadlines,
  selectedWorkTasks,
}: {
  mode: CalendarMode
  needsPlanningTasks: Task[]
  onPlanTask: (task: Task) => void
  selectedDate: Date
  selectedDueTasks: Task[]
  selectedHardDeadlines: HardDeadline[]
  selectedWarningDeadlines: HardDeadline[]
  selectedWorkTasks: Task[]
}) {
  const hasSelectedDayItems =
    selectedHardDeadlines.length > 0 ||
    selectedDueTasks.length > 0 ||
    selectedWorkTasks.length > 0

  return (
    <aside className="calendar-day-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Selected day</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {formatLongDate(selectedDate)}
          </h2>
        </div>
        <Badge variant="outline">
          {selectedHardDeadlines.length +
            selectedDueTasks.length +
            selectedWorkTasks.length}
        </Badge>
      </div>

      {mode === "work_plan" && (
        <NeedsPlanningRail
          onPlanTask={onPlanTask}
          selectedDate={selectedDate}
          tasks={needsPlanningTasks}
        />
      )}

      {selectedWarningDeadlines.map((deadline) => (
        <Alert
          className="calendar-deadline-warning"
          key={deadline.id}
          variant="destructive"
        >
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>No planned work before deadline</AlertTitle>
          <AlertDescription>
            {deadline.title} has no related work scheduled before{" "}
            {formatShortDate(deadline.deadline_at)}.
          </AlertDescription>
        </Alert>
      ))}

      {!hasSelectedDayItems ? (
        <Empty className="min-h-72 px-3 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No dates here</EmptyTitle>
            <EmptyDescription>
              No deadlines, task due dates, or planned work on this day.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-xs text-muted-foreground">
              Click another day or switch modes to scan the month.
            </p>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          <DayPanelSection
            count={selectedHardDeadlines.length}
            mode="hard_deadlines"
            title="Hard deadlines"
          >
            {selectedHardDeadlines.length > 0 ? (
              <div className="flex flex-col gap-2">
                {selectedHardDeadlines.map((deadline) => (
                  <PanelEventRow
                    key={deadline.id}
                    meta={deadlineKindLabel[deadline.kind]}
                    subtitle={[
                      deadline.school_name,
                      deadline.source_label,
                      deadline.verification_status === "verified"
                        ? "Verified"
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    title={deadline.title}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </DayPanelSection>

          <DayPanelSection
            count={selectedDueTasks.length}
            mode="task_due_dates"
            title="Task due dates"
          >
            {selectedDueTasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                {selectedDueTasks.map((task) => (
                  <PanelEventRow
                    key={task.id}
                    meta={priorityLabel[task.priority]}
                    subtitle={`${categoryLabel[task.category]} · ${task.status}`}
                    title={task.title}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </DayPanelSection>

          <DayPanelSection
            count={selectedWorkTasks.length}
            mode="work_plan"
            title="Work plan"
          >
            {selectedWorkTasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                {selectedWorkTasks.map((task) => (
                  <PanelEventRow
                    key={task.id}
                    meta={categoryLabel[task.category]}
                    subtitle={[
                      formatEventTime(task.planned_for),
                      task.status === "done" ? "Done" : "Planned",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    title={task.title}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </DayPanelSection>
        </div>
      )}
    </aside>
  )
}
