import type { DragEvent, MouseEvent } from "react";
import { motion } from "motion/react";

import type { ApplicationView } from "@/api/workspace/types";
import type { Task, TaskStatus } from "@/domain/task";
import { TaskDeleteMenu, TaskSchoolChip } from "@/features/tasks/task-actions";
import type { TaskLayoutMode } from "@/features/tasks/task-types";
import {
  StaticTaskCategoryBadge,
  StaticTaskMetaRail,
} from "@/features/tasks/task-static-controls";
import { cn } from "@/lib/utils";

type TaskCardProps = {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  isDragging: boolean;
  isSelected: boolean;
  layoutMode: TaskLayoutMode;
  onClick: (event: MouseEvent<HTMLElement>, taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDragEnd: () => void;
  onDragStart: (
    event: DragEvent<HTMLElement>,
    task: Task,
    columnId: TaskStatus,
  ) => void;
  onOpen: (taskId: string) => void;
  onToggleSelected: (taskId: string) => void;
  reduceMotion: boolean;
  task: Task;
};

export function TaskCard({
  applicationsById,
  isDragging,
  isSelected,
  layoutMode,
  onClick,
  onDeleteTask,
  onDragEnd,
  onDragStart,
  onOpen,
  onToggleSelected,
  reduceMotion,
  task,
}: TaskCardProps) {
  const isDone = task.status === "done";

  return (
    <motion.div
      animate={
        reduceMotion
          ? undefined
          : {
              opacity: isDone ? 0.82 : 1,
            }
      }
      exit={reduceMotion ? undefined : { opacity: 0 }}
      initial={reduceMotion ? false : { opacity: 0 }}
      layout={layoutMode}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
      data-task-card-wrapper
    >
      <article
        aria-label={`Open ${task.title} details`}
        className={cn(
          "group/task w-full cursor-grab rounded-xl border border-[color:var(--lane-card-border)] bg-[color:var(--lane-card)] p-3 text-left shadow-[var(--workspace-task-card-shadow)] transition-[background-color,border-color,box-shadow] outline-none hover:bg-[color:var(--lane-card-hover)] focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] active:cursor-grabbing",
          isDone && "bg-[color:var(--lane-card)]",
          isSelected &&
            "border-[var(--focus-ring)] bg-[color:var(--task-card-selected-background)] ring-2 ring-[var(--focus-ring)] hover:bg-[color:var(--task-card-selected-hover-background)]",
          isDragging && "opacity-55",
        )}
        data-state={isSelected ? "selected" : undefined}
        data-task-id={task.id}
        draggable
        onClick={(event) => onClick(event, task.id)}
        onDragEnd={onDragEnd}
        onDragStart={(event) => onDragStart(event, task, task.status)}
      >
        <div className="flex min-w-0 items-start gap-3">
          <button
            aria-label={`Open ${task.title} details`}
            className="sr-only focus:not-sr-only focus:absolute focus:rounded-md focus:bg-background focus:px-2 focus:py-1 focus:text-sm focus:ring-[3px] focus:ring-[var(--focus-ring)]"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(task.id);
            }}
            type="button"
          >
            Open task
          </button>
          <button
            aria-label={`${isSelected ? "Deselect" : "Select"} ${task.title}`}
            className="sr-only focus:not-sr-only focus:absolute focus:rounded-md focus:bg-background focus:px-2 focus:py-1 focus:text-sm focus:ring-[3px] focus:ring-[var(--focus-ring)]"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected(task.id);
            }}
            type="button"
          >
            {isSelected ? "Deselect task" : "Select task"}
          </button>
          <h3 className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
            {task.title || "Untitled task"}
          </h3>
          <StaticTaskCategoryBadge task={task} />
          <TaskDeleteMenu
            onDeleteTask={onDeleteTask}
            taskId={task.id}
            taskTitle={task.title}
          />
        </div>

        {task.application_id ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <TaskSchoolChip
              applicationId={task.application_id}
              applicationsById={applicationsById}
            />
          </div>
        ) : null}

        {task.notes ? (
          <p className="mt-2 line-clamp-2 min-w-0 text-[13px] leading-5 text-[color:var(--lane-muted)]">
            {task.notes}
          </p>
        ) : null}

        <StaticTaskMetaRail isDone={isDone} task={task} />
      </article>
    </motion.div>
  );
}
