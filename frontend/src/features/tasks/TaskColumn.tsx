import type { DragEvent, MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ApplicationView } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import type { Task, TaskStatus } from "@/domain/task";
import { TaskCard } from "@/features/tasks/TaskCard";
import { emptyTaskIdSet, laneThemeClass } from "@/features/tasks/task-config";
import type { TaskLayoutMode, TodayColumn } from "@/features/tasks/task-types";
import { cn } from "@/lib/utils";

type TaskColumnProps = {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  column: TodayColumn;
  dragOverColumn: TaskStatus | null;
  draggingTaskIds: ReadonlySet<string>;
  layoutMode: TaskLayoutMode;
  onCardDragEnd: () => void;
  onClickTask: (event: MouseEvent<HTMLElement>, taskId: string) => void;
  onColumnDragLeave: () => void;
  onDeleteTask: (taskId: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>, columnId: TaskStatus) => void;
  onDragStart: (
    event: DragEvent<HTMLElement>,
    task: Task,
    columnId: TaskStatus,
  ) => void;
  onDrop: (event: DragEvent<HTMLElement>, columnId: TaskStatus) => void;
  onOpenTask: (taskId: string) => void;
  onToggleTaskSelected: (taskId: string) => void;
  reduceMotion: boolean;
  selectedTaskIds: ReadonlySet<string>;
  tasks: Task[];
};

export function TaskColumn({
  applicationsById,
  column,
  dragOverColumn,
  draggingTaskIds = emptyTaskIdSet,
  layoutMode,
  onCardDragEnd,
  onClickTask,
  onColumnDragLeave,
  onDeleteTask,
  onDragOver,
  onDragStart,
  onDrop,
  onOpenTask,
  onToggleTaskSelected,
  reduceMotion,
  selectedTaskIds,
  tasks,
}: TaskColumnProps) {
  const isDropTarget = dragOverColumn === column.id;

  return (
    <section
      aria-label={`${column.title}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
      className={cn(
        laneThemeClass[column.id],
        "task-lane flex min-h-[17rem] flex-col rounded-2xl border border-[color:var(--lane-border)] bg-[color:var(--lane-surface)]",
        isDropTarget &&
          "border-[color:var(--lane-drop-border)] bg-[color:var(--lane-drop-surface)]",
      )}
      data-task-column={column.id}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onColumnDragLeave();
        }
      }}
      onDragOver={(event) => onDragOver(event, column.id)}
      onDrop={(event) => onDrop(event, column.id)}
    >
      <div className="flex items-center justify-between gap-3 px-3.5 pt-3.5 pb-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-[0.8125rem] leading-5 font-semibold tracking-[-0.006em] text-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-[color:var(--lane-dot)]"
          />
          <span className="truncate">{column.title}</span>
          {tasks.length > 0 ? (
            <span
              aria-hidden="true"
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-[color:var(--lane-pill-bg)] px-1.5 text-[0.6875rem] font-semibold tabular-nums text-[color:var(--lane-pill-fg)]"
            >
              {tasks.length}
            </span>
          ) : null}
        </h2>
        {column.id === "doing" && tasks.length > 2 ? (
          <Badge variant="error">Too full</Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-0 px-2.5 pb-2.5 [&>[data-task-card-wrapper]+[data-task-card-wrapper]]:mt-2.5">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <TaskCard
              applicationsById={applicationsById}
              isDragging={draggingTaskIds.has(task.id)}
              isSelected={selectedTaskIds.has(task.id)}
              key={task.id}
              layoutMode={layoutMode}
              onClick={onClickTask}
              onDeleteTask={onDeleteTask}
              onDragEnd={onCardDragEnd}
              onDragStart={onDragStart}
              onOpen={onOpenTask}
              onToggleSelected={onToggleTaskSelected}
              reduceMotion={reduceMotion}
              task={task}
            />
          ))}
        </AnimatePresence>

        {tasks.length === 0 ? (
          <motion.p
            animate={reduceMotion ? undefined : { opacity: 1 }}
            className={cn(
              "task-lane-slot flex flex-1 items-center justify-center px-6 py-8 text-center text-xs leading-5 text-balance text-[color:var(--lane-muted)]",
              isDropTarget && "text-[color:var(--lane-pill-fg)]",
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {column.description}
          </motion.p>
        ) : null}
      </div>
    </section>
  );
}
