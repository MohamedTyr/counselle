import { useMutation, useQuery } from "@tanstack/react-query"

import {
  archiveEssay,
  createEssay,
  duplicateEssay,
  getEssay,
  listEssays,
  restoreEssay,
  updateEssay,
} from "@/api/workspace/essays"
import { handleMutationError, tempEssay } from "@/api/workspace/hook-utils"
import {
  invalidateApplicationDetail,
  invalidateApplicationDetails,
  type Snapshot,
  type TempSnapshot,
  uniqueIds,
} from "@/api/workspace/hooks/shared"
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
import type { Essay, EssayPatch, EssaySummary } from "@/api/workspace/types"

type EssayUpdateSnapshot = Snapshot<EssaySummary[]> & {
  applicationIds: string[]
  previousDetail: Essay | undefined
}

type EssayListSnapshot = Snapshot<EssaySummary[]> & {
  applicationIds: string[]
  previousDetail: Essay | undefined
}

export function useEssays() {
  return useQuery({ queryKey: workspaceKeys.essays.list(), queryFn: listEssays })
}

export function useEssay(essayId: string | null) {
  return useQuery({
    queryKey: workspaceKeys.essays.detail(essayId ?? ""),
    queryFn: () => getEssay(essayId ?? ""),
    enabled: essayId !== null,
  })
}

export function useCreateEssay() {
  return useMutation({
    mutationFn: createEssay,
    onMutate: async (input, context): Promise<TempSnapshot<EssaySummary[]>> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.essays.list() })
      const previous = context.client.getQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
      )
      const optimistic = tempEssay(input)
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => appendItem(current, optimistic),
      )
      return { previous, tempId: optimistic.id }
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.essays.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (essay, _input, snapshot, context) => {
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => replaceTempById(current, snapshot.tempId, essay),
      )
    },
    onSettled: (essay, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetail(context.client, essay?.application_id ?? input.application_id)
    },
  })
}

export function useUpdateEssay() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EssayPatch }) =>
      updateEssay(id, patch),
    onMutate: async ({ id, patch }, context): Promise<EssayUpdateSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.essays.list() })
      await context.client.cancelQueries({
        queryKey: workspaceKeys.essays.detail(id),
      })
      const previous = context.client.getQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
      )
      const previousDetail = context.client.getQueryData<Essay>(
        workspaceKeys.essays.detail(id),
      )
      const previousEssay = previous?.find((essay) => essay.id === id)
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => patchById(current, id, { ...patch, updated_at: nowIso() }),
      )
      context.client.setQueryData<Essay>(
        workspaceKeys.essays.detail(id),
        (current) => (current ? { ...current, ...patch } : current),
      )
      return {
        applicationIds: uniqueIds([
          previousDetail?.application_id,
          previousEssay?.application_id,
          patch.application_id,
        ]),
        previous,
        previousDetail,
      }
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.essays.list(), snapshot?.previous)
      context.client.setQueryData(
        workspaceKeys.essays.detail(_vars.id),
        snapshot?.previousDetail,
      )
      handleMutationError(error, context)
    },
    onSuccess: (essay, { id }, _snapshot, context) => {
      context.client.setQueryData<Essay>(workspaceKeys.essays.detail(id), essay)
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => replaceById(current, id, essay),
      )
    },
    onSettled: (_data, _error, vars, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.detail(vars.id),
      })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, [
        _data?.application_id,
        vars.patch.application_id,
        ...(snapshot?.applicationIds ?? []),
      ])
    },
  })
}

export function useArchiveEssay() {
  return useMutation({
    mutationFn: archiveEssay,
    onMutate: async (id, context): Promise<EssayListSnapshot> => {
      await context.client.cancelQueries({ queryKey: workspaceKeys.essays.list() })
      await context.client.cancelQueries({
        queryKey: workspaceKeys.essays.detail(id),
      })
      const previous = context.client.getQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
      )
      const previousDetail = context.client.getQueryData<Essay>(
        workspaceKeys.essays.detail(id),
      )
      const essay = previousDetail ?? previous?.find((item) => item.id === id)
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => removeById(current, id),
      )
      context.client.removeQueries({
        queryKey: workspaceKeys.essays.detail(id),
        exact: true,
      })
      return {
        previous,
        previousDetail,
        applicationIds: uniqueIds([essay?.application_id]),
      }
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.essays.list(), snapshot?.previous)
      if (snapshot?.previousDetail) {
        context.client.setQueryData(
          workspaceKeys.essays.detail(_id),
          snapshot.previousDetail,
        )
      }
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, id, snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.detail(id),
      })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetails(context.client, snapshot?.applicationIds ?? [])
    },
  })
}

export function useRestoreEssay() {
  return useMutation({
    mutationFn: restoreEssay,
    onSuccess: (essay, _id, _snapshot, context) => {
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => insertAtStart(current, essay),
      )
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (essay, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetail(context.client, essay?.application_id)
    },
  })
}

export function useDuplicateEssay() {
  return useMutation({
    mutationFn: duplicateEssay,
    onSuccess: (essay, _id, _snapshot, context) => {
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => insertAtStart(current, essay),
      )
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      invalidateApplicationDetail(context.client, _data?.application_id)
    },
  })
}
