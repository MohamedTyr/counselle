import { useMutation, useQuery } from "@tanstack/react-query";

import {
  addApplication,
  archiveApplication,
  getApplication,
  listApplications,
  restoreApplication,
  searchSchools,
  updateApplication,
} from "@/api/workspace/applications";
import {
  handleMutationError,
  tempApplication,
} from "@/api/workspace/hook-utils";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  insertAtStart,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic";
import type {
  ApplicationCreate,
  ApplicationDetail,
  ApplicationPatch,
  ApplicationView,
  SchoolSearchResult,
} from "@/api/workspace/types";
import type { Snapshot, TempSnapshot } from "@/api/workspace/hooks/shared";

type ApplicationUpdateSnapshot = Snapshot<ApplicationView[]> & {
  previousDetail: ApplicationDetail | undefined;
};

type AddApplicationVariables = ApplicationCreate & {
  optimisticSchool?: SchoolSearchResult;
};

export function useSchoolSearch(query: string, limit = 8) {
  return useQuery<SchoolSearchResult[]>({
    queryKey: workspaceKeys.schoolSearch(query),
    queryFn: () => searchSchools(query, limit),
    enabled: query.trim().length > 0,
  });
}

export function useApplications() {
  return useQuery({
    queryKey: workspaceKeys.applications.list(),
    queryFn: listApplications,
  });
}

export function useApplication(applicationId: string | null) {
  return useQuery({
    queryKey: workspaceKeys.applications.detail(applicationId ?? ""),
    queryFn: () => getApplication(applicationId ?? ""),
    enabled: applicationId !== null,
  });
}

export function useAddApplication() {
  return useMutation({
    mutationFn: (variables: AddApplicationVariables) => {
      const { optimisticSchool, ...input } = variables;
      void optimisticSchool;
      return addApplication(input);
    },
    onMutate: async (
      input,
      context,
    ): Promise<TempSnapshot<ApplicationView[]>> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      );
      const optimistic = tempApplication(input, input.optimisticSchool);
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => insertAtStart(current, optimistic),
      );
      return { previous, tempId: optimistic.id };
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.applications.list(),
        snapshot?.previous,
      );
      handleMutationError(error, context);
    },
    onSuccess: (result, _input, snapshot, context) => {
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) =>
          replaceTempById(current, snapshot.tempId, result.application),
      );
      context.client.setQueriesData<SchoolSearchResult[]>(
        { queryKey: workspaceKeys.schoolSearchAll() },
        (current) =>
          current?.map((school) =>
            school.unitid === result.application.school_unitid
              ? {
                  ...school,
                  active_cycle_years: [
                    ...new Set([
                      ...school.active_cycle_years,
                      ...(result.application.cycle_year
                        ? [result.application.cycle_year]
                        : []),
                    ]),
                  ],
                  on_list: true,
                }
              : school,
          ),
      );
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.schoolSearchAll(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.schoolSearchAll(),
      });
    },
  });
}

export function useUpdateApplication() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ApplicationPatch }) =>
      updateApplication(id, patch),
    onMutate: async (
      { id, patch },
      context,
    ): Promise<ApplicationUpdateSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.detail(id),
      });
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      );
      const previousDetail = context.client.getQueryData<ApplicationDetail>(
        workspaceKeys.applications.detail(id),
      );
      const { checklist, ...applicationPatch } = patch;
      const listPatch: Partial<ApplicationView> = checklist
        ? {
            ...applicationPatch,
            checklist: Object.fromEntries(
              Object.entries({
                ...(previous?.find((application) => application.id === id)
                  ?.checklist ?? {}),
                ...checklist,
              }).filter(([, value]) => value !== null),
            ),
          }
        : applicationPatch;
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => patchById<ApplicationView>(current, id, listPatch),
      );
      const cycleChanged =
        "cycle_year" in patch &&
        patch.cycle_year !== previousDetail?.application.cycle_year;
      if (!cycleChanged) {
        context.client.setQueryData<ApplicationDetail>(
          workspaceKeys.applications.detail(id),
          (current) => {
            if (!current) return current;
            return {
              ...current,
              application: {
                ...current.application,
                ...patch,
                checklist: patch.checklist
                  ? Object.fromEntries(
                      Object.entries({
                        ...current.application.checklist,
                        ...patch.checklist,
                      }).filter(([, value]) => value !== null),
                    )
                  : current.application.checklist,
              },
            };
          },
        );
      }
      return { previous, previousDetail };
    },
    onError: (error, _vars, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.applications.list(),
        snapshot?.previous,
      );
      context.client.setQueryData(
        workspaceKeys.applications.detail(_vars.id),
        snapshot?.previousDetail,
      );
      handleMutationError(error, context);
    },
    onSuccess: (application, { id }, _snapshot, context) => {
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => replaceById(current, id, application),
      );
    },
    onSettled: (_data, _error, vars, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(vars.id),
      });
    },
  });
}

export function useArchiveApplication() {
  return useMutation({
    mutationFn: archiveApplication,
    onMutate: async (id, context): Promise<Snapshot<ApplicationView[]>> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      const previous = context.client.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      );
      context.client.setQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
        (current) => removeById(current, id),
      );
      return { previous };
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.applications.list(),
        snapshot?.previous,
      );
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.schoolSearchAll(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(id),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.schoolSearchAll(),
      });
    },
  });
}

export function useRestoreApplication() {
  return useMutation({
    mutationFn: restoreApplication,
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.schoolSearchAll(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(id),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.tasks.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.list(),
      });
    },
  });
}
