// Every verb a `TaskRow` exposes, in one place.
//
// Four surfaces render task rows — the four task views, the search dialog,
// the essay page's task section, and the school page's requirement lists —
// and before this hook each of them hand-rolled its own complete/schedule/
// flag handlers. That is one fact ("what these verbs do") with one reason to
// change, so it lives here. The practical consequence is that Delete and its
// undo window arrive on every surface at once, instead of only on the page
// that happened to wire them.
import { useReducedMotion } from "motion/react";

import {
  useArchiveTask,
  useCompleteTask,
  useRestoreTask,
  useScheduleTask,
  useToggleFlag,
} from "@/api/workspace/hooks";
import type { UndoToastPending } from "@/components/undo-toast";
import type { Task } from "@/domain/task";
import type { TaskRowActions } from "@/features/tasks/TaskRowMenu";
import { useUndoableAction } from "@/hooks/useUndoableAction";

export type TaskRowActionsResult = {
  actions: TaskRowActions;
  /** Bound to `⌘Z` by the tasks keymap; the toast's button calls it too. */
  undo: () => void;
  /** Spread straight onto `<UndoToast />`. Every surface that can delete a
   * task must render one — a destructive action with no way back is the one
   * thing this hook exists to prevent. */
  undoToastProps: {
    onDismiss: () => void;
    onUndo: () => void;
    pending: UndoToastPending;
    reduceMotion: boolean;
  };
};

export function useTaskRowActions({
  tasks,
  onOpen,
  onAfterDelete,
}: {
  tasks: Task[];
  onOpen: (taskId: string) => void;
  /** The tasks page uses this to close a detail panel showing the row that
   * just went away. */
  onAfterDelete?: (taskId: string) => void;
}): TaskRowActionsResult {
  const completeTaskMutation = useCompleteTask();
  const scheduleTaskMutation = useScheduleTask();
  const toggleFlagMutation = useToggleFlag();
  const archiveTaskMutation = useArchiveTask();
  const restoreTaskMutation = useRestoreTask();
  const undoable = useUndoableAction();
  const reduceMotion = useReducedMotion();

  function titleOf(taskId: string): string {
    return tasks.find((task) => task.id === taskId)?.title ?? "Task";
  }

  const actions: TaskRowActions = {
    onComplete(taskId, done) {
      completeTaskMutation.mutate({ id: taskId, done });
      undoable.perform({
        inverse: () => completeTaskMutation.mutate({ id: taskId, done: !done }),
        kind: done ? "completed" : "reopened",
        label: titleOf(taskId),
      });
    },

    onDelete(taskId) {
      archiveTaskMutation.mutate(taskId);
      onAfterDelete?.(taskId);
      undoable.perform({
        inverse: () => restoreTaskMutation.mutate(taskId),
        kind: "deleted",
        label: titleOf(taskId),
      });
    },

    onOpen,

    // The row's When chip and its hover affordance are themselves scheduler
    // popovers, so by the time this runs the student has already picked a
    // date — this only writes it. That is what keeps "reschedule from any
    // surface" at two clicks (spec §13).
    onSchedule(taskId, field, value) {
      const previousValue =
        tasks.find((task) => task.id === taskId)?.[field] ?? null;
      scheduleTaskMutation.mutate({ id: taskId, field, value });
      undoable.perform({
        inverse: () =>
          scheduleTaskMutation.mutate({
            id: taskId,
            field,
            value: previousValue,
          }),
        kind: "rescheduled",
        label: titleOf(taskId),
      });
    },

    onToggleFlag(taskId) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        return;
      }
      toggleFlagMutation.mutate({ id: taskId, flagged: !task.flagged });
    },
  };

  return {
    actions,
    undo: undoable.undo,
    undoToastProps: {
      onDismiss: undoable.clearPending,
      onUndo: undoable.undo,
      pending: undoable.pending,
      reduceMotion: reduceMotion ?? false,
    },
  };
}
