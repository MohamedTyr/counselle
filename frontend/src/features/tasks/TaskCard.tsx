import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { motion } from "motion/react";

import type { Task, TaskStatus } from "@/domain/task";
import type { TaskLayoutMode, UpdateTask } from "@/features/tasks/task-types";
import {
  InlineTaskCategoryBadge,
  InlineTaskText,
  TaskMetaRail,
} from "@/features/tasks/task-inline-controls";
import { cn } from "@/lib/utils";

type TaskCardProps = {
  isDragging: boolean;
  isSelected: boolean;
  layoutMode: TaskLayoutMode;
  onClick: (event: MouseEvent<HTMLElement>, taskId: string) => void;
  onDragEnd: () => void;
  onDragStart: (
    event: DragEvent<HTMLElement>,
    task: Task,
    columnId: TaskStatus,
  ) => void;
  onOpen: (taskId: string) => void;
  onToggleSelected: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  reduceMotion: boolean;
  task: Task;
};

export function TaskCard({
  isDragging,
  isSelected,
  layoutMode,
  onClick,
  onDragEnd,
  onDragStart,
  onOpen,
  onToggleSelected,
  onUpdateTask,
  reduceMotion,
  task,
}: TaskCardProps) {
  const isDone = task.status === "done";

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(task.id);
    }

    if (event.key === " ") {
      event.preventDefault();
      onToggleSelected(task.id);
    }
  }

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
          "group/task w-full cursor-grab rounded-xl border border-[color:var(--lane-card-border)] bg-[color:var(--lane-card)] p-3 text-left shadow-[var(--workspace-task-card-shadow)] transition-[background-color,border-color,box-shadow] outline-none hover:bg-[color:var(--lane-card-hover)] focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
          isDone && "bg-[color:var(--lane-card)]",
          isSelected &&
            "border-ring/55 bg-[color:var(--task-card-selected-background)] ring-2 ring-ring/30 hover:bg-[color:var(--task-card-selected-hover-background)]",
          isDragging && "opacity-55",
        )}
        data-state={isSelected ? "selected" : undefined}
        data-task-id={task.id}
        draggable
        onClick={(event) => onClick(event, task.id)}
        onDragEnd={onDragEnd}
        onDragStart={(event) => onDragStart(event, task, task.status)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="flex min-w-0 items-start gap-3">
          <h3 className="min-w-0 flex-1 text-sm leading-5 font-medium">
            <InlineTaskText
              ariaLabel={`Edit title for ${task.title}`}
              className="block min-w-0 leading-5"
              emptyFallback="Untitled task"
              onCommit={(title) => onUpdateTask(task.id, { title })}
              value={task.title}
            />
          </h3>
          <InlineTaskCategoryBadge onUpdateTask={onUpdateTask} task={task} />
        </div>

        {task.notes ? (
          <InlineTaskText
            ariaLabel={`Edit notes for ${task.title}`}
            className="mt-2 line-clamp-2 block min-w-0 text-[13px] leading-5 text-[color:var(--lane-muted)]"
            multiline
            onCommit={(notes) => onUpdateTask(task.id, { notes })}
            value={task.notes}
          />
        ) : null}

        <TaskMetaRail isDone={isDone} onUpdateTask={onUpdateTask} task={task} />
      </article>
    </motion.div>
  );
}
