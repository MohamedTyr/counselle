import { usePrivateMutation } from "@/app/private-mutations";
import { useQuery } from "@tanstack/react-query";

import { handleMutationError, tempTask } from "@/api/workspace/hook-utils";
import {
  invalidateApplicationDetail,
  invalidateApplicationDetails,
  type Snapshot,
  type TempSnapshot,
  uniqueIds,
  useReorderList,
} from "@/api/workspace/hooks/shared";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  insertAtStart,
  nowIso,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic";
import {
  archiveTask,
  createTask,
  listTasks,
  reorderTasks,
  restoreTask,
  updateTask,
} from "@/api/workspace/tasks";
import type { Task, TaskPatch } from "@/api/workspace/types";

type TaskListSnapshot = Snapshot<Task[]> & {
  applicationIds: string[];
};

export function useTasks() {
  return useQuery({ queryKey: workspaceKeys.tasks.list(), queryFn: listTasks });
}

export function useCreateTask() {
  return usePrivateMutation({
    mutationFn: createTask,
    onMutate: async (input, context): Promise<TempSnapshot<Task[]>> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      context.assertCurrent();
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      );
      const optimistic = tempTask(input);
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => insertAtStart(current, optimistic),
      );
      return { previous, tempId: optimistic.id };
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.tasks.list(),
        snapshot?.previous,
      );
      handleMutationError(error, context);
    },
    onSuccess: (task, _input, snapshot, context) => {
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => replaceTempById(current, snapshot.tempId, task),
      );
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      invalidateApplicationDetail(
        context.client,
        _data?.application_id ?? _input.application_id,
      );
    },
  });
}

export function useUpdateTask() {
  return usePrivateMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      updateTask(id, patch),
    onMutate: async ({ id, patch }, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      context.assertCurrent();
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      );
      const previousTask = previous?.find((task) => task.id === id);
      const timestamp = nowIso();
      const optimisticPatch =
        patch.done_at !== undefined
          ? {
              ...patch,
              status: patch.done_at ? ("done" as const) : ("todo" as const),
              completed_at: patch.done_at,
              updated_at: timestamp,
            }
          : { ...patch, updated_at: timestamp };
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => patchById(current, id, optimisticPatch),
      );
      return {
        previous,
        applicationIds: uniqueIds([
          previousTask?.application_id,
          patch.application_id,
        ]),
      };
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.tasks.list(),
        snapshot?.previous,
      );
      handleMutationError(error, context);
    },
    onSuccess: (task, { id }, _snapshot, context) => {
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => replaceById(current, id, task),
      );
    },
    onSettled: (_data, _error, _vars, snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      invalidateApplicationDetails(context.client, [
        _data?.application_id,
        _vars.patch.application_id,
        ...(snapshot?.applicationIds ?? []),
      ]);
    },
  });
}

/**
 * Thin wrappers around `useUpdateTask`'s mutation. Each builds the right
 * `TaskPatch` and delegates — none re-implements the optimistic machinery.
 */
export function useCompleteTask() {
  const { mutate, mutateAsync, ...rest } = useUpdateTask();
  const buildVars = ({ id, done }: { id: string; done: boolean }) => ({
    id,
    patch: { done_at: done ? nowIso() : null } as TaskPatch,
  });
  return {
    ...rest,
    mutate: (vars: { id: string; done: boolean }) => mutate(buildVars(vars)),
    mutateAsync: (vars: { id: string; done: boolean }) =>
      mutateAsync(buildVars(vars)),
  };
}

export function useScheduleTask() {
  const { mutate, mutateAsync, ...rest } = useUpdateTask();
  const buildVars = ({
    id,
    field,
    value,
  }: {
    id: string;
    field: "when_on" | "deadline_on";
    value: string | null;
  }) => ({ id, patch: { [field]: value } as TaskPatch });
  return {
    ...rest,
    mutate: (vars: {
      id: string;
      field: "when_on" | "deadline_on";
      value: string | null;
    }) => mutate(buildVars(vars)),
    mutateAsync: (vars: {
      id: string;
      field: "when_on" | "deadline_on";
      value: string | null;
    }) => mutateAsync(buildVars(vars)),
  };
}

export function useToggleFlag() {
  const { mutate, mutateAsync, ...rest } = useUpdateTask();
  const buildVars = ({ id, flagged }: { id: string; flagged: boolean }) => ({
    id,
    patch: { flagged } as TaskPatch,
  });
  return {
    ...rest,
    mutate: (vars: { id: string; flagged: boolean }) => mutate(buildVars(vars)),
    mutateAsync: (vars: { id: string; flagged: boolean }) =>
      mutateAsync(buildVars(vars)),
  };
}

export function useArchiveTask() {
  return usePrivateMutation({
    mutationFn: archiveTask,
    onMutate: async (id, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      context.assertCurrent();
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      );
      const task = previous?.find((item) => item.id === id);
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => removeById(current, id),
      );
      return { previous, applicationIds: uniqueIds([task?.application_id]) };
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.tasks.list(),
        snapshot?.previous,
      );
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, _id, snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      invalidateApplicationDetails(
        context.client,
        snapshot?.applicationIds ?? [],
      );
    },
  });
}

export function useRestoreTask() {
  return usePrivateMutation({
    mutationFn: restoreTask,
    onSuccess: (task, _id, _snapshot, context) => {
      context.client.setQueryData<Task[]>(
        workspaceKeys.tasks.list(),
        (current) => insertAtStart(current, task),
      );
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context);
    },
    onSettled: (task, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      invalidateApplicationDetail(context.client, task?.application_id);
    },
  });
}

/**
 * Today's manual reorder (plan P9, spec §6.1). `ids` is Today's visible
 * subset, not the whole active-task set — `reorder_tasks` on the backend
 * returns the user's full task list precisely so this settles the one
 * `workspaceKeys.tasks.list()` cache entry back to something authoritative
 * instead of shrinking it to just the reordered rows.
 */
export function useReorderTasks() {
  return useReorderList(workspaceKeys.tasks.list(), reorderTasks);
}
