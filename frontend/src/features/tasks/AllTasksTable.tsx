import { useMemo, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApplicationView } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import { TaskDeleteMenu, TaskSchoolChip } from "@/features/tasks/task-actions";
import {
  allTaskColumns,
  allTasksTableWidth,
} from "@/features/tasks/task-config";
import {
  formatPlannedDateLabel,
  formatReminderLabel,
  formatShortDate,
  getDueState,
} from "@/features/tasks/task-dates";
import { sortAllTasks } from "@/features/tasks/task-sort";
import type {
  AllTaskColumn,
  AllTaskColumnId,
  AllTaskSortState,
  UpdateTask,
} from "@/features/tasks/task-types";
import {
  InlineTaskCategoryBadge,
  InlineTaskDate,
  InlineTaskPriorityBadge,
  InlineTaskStatusBadge,
  InlineTaskText,
} from "@/features/tasks/task-inline-controls";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  Search,
} from "lucide-react";

function AllTasksTableHead({
  column,
  onSort,
  sortState,
}: {
  column: AllTaskColumn;
  onSort: (columnId: AllTaskColumnId) => void;
  sortState: AllTaskSortState;
}) {
  const isSorted = sortState.columnId === column.id;
  const SortIcon = isSorted
    ? sortState.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      aria-sort={
        isSorted
          ? sortState.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className="overflow-hidden"
    >
      <button
        className={cn(
          "group/all-sort flex min-w-0 items-center gap-1.5 rounded-sm text-left transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isSorted && "text-foreground",
        )}
        onClick={() => onSort(column.id)}
        type="button"
      >
        <span className="block truncate">{column.label}</span>
        <SortIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-opacity",
            isSorted
              ? "opacity-90"
              : "opacity-0 group-hover/all-sort:opacity-70 group-focus-visible/all-sort:opacity-70",
          )}
        />
      </button>
    </TableHead>
  );
}

function AllTaskDueDateValue({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  const dueState = getDueState(task);
  const label = task.due_at ? formatShortDate(task.due_at) : "No due";

  return (
    <InlineTaskDate
      ariaLabel={`Change due date for ${task.title}`}
      className={cn(
        "h-6 text-sm tabular-nums",
        !task.due_at && "text-muted-foreground",
        dueState === "soon" && "font-medium text-destructive",
        dueState === "overdue" && "font-medium text-destructive",
      )}
      defaultHour={23}
      defaultMinute={59}
      field="due_at"
      onUpdateTask={onUpdateTask}
      task={task}
      value={task.due_at}
    >
      {label}
    </InlineTaskDate>
  );
}

function AllTaskWorkDateValue({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskDate
      ariaLabel={`Change work date for ${task.title}`}
      className={cn(
        "h-6 text-sm tabular-nums",
        !task.planned_for && "text-muted-foreground",
      )}
      defaultHour={9}
      defaultMinute={0}
      field="planned_for"
      onUpdateTask={onUpdateTask}
      task={task}
      value={task.planned_for}
    >
      {task.planned_for
        ? formatPlannedDateLabel(task.planned_for)
        : "Unplanned"}
    </InlineTaskDate>
  );
}

function AllTaskReminderValue({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskDate
      ariaLabel={`Change reminder for ${task.title}`}
      className={cn(
        "h-6 text-sm tabular-nums",
        !task.reminder_at && "text-muted-foreground",
      )}
      defaultHour={9}
      defaultMinute={0}
      field="reminder_at"
      onUpdateTask={onUpdateTask}
      task={task}
      value={task.reminder_at}
    >
      {formatReminderLabel(task.reminder_at)}
    </InlineTaskDate>
  );
}

function AllTaskTitleCell({
  applicationsById,
  onDeleteTask,
  onOpenTask,
  onUpdateTask,
  task,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <InlineTaskText
          ariaLabel={`Edit title for ${task.title}`}
          className="block truncate text-sm leading-5 font-medium"
          emptyFallback="Untitled task"
          onCommit={(title) => onUpdateTask(task.id, { title })}
          value={task.title}
        />
        {task.notes ? (
          <InlineTaskText
            ariaLabel={`Edit notes for ${task.title}`}
            className="mt-1 block truncate text-xs leading-4 text-muted-foreground"
            multiline
            onCommit={(notes) => onUpdateTask(task.id, { notes })}
            value={task.notes}
          />
        ) : null}
        {task.application_id ? (
          <div className="mt-1">
            <TaskSchoolChip
              applicationId={task.application_id}
              applicationsById={applicationsById}
            />
          </div>
        ) : null}
      </div>
      <Button
        aria-label={`Open ${task.title} details`}
        className="opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onOpenTask(task.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ExternalLink aria-hidden="true" />
      </Button>
      <TaskDeleteMenu
        className="opacity-70 hover:opacity-100 focus-visible:opacity-100"
        onDeleteTask={onDeleteTask}
        taskId={task.id}
        taskTitle={task.title}
      />
    </div>
  );
}

function AllTasksMobileItem({
  applicationsById,
  onDeleteTask,
  onOpenTask,
  onUpdateTask,
  task,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
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
        "w-full cursor-pointer rounded-xl bg-card p-3 text-left text-card-foreground transition-colors outline-none hover:bg-muted/35 focus-visible:ring-3 focus-visible:ring-ring/45",
        task.status === "done" && "opacity-70",
      )}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <InlineTaskText
            ariaLabel={`Edit title for ${task.title}`}
            className="block truncate text-sm leading-5 font-medium"
            emptyFallback="Untitled task"
            onCommit={(title) => onUpdateTask(task.id, { title })}
            value={task.title}
          />
          {task.notes ? (
            <InlineTaskText
              ariaLabel={`Edit notes for ${task.title}`}
              className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground"
              multiline
              onCommit={(notes) => onUpdateTask(task.id, { notes })}
              value={task.notes}
            />
          ) : null}
        </span>
        <InlineTaskStatusBadge onUpdateTask={onUpdateTask} task={task} />
        <TaskDeleteMenu
          onDeleteTask={onDeleteTask}
          taskId={task.id}
          taskTitle={task.title}
        />
      </span>

      <span className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
        <InlineTaskCategoryBadge onUpdateTask={onUpdateTask} task={task} />
        <InlineTaskPriorityBadge onUpdateTask={onUpdateTask} task={task} />
        <TaskSchoolChip
          applicationId={task.application_id}
          applicationsById={applicationsById}
        />
      </span>

      <span className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="min-w-0 rounded-lg bg-muted/22 px-2 py-1.5">
          <span className="block text-muted-foreground">Work</span>
          <span className="mt-1 block truncate">
            <AllTaskWorkDateValue onUpdateTask={onUpdateTask} task={task} />
          </span>
        </span>
        <span className="min-w-0 rounded-lg bg-muted/22 px-2 py-1.5">
          <span className="block text-muted-foreground">Due</span>
          <span className="mt-1 block truncate">
            <AllTaskDueDateValue onUpdateTask={onUpdateTask} task={task} />
          </span>
        </span>
        <span className="min-w-0 rounded-lg bg-muted/22 px-2 py-1.5">
          <span className="block text-muted-foreground">Reminder</span>
          <span className="mt-1 block truncate">
            <AllTaskReminderValue onUpdateTask={onUpdateTask} task={task} />
          </span>
        </span>
      </span>
    </article>
  );
}

