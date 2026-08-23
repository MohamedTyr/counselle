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
import { sortAllTasks } from "@/features/tasks/task-sort";
import type {
  AllTaskColumn,
  AllTaskColumnId,
  AllTaskSortState,
} from "@/features/tasks/task-types";
import {
  StaticDueDateValue,
  StaticReminderValue,
  StaticTaskCategoryBadge,
  StaticTaskPriorityBadge,
  StaticTaskStatusBadge,
  StaticTaskText,
  StaticWorkDateValue,
} from "@/features/tasks/task-static-controls";
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
          "group/all-sort flex min-w-0 items-center gap-1.5 rounded-sm text-left transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
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

function AllTaskTitleCell({
  applicationsById,
  onDeleteTask,
  onOpenTask,
  task,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  task: Task;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-medium">
          {task.title || "Untitled task"}
        </span>
        {task.notes ? (
          <StaticTaskText
            className="mt-1 block truncate text-xs leading-4 text-muted-foreground"
            multiline
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
  task,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
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
        "w-full cursor-pointer rounded-xl bg-card p-3 text-left text-card-foreground transition-colors outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)]",
        task.status === "done" && "opacity-70",
      )}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm leading-5 font-medium">
            {task.title || "Untitled task"}
          </span>
          {task.notes ? (
            <StaticTaskText
              className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground"
              multiline
              value={task.notes}
            />
          ) : null}
        </span>
        <StaticTaskStatusBadge task={task} />
        <TaskDeleteMenu
          onDeleteTask={onDeleteTask}
          taskId={task.id}
          taskTitle={task.title}
        />
      </span>

      <span className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
        <StaticTaskCategoryBadge task={task} />
        <StaticTaskPriorityBadge task={task} />
        <TaskSchoolChip
          applicationId={task.application_id}
          applicationsById={applicationsById}
        />
      </span>

      <span className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="min-w-0 rounded-lg bg-[var(--control-track)] px-2 py-1.5">
          <span className="block text-muted-foreground">Work</span>
          <span className="mt-1 block truncate">
            <StaticWorkDateValue task={task} />
          </span>
        </span>
        <span className="min-w-0 rounded-lg bg-[var(--control-track)] px-2 py-1.5">
          <span className="block text-muted-foreground">Due</span>
          <span className="mt-1 block truncate">
            <StaticDueDateValue task={task} />
          </span>
        </span>
        <span className="min-w-0 rounded-lg bg-[var(--control-track)] px-2 py-1.5">
          <span className="block text-muted-foreground">Reminder</span>
          <span className="mt-1 block truncate">
            <StaticReminderValue task={task} />
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
  tasks,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  onDeleteTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
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
                  aria-label={`Open ${task.title} details`}
                  className={cn(
                    "cursor-pointer",
                    task.status === "done" && "opacity-70",
                  )}
                  key={task.id}
                  onClick={() => onOpenTask(task.id)}
                >
                  <TableCell className="overflow-hidden py-3">
                    <AllTaskTitleCell
                      applicationsById={applicationsById}
                      onDeleteTask={onDeleteTask}
                      onOpenTask={onOpenTask}
                      task={task}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticTaskStatusBadge task={task} />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticTaskCategoryBadge task={task} />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticTaskPriorityBadge task={task} />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticWorkDateValue task={task} />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticDueDateValue task={task} />
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <StaticReminderValue task={task} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {sortedTasks.length === 0 ? (
          <Empty className="min-h-56 rounded-xl bg-[var(--control-track)] py-10">
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
              task={task}
            />
          ))
        )}
      </div>
    </div>
  );
}
