import { useMutation, useQuery } from "@tanstack/react-query"

import { handleMutationError, tempTask } from "@/api/workspace/hook-utils"
import {
  invalidateApplicationDetail,
  invalidateApplicationDetails,
  type Snapshot,
  type TempSnapshot,
  uniqueIds,
} from "@/api/workspace/hooks/shared"
import { workspaceKeys } from "@/api/workspace/keys"
import {
  insertAtStart,
  nowIso,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic"
import {
  archiveTask,
  bulkArchiveTasks,
  bulkUpdateTaskStatus,
  createTask,
  listTasks,
  restoreTask,
  updateTask,
} from "@/api/workspace/tasks"
import type { Task, TaskPatch, TaskStatus } from "@/api/workspace/types"

type TaskListSnapshot = Snapshot<Task[]> & {
  applicationIds: string[]
}

export function useTasks() {
  return useQuery({ queryKey: workspaceKeys.tasks.list(), queryFn: listTasks })
}

export function useCreateTask() {
  return useMutation({
    mutationFn: createTask,
    onMutate: async (input, context): Promise<TempSnapshot<Task[]>> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.tasks.list() })
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      )
      const optimistic = tempTask(input)
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        insertAtStart(current, optimistic),
      )
      return { previous, tempId: optimistic.id }
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (task, _input, snapshot, context) => {
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        replaceTempById(current, snapshot.tempId, task),
      )
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetail(context.client, _data?.application_id ?? _input.application_id)
    },
  })
}

export function useUpdateTask() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      updateTask(id, patch),
    onMutate: async ({ id, patch }, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.tasks.list() })
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      )
      const previousTask = previous?.find((task) => task.id === id)
      const timestamp = nowIso()
      const optimisticPatch =
        patch.status !== undefined
          ? {
              ...patch,
              completed_at:
                patch.status === "done"
                  ? (previousTask?.completed_at ?? timestamp)
                  : null,
              updated_at: timestamp,
            }
          : { ...patch, updated_at: timestamp }
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        patchById(current, id, optimisticPatch),
      )
      return {
        previous,
        applicationIds: uniqueIds([previousTask?.application_id, patch.application_id]),
      }
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (task, { id }, _snapshot, context) => {
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        replaceById(current, id, task),
      )
    },
    onSettled: (_data, _error, _vars, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, [
        _data?.application_id,
        _vars.patch.application_id,
        ...(snapshot?.applicationIds ?? []),
      ])
    },
  })
}

export function useBulkUpdateTaskStatus() {
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: TaskStatus }) =>
      bulkUpdateTaskStatus(ids, status),
    onMutate: async ({ ids, status }, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.tasks.list() })
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      )
      const movingIds = new Set(ids)
      const applicationIds = uniqueIds(
        previous
          ?.filter((task) => movingIds.has(task.id))
          .map((task) => task.application_id) ?? [],
      )
      const timestamp = nowIso()
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        current?.map((task) =>
          movingIds.has(task.id)
            ? {
                ...task,
                status,
                completed_at:
                  status === "done" ? (task.completed_at ?? timestamp) : null,
                updated_at: timestamp,
              }
            : task,
        ),
      )
      return { previous, applicationIds }
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (tasks, _vars, _snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), tasks)
    },
    onSettled: (_data, _error, _vars, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, [
        ...(_data?.map((task) => task.application_id) ?? []),
        ...(snapshot?.applicationIds ?? []),
      ])
    },
  })
}

export function useArchiveTask() {
  return useMutation({
    mutationFn: archiveTask,
    onMutate: async (id, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.tasks.list() })
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      )
      const task = previous?.find((item) => item.id === id)
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        removeById(current, id),
      )
      return { previous, applicationIds: uniqueIds([task?.application_id]) }
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, snapshot?.applicationIds ?? [])
    },
  })
}

export function useRestoreTask() {
  return useMutation({
    mutationFn: restoreTask,
    onSuccess: (task, _id, _snapshot, context) => {
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        insertAtStart(current, task),
      )
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (task, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetail(context.client, task?.application_id)
    },
  })
}

export function useBulkArchiveTasks() {
  return useMutation({
    mutationFn: bulkArchiveTasks,
    onMutate: async (ids, context): Promise<TaskListSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.tasks.list() })
      const previous = context.client.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      )
      const removingIds = new Set(ids)
      const applicationIds = uniqueIds(
        previous
          ?.filter((task) => removingIds.has(task.id))
          .map((task) => task.application_id) ?? [],
      )
      context.client.setQueryData<Task[]>(workspaceKeys.tasks.list(), (current) =>
        current?.filter((task) => !removingIds.has(task.id)),
      )
      return { previous, applicationIds }
    },
    onError: (error, _ids, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.tasks.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _ids, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, [
        ...(_data?.map((task) => task.application_id) ?? []),
        ...(snapshot?.applicationIds ?? []),
      ])
    },
  })
}
