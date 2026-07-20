import type { DragEvent, MouseEvent, PointerEvent, RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { ApplicationView } from "@/api/workspace/types";
import type { Task, TaskStatus } from "@/domain/task";
import { TaskColumn } from "@/features/tasks/TaskColumn";
import { todayColumns } from "@/features/tasks/task-config";
import type {
  SelectionBox,
  TaskLayoutMode,
  UpdateTask,
} from "@/features/tasks/task-types";
import { getSelectionStyle } from "@/features/tasks/useTaskSelection";
import { cn } from "@/lib/utils";

export function TaskBoard({
  applicationsById,
  dragOverColumn,
  draggingTaskIds,
  groupedTasks,
  layoutMode,
  onCardDragEnd,
  onClickTask,
  onColumnDragLeave,
  onDeleteTask,
  onDragOver,
  onDragStart,
  onDrop,
  onOpenTask,
  onSelectionPointerDown,
  onSelectionPointerEnd,
  onSelectionPointerMove,
  onToggleTaskSelected,
  onUpdateTask,
  reduceMotion,
  selectedTaskIds,
  selectionBox,
  selectionSurfaceRef,
}: {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  dragOverColumn: TaskStatus | null;
  draggingTaskIds: ReadonlySet<string>;
  groupedTasks: Record<TaskStatus, Task[]>;
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
  onSelectionPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerEnd: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleTaskSelected: (taskId: string) => void;
  onUpdateTask: UpdateTask;
  reduceMotion: boolean;
  selectedTaskIds: ReadonlySet<string>;
  selectionBox: SelectionBox | null;
  selectionSurfaceRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <motion.div
      className={cn(
        "grid min-h-[32rem] grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4",
        selectionBox && "select-none",
      )}
      data-task-selection-surface
      onPointerCancel={onSelectionPointerEnd}
      onPointerDown={onSelectionPointerDown}
      onPointerMove={onSelectionPointerMove}
      onPointerUp={onSelectionPointerEnd}
      ref={selectionSurfaceRef}
    >
      {todayColumns.map((column) => (
        <TaskColumn
          applicationsById={applicationsById}
          column={column}
          dragOverColumn={dragOverColumn}
          draggingTaskIds={draggingTaskIds}
          key={column.id}
          layoutMode={layoutMode}
          onCardDragEnd={onCardDragEnd}
          onClickTask={onClickTask}
          onColumnDragLeave={onColumnDragLeave}
          onDeleteTask={onDeleteTask}
          onDragOver={onDragOver}
          onDragStart={onDragStart}
          onDrop={onDrop}
          onOpenTask={onOpenTask}
          onToggleTaskSelected={onToggleTaskSelected}
          onUpdateTask={onUpdateTask}
          reduceMotion={reduceMotion}
          selectedTaskIds={selectedTaskIds}
          tasks={groupedTasks[column.id]}
        />
      ))}

      <AnimatePresence>
        {selectionBox?.hasDragged ? (
          <motion.div
            animate={reduceMotion ? undefined : { opacity: 1 }}
            className="pointer-events-none fixed z-40 rounded-md bg-ring/12"
            exit={reduceMotion ? undefined : { opacity: 0 }}
            initial={reduceMotion ? false : { opacity: 0 }}
            style={getSelectionStyle(selectionBox)}
            transition={{ duration: 0.12, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