export function AllTasksTable({
  applicationsById,
  onDeleteTask,
  onOpenTask,
  onUpdateTask,
  tasks,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  tasks: Task[];
}) {
  const [sortState, setSortState] = useState<AllTaskSortState>({
    columnId: "workDate",
    direction: "asc",
  });
  const sortedTasks = useMemo(
    () => sortAllTasks(tasks, sortState),
    [sortState, tasks],
  );

  function handleSort(columnId: AllTaskColumnId) {
    setSortState((currentSortState) =>
      currentSortState.columnId === columnId
        ? {
            columnId,
            direction: currentSortState.direction === "asc" ? "desc" : "asc",
          }
        : { columnId, direction: "asc" },
    );
  }

  return (
    <div className="min-h-[32rem] min-w-0">
      <div className="hidden lg:block">
        <Table
          className="table-fixed"
          style={{ minWidth: allTasksTableWidth, width: "100%" }}
          variant="card"
        >
          <colgroup>
            {allTaskColumns.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {allTaskColumns.map((column) => (
                <AllTasksTableHead
                  column={column}
                  key={column.id}
                  onSort={handleSort}
                  sortState={sortState}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTasks.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={allTaskColumns.length}
                >
                  No tasks match this search.
                </TableCell>
              </TableRow>
            ) : (
              sortedTasks.map((task) => (
                <TableRow
                  className={cn(task.status === "done" && "opacity-70")}
                  key={task.id}
                >
                  <TableCell className="overflow-hidden py-3">
                    <AllTaskTitleCell
                      applicationsById={applicationsById}
                      onDeleteTask={onDeleteTask}
                      onOpenTask={onOpenTask}
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <InlineTaskStatusBadge
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <InlineTaskCategoryBadge
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <InlineTaskPriorityBadge
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <AllTaskWorkDateValue
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <AllTaskDueDateValue
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <AllTaskReminderValue
                      onUpdateTask={onUpdateTask}
                      task={task}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {sortedTasks.length === 0 ? (
          <Empty className="min-h-56 rounded-xl bg-muted/20 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No tasks match</EmptyTitle>
              <EmptyDescription>Try a different search.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          sortedTasks.map((task) => (
            <AllTasksMobileItem
              applicationsById={applicationsById}
              key={task.id}
              onDeleteTask={onDeleteTask}
              onOpenTask={onOpenTask}
              onUpdateTask={onUpdateTask}
              task={task}
            />
          ))
        )}
      </div>
    </div>
  );
}
