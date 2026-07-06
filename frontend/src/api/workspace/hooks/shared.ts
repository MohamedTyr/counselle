import { useMutation, type QueryClient } from "@tanstack/react-query"

import { workspaceKeys } from "@/api/workspace/keys"
import {
  appendItem,
  insertAtStart,
  nowIso,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic"
import { handleMutationError } from "@/api/workspace/hook-utils"

export type Snapshot<T> = { previous: T | undefined }
export type TempSnapshot<T> = Snapshot<T> & { tempId: string }

export function uniqueIds(ids: readonly (string | null | undefined)[]) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}

export function invalidateApplicationDetail(
  client: QueryClient,
  applicationId: string | null | undefined,
) {
  if (!applicationId) {
    return
  }
  void client.invalidateQueries({
    queryKey: workspaceKeys.applications.detail(applicationId),
  })
}

export function invalidateApplicationDetails(
  client: QueryClient,
  applicationIds: readonly (string | null | undefined)[],
) {
  uniqueIds(applicationIds).forEach((applicationId) => {
    invalidateApplicationDetail(client, applicationId)
  })
}

export function useCreateInList<TItem extends { id: string }, TInput>(
  queryKey: readonly unknown[],
  createFn: (input: TInput) => Promise<TItem>,
  makeTemp: (input: TInput, current: TItem[] | undefined) => TItem,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
) {
  return useMutation({
    mutationFn: createFn,
    onMutate: async (input, context): Promise<TempSnapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey })
      const previous = context.client.getQueryData<TItem[]>(queryKey)
      const optimistic = makeTemp(input, previous)
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        appendItem(current, optimistic),
      )
      return { previous, tempId: optimistic.id }
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (item, _input, snapshot, context) => {
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        replaceTempById(current, snapshot.tempId, item),
      )
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey })
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key })
      })
    },
  })
}

export function useUpdateInList<
  TItem extends { id: string; updated_at: string },
  TPatch,
>(
  queryKey: readonly unknown[],
  updateFn: (id: string, patch: TPatch) => Promise<TItem>,
) {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TPatch }) =>
      updateFn(id, patch),
    onMutate: async ({ id, patch }, context): Promise<Snapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey })
      const previous = context.client.getQueryData<TItem[]>(queryKey)
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        patchById(current, id, { ...(patch as Partial<TItem>), updated_at: nowIso() }),
      )
      return { previous }
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (item, { id }, _snapshot, context) => {
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        replaceById(current, id, item),
      )
    },
    onSettled: (_data, _error, _vars, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey })
    },
  })
}

export function useArchiveFromList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  archiveFn: (id: string) => Promise<unknown>,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
) {
  return useMutation({
    mutationFn: archiveFn,
    onMutate: async (id, context): Promise<Snapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey })
      const previous = context.client.getQueryData<TItem[]>(queryKey)
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        removeById(current, id),
      )
      return { previous }
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous)
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey })
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key })
      })
    },
  })
}

export function useRestoreToList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  restoreFn: (id: string) => Promise<TItem>,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
) {
  return useMutation({
    mutationFn: restoreFn,
    onSuccess: (item, _id, _snapshot, context) => {
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        insertAtStart(current, item),
      )
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey })
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key })
      })
    },
  })
}

export function useReorderList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  reorderFn: (ids: string[]) => Promise<TItem[]>,
) {
  return useMutation({
    mutationFn: reorderFn,
    onMutate: async (ids, context): Promise<Snapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey })
      const previous = context.client.getQueryData<TItem[]>(queryKey)
      const order = new Map(ids.map((id, index) => [id, index]))
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        current
          ? [...current].sort((a, b) => order.get(a.id)! - order.get(b.id)!)
          : current,
      )
      return { previous }
    },
    onError: (error, _ids, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (items, _ids, _snapshot, context) => {
      context.client.setQueryData(queryKey, items)
    },
    onSettled: (_data, _error, _ids, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey })
    },
  })
}
