import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useReducedMotion } from "motion/react";
import { useSearchParams } from "react-router";

import {
  useApplications,
  useArchiveTask,
  useBulkArchiveTasks,
  useBulkUpdateTaskStatus,
  useCreateTask,
  useEssays,
  useRestoreTask,
  useTasks,
  useUpdateTask,
} from "@/api/workspace/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UndoToast, type UndoToastPending } from "@/components/undo-toast";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { PageHeader } from "@/components/workspace/PageHeader";
import {
  taskFromApi,
  taskPatchToApi,
  type Task,
  type TaskStatus,
} from "@/domain/task";
import { UNDO_WINDOW_MS, useUndoableDelete } from "@/hooks/useUndoableDelete";
import { AllTasksTable } from "@/features/tasks/AllTasksTable";
import { TaskBoard } from "@/features/tasks/TaskBoard";
import { TaskDetailSheet } from "@/features/tasks/TaskDetailSheet";
import { PlanWithAgentButton } from "@/features/tasks/task-actions";
import {
  TaskViewTabLabel,
  UpcomingTasksView,
} from "@/features/tasks/UpcomingTasksView";
import {
  filterTasksByQuery,
  groupTasksByStatus,
  getUpcomingGroups,
  isTaskInUpcomingView,
} from "@/features/tasks/task-filters";
import { createNewTask } from "@/features/tasks/task-mutations";
import type { TaskLayoutMode, TaskView } from "@/features/tasks/task-types";
import { useIsResizing } from "@/features/tasks/useIsResizing";
import { useTaskDrag } from "@/features/tasks/useTaskDrag";
import { useTaskSelection } from "@/features/tasks/useTaskSelection";
import {
  formatTodayPageTitle,
  isTaskPlannedForToday,
} from "@/features/tasks/task-dates";
import { getNowDate } from "@/lib/time";
import { Plus, Search } from "lucide-react";

function TasksSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <Skeleton className="h-[17rem] w-full rounded-2xl" />
      <Skeleton className="h-[17rem] w-full rounded-2xl" />
      <Skeleton className="h-[17rem] w-full rounded-2xl" />
      <Skeleton className="h-[17rem] w-full rounded-2xl" />
    </div>
  );
}

function isEditingSurface(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input,textarea,select,[contenteditable=true],[data-task-editing-field]," +
          "[data-slot^='select'],[data-slot^='dropdown-menu'],[role='menuitem'],[role='option'],[role='listbox']",
      ),
    )
  );
}

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

