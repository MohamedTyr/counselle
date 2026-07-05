import { useMemo, useState, type MouseEvent } from "react";
import { useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { PageHeader } from "@/components/workspace/PageHeader";
import type { Task, TaskStatus } from "@/domain/task";
import { initialTasks } from "@/fixtures/tasks";
import { AllTasksTable } from "@/features/tasks/AllTasksTable";
import { TaskBoard } from "@/features/tasks/TaskBoard";
import { TaskDetailSheet } from "@/features/tasks/TaskDetailSheet";
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
import {
  createAgentPlanTask,
  createNewTask,
  moveTasksToStatus,
  updateTaskById,
} from "@/features/tasks/task-mutations";
import type {
  TaskLayoutMode,
  TasksPageProps,
  TaskView,
} from "@/features/tasks/task-types";
import { useIsResizing } from "@/features/tasks/useIsResizing";
import { useTaskDrag } from "@/features/tasks/useTaskDrag";
import { useTaskSelection } from "@/features/tasks/useTaskSelection";
import { isTaskPlannedForToday } from "@/features/tasks/task-dates";
import { Plus, Search, Sparkles } from "lucide-react";

export function TasksPage({
  tasks: controlledTasks,
  onTasksChange,
}: TasksPageProps = {}) {
  const [localTasks, setLocalTasks] = useState<Task[]>(initialTasks);
  const tasks = controlledTasks ?? localTasks;
  const setTasks = onTasksChange ?? setLocalTasks;
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<TaskView>("today");
  const reduceMotion = useReducedMotion();
  const isResizing = useIsResizing();
  const taskLayoutMode: TaskLayoutMode =
    reduceMotion || isResizing ? false : "position";
  const taskSelection = useTaskSelection();

  function moveTasks(taskIds: string[], targetStatus: TaskStatus) {
    setTasks((currentTasks) =>
      moveTasksToStatus(currentTasks, taskIds, targetStatus),
    );
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
    () => filteredTasks.filter(isTaskPlannedForToday),
    [filteredTasks],
  );
  const upcomingTasks = useMemo(
    () => filteredTasks.filter(isTaskInUpcomingView),
    [filteredTasks],
  );
  const upcomingGroups = useMemo(
    () => getUpcomingGroups(upcomingTasks),
    [upcomingTasks],
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
      ? "Today, Jul 1"
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

  function updateTask(
    taskId: string,
    patch: Partial<Task>,
    options?: { touch?: boolean },
  ) {
    setTasks((currentTasks) =>
      updateTaskById(currentTasks, taskId, patch, options),
    );
  }

  function handleOpenTask(taskId: string) {
    clearTaskInteraction();
    setActiveTaskId(taskId);
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

  function handleNewTask() {
    const task = createNewTask(view);

    setTasks((currentTasks) => [...currentTasks, task]);
    clearTaskInteraction();
    setActiveTaskId(task.id);
  }

  function handlePlanWithAgent() {
    const task = createAgentPlanTask(view);

    setTasks((currentTasks) => [...currentTasks, task]);
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
        <PageHeader
          actions={
            <>
              <Button onClick={handleNewTask} type="button" variant="outline">
                <Plus aria-hidden="true" data-icon="inline-start" />
                New task
              </Button>
              <Button onClick={handlePlanWithAgent} type="button">
                <Sparkles aria-hidden="true" data-icon="inline-start" />
                Plan with agent
              </Button>
            </>
          }
          title={pageTitle}
        />

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
                <Badge variant="error">{highPriorityCount} high priority</Badge>
                <Badge variant="success">
                  {completedTodayCount} done today
                </Badge>
              </div>

              <div className="relative w-full min-w-0 sm:w-64">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/80"
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
              dragOverColumn={taskDrag.dragOverColumn}
              draggingTaskIds={taskDrag.draggingTaskIdSet}
              groupedTasks={groupedTasks}
              layoutMode={taskLayoutMode}
              onCardDragEnd={taskDrag.handleDragEnd}
              onClickTask={handleTaskClick}
              onColumnDragLeave={() => taskDrag.setDragOverColumn(null)}
              onDragOver={taskDrag.handleDragOver}
              onDragStart={taskDrag.handleDragStart}
              onDrop={taskDrag.handleDrop}
              onOpenTask={handleOpenTask}
              onSelectionPointerDown={taskSelection.handleSelectionPointerDown}
              onSelectionPointerEnd={taskSelection.handleSelectionPointerEnd}
              onSelectionPointerMove={taskSelection.handleSelectionPointerMove}
              onToggleTaskSelected={taskSelection.toggleTaskSelection}
              onUpdateTask={updateTask}
              reduceMotion={!!reduceMotion}
              selectedTaskIds={taskSelection.selectedTaskIdSet}
              selectionBox={taskSelection.selectionBox}
              selectionSurfaceRef={taskSelection.selectionSurfaceRef}
            />
          </TabsPanel>

          <TabsPanel value="upcoming">
            <UpcomingTasksView
              groups={upcomingGroups}
              layoutMode={taskLayoutMode}
              onNewTask={handleNewTask}
              onOpenTask={handleOpenTask}
              onPlanWithAgent={handlePlanWithAgent}
              onUpdateTask={updateTask}
              reduceMotion={!!reduceMotion}
              tasks={upcomingTasks}
            />
          </TabsPanel>

          <TabsPanel value="all">
            <AllTasksTable
              onOpenTask={handleOpenTask}
              onUpdateTask={updateTask}
              tasks={filteredTasks}
            />
          </TabsPanel>
        </Tabs>
      </div>

      <TaskDetailSheet
        onOpenChange={(open) => {
          if (!open) {
            setActiveTaskId(null);
          }
        }}
        onUpdateTask={updateTask}
        open={!!activeTask}
        task={activeTask}
      />
    </section>
  );
}
