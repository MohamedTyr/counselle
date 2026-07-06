import { useMutation, useQuery } from "@tanstack/react-query"

import {
  addApplication,
  archiveApplication,
  getApplication,
  listApplications,
  restoreApplication,
  searchSchools,
  updateApplication,
} from "@/api/workspace/applications"
import { handleMutationError, tempApplication } from "@/api/workspace/hook-utils"
import { workspaceKeys } from "@/api/workspace/keys"
import {
  insertAtStart,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic"
import type {
  ApplicationDetail,
  ApplicationPatch,
  ApplicationView,
  SchoolSearchResult,
} from "@/api/workspace/types"
import type { Snapshot, TempSnapshot } from "@/api/workspace/hooks/shared"

type ApplicationUpdateSnapshot = Snapshot<ApplicationView[]> & {
  previousDetail: ApplicationDetail | undefined
}

export function useSchoolSearch(query: string, limit = 8) {
  return useQuery<SchoolSearchResult[]>({
    queryKey: workspaceKeys.schoolSearch(query),
    queryFn: () => searchSchools(query, limit),
    enabled: query.trim().length > 0,
  })
}

export function useApplications() {
  return useQuery({
    queryKey: workspaceKeys.applications.list(),
    queryFn: listApplications,
  })
}

export function useApplication(applicationId: string | null) {
  return useQuery({
    queryKey: workspaceKeys.applications.detail(applicationId ?? ""),
    queryFn: () => getApplication(applicationId ?? ""),
    enabled: applicationId !== null,
  })
}

export function useAddApplication() {
  return useMutation({
    mutationFn: addApplication,
    onMutate: async (input, context): Promise<TempSnapshot<ApplicationView[]>> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )
      const optimistic = tempApplication(input)
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => insertAtStart(current, optimistic),
      )
      return { previous, tempId: optimistic.id }
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.applications.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSuccess: (result, _input, snapshot, context) => {
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => replaceTempById(current, snapshot.tempId, result.application),
      )
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
    },
  })
}

export function useUpdateApplication() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ApplicationPatch }) =>
      updateApplication(id, patch),
    onMutate: async ({ id, patch }, context): Promise<ApplicationUpdateSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.detail(id),
      })
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )
      const previousDetail = context.client.getQueryData<ApplicationDetail>(
        workspaceKeys.applications.detail(id),
      )
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => patchById(current, id, patch),
      )
      context.client.setQueryData<ApplicationDetail>(
        workspaceKeys.applications.detail(id),
        (current) =>
          current
            ? { ...current, application: { ...current.application, ...patch } }
            : current,
      )
      return { previous, previousDetail }
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.applications.list(), snapshot?.previous)
      context.client.setQueryData(
        workspaceKeys.applications.detail(_vars.id),
        snapshot?.previousDetail,
      )
      handleMutationError(error, context)
    },
    onSuccess: (application, { id }, _snapshot, context) => {
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => replaceById(current, id, application),
      )
    },
    onSettled: (_data, _error, vars, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(vars.id),
      })
    },
  })
}

export function useArchiveApplication() {
  return useMutation({
    mutationFn: archiveApplication,
    onMutate: async (id, context): Promise<Snapshot<ApplicationView[]>> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => removeById(current, id),
      )
      return { previous }
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(workspaceKeys.applications.list(), snapshot?.previous)
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(id),
      })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
    },
  })
}

export function useRestoreApplication() {
  return useMutation({
    mutationFn: restoreApplication,
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      })
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(id),
      })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.tasks.list() })
      void context.client.invalidateQueries({ queryKey: workspaceKeys.essays.list() })
    },
  })
}
