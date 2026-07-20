import type { DragEvent, MouseEvent } from "react";
import { AnimatePresence } from "motion/react";

import type { ApplicationView } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Task, TaskStatus } from "@/domain/task";
import { TaskCard } from "@/features/tasks/TaskCard";
import { emptyTaskIdSet, laneThemeClass } from "@/features/tasks/task-config";
import type {
  TaskLayoutMode,
  TodayColumn,
  UpdateTask,
} from "@/features/tasks/task-types";
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
  onUpdateTask: UpdateTask;
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
  onUpdateTask,
  reduceMotion,
  selectedTaskIds,
  tasks,
}: TaskColumnProps) {
  const isDropTarget = dragOverColumn === column.id;

  return (
    <Card
      className={cn(
        laneThemeClass[column.id],
        "min-h-[29rem] overflow-hidden [border-color:var(--lane-border)] [background-color:var(--lane-surface)] transition-[background-color,border-color,box-shadow]",
        isDropTarget && "border-ring/50 bg-muted/50 shadow-sm",
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
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <div className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color:var(--lane-border)] bg-[color:var(--lane-pill-bg)] px-2.5 text-sm font-medium text-[color:var(--lane-pill-fg)] shadow-xs/5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[color:var(--lane-dot)]"
            />
            <span>{column.title}</span>
            <span className="text-xs tabular-nums opacity-75">
              {tasks.length}
            </span>
          </div>
        </div>
        {column.id === "doing" && tasks.length > 2 ? (
          <Badge variant="error">Too full</Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-0 px-3 pt-2 pb-3 [&>[data-task-card-wrapper]+[data-task-card-wrapper]]:mt-3">
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
              onUpdateTask={onUpdateTask}
              reduceMotion={reduceMotion}
              task={task}
            />
          ))}
        </AnimatePresence>

        {tasks.length === 0 && column.id === "done" ? (
          <div
            className={cn(
              "flex min-h-32 flex-1 items-center justify-center rounded-xl border border-dashed bg-muted/30 p-4 text-center text-xs leading-5 text-muted-foreground transition-colors",
              isDropTarget && "border-ring/50 bg-background/70",
            )}
          >
            Finish one task to start today.
          </div>
        ) : null}
      </div>
    </Card>
  );
}