export function TasksPage() {
  const tasksQuery = useTasks();
  const applicationsQuery = useApplications();
  const essaysQuery = useEssays();
  const createTaskMutation = useCreateTask();
  const updateTaskMutation = useUpdateTask();
  const bulkUpdateStatusMutation = useBulkUpdateTaskStatus();
  const archiveTaskMutation = useArchiveTask();
  const restoreTaskMutation = useRestoreTask();
  const bulkArchiveMutation = useBulkArchiveTasks();

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<TaskView>("today");
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    ids: string[];
  } | null>(null);
  const bulkDeleteTimeoutRef = useRef<number | undefined>(undefined);
  const reduceMotion = useReducedMotion();
  const isResizing = useIsResizing();
  const taskLayoutMode: TaskLayoutMode =
    reduceMotion || isResizing ? false : "position";
  const taskSelection = useTaskSelection();
  const activeTaskId = searchParams.get("task");
  const todayDate = getNowDate();

  const tasks = useMemo(
    () => listOrEmpty(tasksQuery.data).map(taskFromApi),
    [tasksQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const applicationsById = useMemo(
    () =>
      new Map(
        listOrEmpty(applicationsQuery.data).map((application) => [
          application.id,
          application,
        ]),
      ),
    [applicationsQuery.data],
  );
  const essays = listOrEmpty(essaysQuery.data);

  const singleDeleteUndo = useUndoableDelete<Task>({
    archiveMutation: archiveTaskMutation,
    getLabel: (deletedTask) => deletedTask.title,
    restoreMutation: restoreTaskMutation,
  });

  function clearBulkDeletePending() {
    window.clearTimeout(bulkDeleteTimeoutRef.current);
    setPendingBulkDelete(null);
  }

  useEffect(() => clearBulkDeletePending, []);

  function deleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    clearBulkDeletePending();
    if (activeTaskId === taskId) {
      closeTask();
    }
    taskSelection.clearTaskSelection();
    singleDeleteUndo.archive(task);
  }

  function deleteSelectedTasks(taskIds: string[]) {
    if (taskIds.length === 0) {
      return;
    }

    if (taskIds.length === 1) {
      deleteTask(taskIds[0]);
      return;
    }

    singleDeleteUndo.clearPending();
    window.clearTimeout(bulkDeleteTimeoutRef.current);
    setPendingBulkDelete({ ids: taskIds });
    bulkArchiveMutation.mutate(taskIds);
    bulkDeleteTimeoutRef.current = window.setTimeout(
      clearBulkDeletePending,
      UNDO_WINDOW_MS,
    );
    taskSelection.clearTaskSelection();
  }

  function undoDelete() {
    if (singleDeleteUndo.pending) {
      singleDeleteUndo.undo();
      return;
    }

    if (pendingBulkDelete) {
      pendingBulkDelete.ids.forEach((id) => restoreTaskMutation.mutate(id));
      clearBulkDeletePending();
    }
  }

  function dismissUndo() {
    singleDeleteUndo.clearPending();
    clearBulkDeletePending();
  }

  const undoPending: UndoToastPending = singleDeleteUndo.pending
    ? { label: singleDeleteUndo.pending.label }
    : pendingBulkDelete
      ? {
          label: `${pendingBulkDelete.ids.length} tasks`,
        }
      : null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (taskSelection.selectedTaskIds.length === 0) {
        return;
      }

      if (isEditingSurface(event.target)) {
        return;
      }

      event.preventDefault();
      deleteSelectedTasks(taskSelection.selectedTaskIds);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSelection.selectedTaskIds]);

  function moveTasks(taskIds: string[], targetStatus: TaskStatus) {
    bulkUpdateStatusMutation.mutate({ ids: taskIds, status: targetStatus });
  }

  const taskDrag = useTaskDrag({
    onMoveTasks: moveTasks,
    selectedTaskIds: taskSelection.selectedTaskIds,
    selectionSurfaceRef: taskSelection.selectionSurfaceRef,
  });

  const activeTask = tasks.find((task) => task.id === activeTaskId);
  const filteredTasks = useMemo(
    () => filterTasksByQuery(tasks, searchQuery),
    [searchQuery, tasks],
  );
  const todayTasks = useMemo(
    () =>
      filteredTasks.filter((task) => isTaskPlannedForToday(task, todayDate)),
    [filteredTasks, todayDate],
  );
  const upcomingTasks = useMemo(
    () => filteredTasks.filter((task) => isTaskInUpcomingView(task, todayDate)),
    [filteredTasks, todayDate],
  );
  const upcomingGroups = useMemo(
    () => getUpcomingGroups(upcomingTasks, todayDate),
    [todayDate, upcomingTasks],
  );
  const currentViewTasks =
    view === "today"
      ? todayTasks
      : view === "upcoming"
        ? upcomingTasks
        : filteredTasks;
  const completedTodayCount = todayTasks.filter(
    (task) => task.status === "done",
  ).length;
  const highPriorityCount = currentViewTasks.filter(
    (task) => task.priority === "high" && task.status !== "done",
  ).length;
  const pageTitle =
    view === "today"
      ? formatTodayPageTitle(todayDate)
      : view === "upcoming"
        ? "Upcoming"
        : "All tasks";
  const groupedTasks = useMemo(
    () => groupTasksByStatus(todayTasks),
    [todayTasks],
  );

  function clearTaskInteraction() {
    taskSelection.clearTaskSelection();
    taskDrag.clearTaskDrag();
  }

  function openTask(taskId: string) {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.set("task", taskId);
        return nextParams;
      },
      { replace: true },
    );
  }

  function closeTask() {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.delete("task");
        return nextParams;
      },
      { replace: true },
    );
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    updateTaskMutation.mutate({ id: taskId, patch: taskPatchToApi(patch) });
  }

  function handleOpenTask(taskId: string) {
    clearTaskInteraction();
    openTask(taskId);
  }

  function handleTaskClick(event: MouseEvent<HTMLElement>, taskId: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      taskSelection.toggleTaskSelection(taskId);
      return;
    }

    handleOpenTask(taskId);
  }

  function handleViewChange(value: string) {
    clearTaskInteraction();
    setView(value as TaskView);
  }

  async function handleNewTask() {
    const draft = createNewTask(view);

    clearTaskInteraction();
    try {
      const created = await createTaskMutation.mutateAsync({
        title: draft.title,
        category: draft.category,
        planned_for: draft.planned_for,
        priority: draft.priority,
        status: draft.status,
      });
      openTask(created.id);
    } catch {
      // The workspace mutation hook owns rollback and error toast behavior.
    }
  }

  const isLoading = tasksQuery.isLoading;
  const isError = tasksQuery.isError;
  const hasNoTasks = !isLoading && !isError && tasks.length === 0;

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader
          actions={
            <>
              <Button
                onClick={() => void handleNewTask()}
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                New task
              </Button>
              <PlanWithAgentButton />
            </>
          }
          title={pageTitle}
        />

        {isLoading ? (
          <TasksSkeleton />
        ) : isError ? (
          <div className="rounded-xl border bg-card p-6">
            <div className="max-w-md space-y-3">
              <h2 className="font-heading text-lg font-medium">
                Could not load tasks
              </h2>
              <p className="text-sm text-muted-foreground">
                The workspace could not reach your tasks list.
              </p>
              <Button onClick={() => void tasksQuery.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : hasNoTasks ? (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Plus />
              </EmptyMedia>
              <EmptyTitle>No tasks yet</EmptyTitle>
              <EmptyDescription>
                Track your application checklist, essays, and forms from one
                place.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void handleNewTask()}>
                <Plus data-icon="inline-start" />
                Add your first task
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Tabs
            aria-label="Task views"
            className="min-w-0 gap-6"
            onValueChange={handleViewChange}
            value={view}
          >
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <TabsList className="w-full flex-wrap justify-start gap-y-1 sm:w-fit">
                <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="today">
                  <TaskViewTabLabel count={todayTasks.length} label="Today" />
                </TabsTab>
                <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="upcoming">
                  <TaskViewTabLabel
                    count={upcomingTasks.length}
                    label="Upcoming"
                  />
                </TabsTab>
                <TabsTab className="sm:h-7 sm:px-2 sm:text-xs" value="all">
                  <TaskViewTabLabel count={filteredTasks.length} label="All" />
                </TabsTab>
              </TabsList>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="error">
                    {highPriorityCount} high priority
                  </Badge>
                  <Badge variant="success">
                    {completedTodayCount} done today
                  </Badge>
                </div>

                <div className="relative w-full min-w-0 sm:w-64">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-muted)]"
                  />
                  <Input
                    aria-label="Search tasks"
                    className="[&_[data-slot=input]]:pl-9"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search"
                    type="search"
                    value={searchQuery}
                  />
                </div>
              </div>
            </div>

            <TabsPanel value="today">
              <TaskBoard
                applicationsById={applicationsById}
                dragOverColumn={taskDrag.dragOverColumn}
                draggingTaskIds={taskDrag.draggingTaskIdSet}
                groupedTasks={groupedTasks}
                layoutMode={taskLayoutMode}
                onCardDragEnd={taskDrag.handleDragEnd}
                onClickTask={handleTaskClick}
                onColumnDragLeave={() => taskDrag.setDragOverColumn(null)}
                onDeleteTask={deleteTask}
                onDragOver={taskDrag.handleDragOver}
                onDragStart={taskDrag.handleDragStart}
                onDrop={taskDrag.handleDrop}
                onOpenTask={handleOpenTask}
                onSelectionPointerDown={
                  taskSelection.handleSelectionPointerDown
                }
                onSelectionPointerEnd={taskSelection.handleSelectionPointerEnd}
                onSelectionPointerMove={
                  taskSelection.handleSelectionPointerMove
                }
                onToggleTaskSelected={taskSelection.toggleTaskSelection}
                reduceMotion={!!reduceMotion}
                selectedTaskIds={taskSelection.selectedTaskIdSet}
                selectionBox={taskSelection.selectionBox}
                selectionSurfaceRef={taskSelection.selectionSurfaceRef}
              />
            </TabsPanel>

            <TabsPanel value="upcoming">
              <UpcomingTasksView
                applicationsById={applicationsById}
                groups={upcomingGroups}
                layoutMode={taskLayoutMode}
                onDeleteTask={deleteTask}
                onNewTask={() => void handleNewTask()}
                onOpenTask={handleOpenTask}
                onUpdateTask={updateTask}
                reduceMotion={!!reduceMotion}
                tasks={upcomingTasks}
              />
            </TabsPanel>

            <TabsPanel value="all">
              <AllTasksTable
                applicationsById={applicationsById}
                onDeleteTask={deleteTask}
                onOpenTask={handleOpenTask}
                tasks={filteredTasks}
              />
            </TabsPanel>
          </Tabs>
        )}
      </div>

      <TaskDetailSheet
        applications={applications}
        essays={essays}
        onDeleteTask={deleteTask}
        onOpenChange={(open) => {
          if (!open) {
            closeTask();
          }
        }}
        onUpdateTask={updateTask}
        open={!!activeTask}
        task={activeTask}
      />

      <UndoToast
        onDismiss={dismissUndo}
        onUndo={undoDelete}
        pending={undoPending}
        reduceMotion={!!reduceMotion}
      />
    </section>
  );
}
