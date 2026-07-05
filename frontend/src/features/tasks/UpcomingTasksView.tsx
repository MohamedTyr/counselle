import type { KeyboardEvent, MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { Task, TaskStatus } from "@/domain/task";
import { laneThemeClass } from "@/features/tasks/task-config";
import {
  formatPlannedDateLabel,
  getCalendarDayDiff,
  getPlanningDate,
  getPlanningDateLabel,
} from "@/features/tasks/task-dates";
import { updateTaskStatusFromPlanning } from "@/features/tasks/task-mutations";
import type {
  TaskLayoutMode,
  UpcomingGroup,
  UpdateTask,
} from "@/features/tasks/task-types";
import {
  InlineTaskAssigneeBadge,
  InlineTaskCategoryBadge,
  InlineTaskDate,
  InlineTaskNeedsInputBadge,
  InlineTaskPriorityBadge,
  InlineTaskStatusBadge,
  InlineTaskText,
  TaskDueMeta,
} from "@/features/tasks/task-inline-controls";
import { sortPlanningTasks } from "@/features/tasks/task-sort";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import { todayDate } from "@/domain/time";

export function UpcomingDateMeta({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  const plannedFor = task.planned_for;

  if (!plannedFor && !task.due_at) {
    return (
      <span className="ml-auto shrink-0">
        <InlineTaskDate
          ariaLabel={`Set work date for ${task.title}`}
          className="text-xs font-medium text-[color:var(--lane-muted)] tabular-nums"
          defaultHour={9}
          defaultMinute={0}
          field="planned_for"
          onUpdateTask={onUpdateTask}
          task={task}
          value={task.planned_for}
        >
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          No date
        </InlineTaskDate>
      </span>
    );
  }

  return (
    <span className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {plannedFor ? (
        <InlineTaskDate
          ariaLabel={`Change work date for ${task.title}`}
          className="text-xs font-medium text-[color:var(--lane-muted)] tabular-nums"
          defaultHour={9}
          defaultMinute={0}
          field="planned_for"
          onUpdateTask={onUpdateTask}
          task={task}
          value={plannedFor}
        >
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          Work {formatPlannedDateLabel(plannedFor)}
        </InlineTaskDate>
      ) : null}
      <TaskDueMeta onUpdateTask={onUpdateTask} task={task} />
    </span>
  );
}

export function UpcomingTaskItem({
  onOpenTask,
  onUpdateTask,
  task,
}: {
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  function handleStatusClick(
    event: MouseEvent<HTMLButtonElement>,
    status: TaskStatus,
  ) {
    event.stopPropagation();
    updateTaskStatusFromPlanning(task, status, onUpdateTask);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;

    if (
      target.closest("[data-task-editing-field],button,a,input,textarea,select")
    ) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenTask(task.id);
  }

  return (
    <article
      aria-label={`Open ${task.title} details`}
      className={cn(
        laneThemeClass[task.status],
        "group/upcoming grid cursor-pointer grid-cols-1 gap-3 rounded-xl bg-[color:var(--lane-card)] p-3 transition-[background-color,box-shadow] outline-none hover:bg-[color:var(--lane-card-hover)] focus-visible:ring-3 focus-visible:ring-ring/45 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start",
      )}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="min-w-0 rounded-lg text-left">
        <h3 className="min-w-0 text-sm leading-5 font-medium">
          <InlineTaskText
            ariaLabel={`Edit title for ${task.title}`}
            className="block min-w-0 leading-5"
            emptyFallback="Untitled task"
            onCommit={(title) => onUpdateTask(task.id, { title })}
            value={task.title}
          />
        </h3>

        {task.notes ? (
          <InlineTaskText
            ariaLabel={`Edit notes for ${task.title}`}
            className="mt-2 line-clamp-2 block min-w-0 text-[13px] leading-5 text-[color:var(--lane-muted)]"
            multiline
            onCommit={(notes) => onUpdateTask(task.id, { notes })}
            value={task.notes}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        <InlineTaskCategoryBadge
          badgeClassName="h-7 min-w-7 rounded-md px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:min-w-6 sm:text-xs"
          onUpdateTask={onUpdateTask}
          task={task}
        />
        <Button
          aria-label={`Mark ${task.title} done`}
          className="border-input/75 bg-transparent text-muted-foreground shadow-none transition-[background-color,border-color,color] hover:border-foreground/18 hover:bg-muted/45 hover:text-foreground focus-visible:ring-ring/45 data-pressed:bg-muted/55 dark:hover:bg-input/50 [&_svg]:opacity-85"
          onClick={(event) => handleStatusClick(event, "done")}
          size="xs"
          type="button"
          variant="outline"
        >
          <CheckCircle2 aria-hidden="true" data-icon="inline-start" />
          Done
        </Button>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 sm:col-span-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <InlineTaskPriorityBadge onUpdateTask={onUpdateTask} task={task} />
          <InlineTaskStatusBadge onUpdateTask={onUpdateTask} task={task} />
          <InlineTaskAssigneeBadge onUpdateTask={onUpdateTask} task={task} />
          <InlineTaskNeedsInputBadge onUpdateTask={onUpdateTask} task={task} />
        </div>

        <UpcomingDateMeta onUpdateTask={onUpdateTask} task={task} />
      </div>
    </article>
  );
}

function getUpcomingEmptyCopy(groupId: string) {
  if (groupId === "tomorrow") {
    return {
      description: "Set a task's work date to tomorrow when it belongs here.",
      title: "Nothing planned tomorrow",
    };
  }

  if (groupId === "this-week") {
    return {
      description: "Work dated later this week will show up here.",
      title: "No planned work this week",
    };
  }

  if (groupId === "later") {
    return {
      description: "Future work beyond the next week will collect here.",
      title: "No later work planned",
    };
  }

  if (groupId === "needs-planning") {
    return {
      description: "Tasks with due dates but no work date will land here.",
      title: "No due tasks need planning",
    };
  }

  if (groupId === "unscheduled") {
    return {
      description: "Tasks without a work date or due date will land here.",
      title: "No unscheduled tasks",
    };
  }

  return {
    description: "Add work here when something needs planning.",
    title: "No tasks here",
  };
}

export function UpcomingSection({
  group,
  layoutMode,
  onNewTask,
  onOpenTask,
  onUpdateTask,
  reduceMotion,
}: {
  group: UpcomingGroup;
  layoutMode: TaskLayoutMode;
  onNewTask: () => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  reduceMotion: boolean;
}) {
  const emptyCopy = getUpcomingEmptyCopy(group.id);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/55 px-4 py-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm leading-5">
          <span className="truncate">{group.title}</span>
          <Badge
            className="not-in-data-active:text-muted-foreground"
            variant="outline"
          >
            {group.tasks.length}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs leading-5">
          {group.subtitle}
        </CardDescription>
      </CardHeader>

      <CardPanel className="flex flex-col gap-2 p-3">
        {group.tasks.length > 0 ? (
          <AnimatePresence initial={false}>
            {group.tasks.map((task) => (
              <motion.div
                exit={reduceMotion ? undefined : { opacity: 0 }}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                key={task.id}
                layout={layoutMode}
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 34,
                  mass: 0.8,
                }}
              >
                <UpcomingTaskItem
                  onOpenTask={onOpenTask}
                  onUpdateTask={onUpdateTask}
                  task={task}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <Empty className="min-h-48 rounded-xl bg-muted/20 py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">{emptyCopy.title}</EmptyTitle>
              <EmptyDescription>{emptyCopy.description}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={onNewTask}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                New task
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardPanel>
    </Card>
  );
}

export function UpcomingPlanStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg bg-muted/25 px-3 py-2">
      <div className="text-lg leading-6 font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-4 text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function TaskViewTabLabel({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  return (
    <>
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  );
}

export function UpcomingPlanningPanel({
  onPlanWithAgent,
  onOpenTask,
  onUpdateTask,
  tasks,
}: {
  onPlanWithAgent: () => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  tasks: Task[];
}) {
  const sortedTasks = sortPlanningTasks(tasks);
  const nextTasks = sortedTasks.slice(0, 3);
  const thisWeekCount = tasks.filter((task) => {
    const planningDate = getPlanningDate(task);

    if (!planningDate) {
      return false;
    }

    const dayDiff = getCalendarDayDiff(planningDate, todayDate);
    return dayDiff >= 0 && dayDiff <= 6;
  }).length;
  const waitingCount = tasks.filter((task) => task.status === "waiting").length;
  const highPriorityCount = tasks.filter(
    (task) => task.priority === "high",
  ).length;

  return (
    <aside className="flex flex-col gap-3 xl:sticky xl:top-0 xl:self-start">
      <Card>
        <CardHeader className="px-4 py-4">
          <CardTitle className="flex items-center gap-2 text-sm leading-5">
            <Clock3 aria-hidden="true" className="text-muted-foreground" />
            Planning
          </CardTitle>
          <CardDescription className="text-xs">
            What needs attention before the deadlines move closer.
          </CardDescription>
        </CardHeader>
        <CardPanel className="grid grid-cols-3 gap-2 px-4 pb-4">
          <UpcomingPlanStat label="this week" value={thisWeekCount} />
          <UpcomingPlanStat label="waiting" value={waitingCount} />
          <UpcomingPlanStat label="high" value={highPriorityCount} />
        </CardPanel>
      </Card>

      <Card>
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-sm leading-5">Next focus</CardTitle>
          <CardDescription className="text-xs">
            The first few tasks worth pulling into today.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{nextTasks.length}</Badge>
          </CardAction>
        </CardHeader>

        <CardPanel className="flex flex-col gap-2 px-4 pb-4">
          {nextTasks.map((task) => (
            <button
              className="rounded-lg bg-muted/25 p-2.5 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/45"
              key={task.id}
              onClick={() => onOpenTask(task.id)}
              type="button"
            >
              <span className="line-clamp-2 text-xs leading-5 font-medium">
                {task.title}
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <CalendarClock aria-hidden="true" className="size-3.5" />
                {getPlanningDateLabel(task)}
              </span>
            </button>
          ))}

          {nextTasks.length === 0 ? (
            <Empty className="min-h-48 rounded-xl bg-muted/20 px-4 py-8 md:py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-base">Nothing to plan</EmptyTitle>
                <EmptyDescription>
                  Ask Counselle to make the next sprint when you are ready.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  onClick={onPlanWithAgent}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Sparkles aria-hidden="true" data-icon="inline-start" />
                  Plan with agent
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {nextTasks[0] ? (
            <Button
              className="mt-3 w-full"
              onClick={() =>
                updateTaskStatusFromPlanning(
                  nextTasks[0],
                  "doing",
                  onUpdateTask,
                  { planForToday: true },
                )
              }
              type="button"
              variant="outline"
            >
              <Play aria-hidden="true" data-icon="inline-start" />
              Start first
            </Button>
          ) : null}
        </CardPanel>
      </Card>
    </aside>
  );
}

export function UpcomingTasksView({
  groups,
  layoutMode,
  onNewTask,
  onPlanWithAgent,
  onOpenTask,
  onUpdateTask,
  reduceMotion,
  tasks,
}: {
  groups: UpcomingGroup[];
  layoutMode: TaskLayoutMode;
  onNewTask: () => void;
  onPlanWithAgent: () => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  reduceMotion: boolean;
  tasks: Task[];
}) {
  return (
    <div className="grid min-h-[32rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {groups.map((group) => (
          <UpcomingSection
            group={group}
            key={group.id}
            layoutMode={layoutMode}
            onNewTask={onNewTask}
            onOpenTask={onOpenTask}
            onUpdateTask={onUpdateTask}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>

      <UpcomingPlanningPanel
        onPlanWithAgent={onPlanWithAgent}
        onOpenTask={onOpenTask}
        onUpdateTask={onUpdateTask}
        tasks={tasks}
      />
    </div>
  );
}
