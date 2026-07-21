import { BellRing, CalendarClock, CheckCircle2, CircleAlert, Sparkles, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Task } from "@/domain/task";
import {
  assigneeBadgeVariant,
  assigneeLabel,
  categoryChipClass,
  categoryLabel,
  priorityBadgeVariant,
  priorityLabel,
  statusBadgeVariant,
  statusLabel,
} from "@/features/tasks/task-config";
import {
  formatPlannedDateLabel,
  formatReminderLabel,
  formatShortDate,
  getDueState,
} from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

export function StaticTaskText({
  className,
  emptyFallback,
  multiline = false,
  value,
}: {
  className?: string;
  emptyFallback?: string;
  multiline?: boolean;
  value?: string;
}) {
  const Tag = multiline ? "p" : "span";

  return <Tag className={className}>{value || emptyFallback}</Tag>;
}

export function StaticTaskCategoryBadge({
  badgeClassName,
  task,
}: {
  badgeClassName?: string;
  task: Task;
}) {
  return (
    <Badge
      className={cn(categoryChipClass[task.category], badgeClassName)}
      variant="outline"
    >
      {categoryLabel[task.category]}
    </Badge>
  );
}

export function StaticTaskStatusBadge({ task }: { task: Task }) {
  return (
    <Badge variant={statusBadgeVariant[task.status]}>
      {statusLabel[task.status]}
    </Badge>
  );
}

export function StaticTaskPriorityBadge({ task }: { task: Task }) {
  return (
    <Badge variant={priorityBadgeVariant[task.priority]}>
      {priorityLabel[task.priority]}
    </Badge>
  );
}

export function StaticTaskAssigneeBadge({ task }: { task: Task }) {
  const needsCounselleInput = task.assignee === "counselle" && task.needs_input;

  return (
    <Badge
      variant={needsCounselleInput ? "error" : assigneeBadgeVariant[task.assignee]}
    >
      {needsCounselleInput ? (
        <CircleAlert aria-hidden="true" />
      ) : task.assignee === "counselle" ? (
        <Sparkles aria-hidden="true" />
      ) : (
        <UserRound aria-hidden="true" />
      )}
      {needsCounselleInput ? "Counselle needs input" : assigneeLabel[task.assignee]}
    </Badge>
  );
}

export function StaticTaskNeedsInputBadge({ task }: { task: Task }) {
  if (!task.needs_input || task.assignee === "counselle") {
    return null;
  }

  return (
    <Badge variant="error">
      <CircleAlert aria-hidden="true" />
      Needs input
    </Badge>
  );
}

export function StaticTaskDueMeta({ task }: { task: Task }) {
  if (!task.due_at) {
    return null;
  }

  const dueState = getDueState(task);

  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 text-xs font-medium text-[color:var(--lane-muted)] tabular-nums",
        dueState === "soon" && "text-destructive",
        dueState === "overdue" && "text-destructive",
      )}
    >
      <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
      <span>Due {formatShortDate(task.due_at)}</span>
    </span>
  );
}

function StaticTaskTrailingMeta({
  isDone,
  task,
}: {
  isDone: boolean;
  task: Task;
}) {
  const statusMeta = isDone ? (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 text-xs text-[color:var(--lane-muted)]">
      <CheckCircle2 aria-hidden="true" className="size-3.5" />
      Done
    </span>
  ) : task.reminder_at ? (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 text-xs text-[color:var(--lane-muted)] tabular-nums">
      <BellRing aria-hidden="true" className="size-4 shrink-0" />
      {formatShortDate(task.reminder_at)}
    </span>
  ) : null;

  if (!task.due_at && !statusMeta) {
    return null;
  }

  return (
    <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <StaticTaskDueMeta task={task} />
      {statusMeta}
    </span>
  );
}

export function StaticTaskMetaRail({
  isDone,
  task,
}: {
  isDone: boolean;
  task: Task;
}) {
  return (
    <div className="mt-2.5 flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StaticTaskPriorityBadge task={task} />
        <StaticTaskAssigneeBadge task={task} />
        <StaticTaskNeedsInputBadge task={task} />
      </div>

      <StaticTaskTrailingMeta isDone={isDone} task={task} />
    </div>
  );
}

export function StaticWorkDateValue({
  className,
  task,
}: {
  className?: string;
  task: Task;
}) {
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        !task.planned_for && "text-muted-foreground",
        className,
      )}
    >
      {task.planned_for ? formatPlannedDateLabel(task.planned_for) : "Unplanned"}
    </span>
  );
}

export function StaticDueDateValue({
  className,
  task,
}: {
  className?: string;
  task: Task;
}) {
  const dueState = getDueState(task);

  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        !task.due_at && "text-muted-foreground",
        dueState === "soon" && "font-medium text-destructive",
        dueState === "overdue" && "font-medium text-destructive",
        className,
      )}
    >
      {task.due_at ? formatShortDate(task.due_at) : "No due"}
    </span>
  );
}

export function StaticReminderValue({
  className,
  task,
}: {
  className?: string;
  task: Task;
}) {
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        !task.reminder_at && "text-muted-foreground",
        className,
      )}
    >
      {formatReminderLabel(task.reminder_at)}
    </span>
  );
}

export function StaticUpcomingDateMeta({ task }: { task: Task }) {
  const plannedFor = task.planned_for;

  if (!plannedFor && !task.due_at) {
    return (
      <span className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 text-xs font-medium text-[color:var(--lane-muted)] tabular-nums">
        <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
        No date
      </span>
    );
  }

  return (
    <span className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {plannedFor ? (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 text-xs font-medium text-[color:var(--lane-muted)] tabular-nums">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          Work {formatPlannedDateLabel(plannedFor)}
        </span>
      ) : null}
      <StaticTaskDueMeta task={task} />
    </span>
  );
}
