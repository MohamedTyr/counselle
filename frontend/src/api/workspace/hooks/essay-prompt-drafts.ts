import { useMutation, useQuery } from "@tanstack/react-query";

import {
  archiveEssayPromptDraft,
  convertEssayPromptDraft,
  createEssayPromptDraft,
  listEssayPromptDrafts,
  restoreEssayPromptDraft,
} from "@/api/workspace/essay-prompt-drafts";
import { handleMutationError, tempEssayPromptDraft } from "@/api/workspace/hook-utils";
import type { Snapshot, TempSnapshot } from "@/api/workspace/hooks/shared";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  appendItem,
  insertAtStart,
  removeById,
  replaceTempById,
} from "@/api/workspace/optimistic";
import type {
  ApplicationDetail,
  Essay,
  EssayPromptDraftCreate,
  EssayPromptDraftSummary,
  EssaySummary,
} from "@/api/workspace/types";

function patchDetailDrafts(
  client: {
    setQueryData: <T>(
      key: readonly unknown[],
      updater: (current: T | undefined) => T | undefined,
    ) => unknown;
  },
  applicationId: string | undefined,
  update: (
    drafts: EssayPromptDraftSummary[] | undefined,
  ) => EssayPromptDraftSummary[] | undefined,
) {
  if (!applicationId) return;
  client.setQueryData<ApplicationDetail>(
    workspaceKeys.applications.detail(applicationId),
    (current) =>
      current
        ? { ...current, prompt_drafts: update(current.prompt_drafts) ?? [] }
        : current,
  );
}

type CreateSnapshot = TempSnapshot<EssayPromptDraftSummary[]> & {
  previousDetail: ApplicationDetail | undefined;
};

export function useEssayPromptDrafts() {
  return useQuery({
    queryKey: workspaceKeys.essayPromptDrafts.list(),
    queryFn: listEssayPromptDrafts,
  });
}

export function useCreateEssayPromptDraft() {
  return useMutation({
    mutationFn: createEssayPromptDraft,
    onMutate: async (
      input: EssayPromptDraftCreate,
      context,
    ): Promise<CreateSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      await context.client.cancelQueries({
        queryKey: workspaceKeys.applications.detail(input.application_id),
      });
      const previous = context.client.getQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
      );
      const previousDetail = context.client.getQueryData<ApplicationDetail>(
        workspaceKeys.applications.detail(input.application_id),
      );
      const school = previousDetail
        ? {
            name: previousDetail.application.school_name,
            city: previousDetail.application.school_city,
            state: previousDetail.application.school_state,
            website_url: previousDetail.application.website_url,
          }
        : undefined;
      const optimistic = tempEssayPromptDraft(input, school);
      context.client.setQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
        (current) => appendItem(current, optimistic),
      );
      patchDetailDrafts(context.client, input.application_id, (drafts) =>
        appendItem(drafts, optimistic),
      );
      return { previous, previousDetail, tempId: optimistic.id };
    },
    onError: (error, input, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.essayPromptDrafts.list(),
        snapshot?.previous,
      );
      context.client.setQueryData(
        workspaceKeys.applications.detail(input.application_id),
        snapshot?.previousDetail,
      );
      handleMutationError(error, context);
    },
    onSuccess: (draft, input, snapshot, context) => {
      context.client.setQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
        (current) => replaceTempById(current, snapshot.tempId, draft),
      );
      patchDetailDrafts(context.client, input.application_id, (drafts) =>
        replaceTempById(drafts, snapshot.tempId, draft),
      );
    },
    onSettled: (_data, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.applications.detail(input.application_id),
      });
    },
  });
}

type DraftMutateSnapshot = Snapshot<EssayPromptDraftSummary[]> & {
  previousDetail: ApplicationDetail | undefined;
  applicationId: string | undefined;
};

export function useArchiveEssayPromptDraft() {
  return useMutation({
    mutationFn: archiveEssayPromptDraft,
    onMutate: async (id, context): Promise<DraftMutateSnapshot> => {
      await context.client.cancelQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      const previous = context.client.getQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
      );
      const applicationId = previous?.find((draft) => draft.id === id)
        ?.application_id;
      const previousDetail = applicationId
        ? context.client.getQueryData<ApplicationDetail>(
            workspaceKeys.applications.detail(applicationId),
          )
        : undefined;
      context.client.setQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
        (current) => removeById(current, id),
      );
      patchDetailDrafts(context.client, applicationId, (drafts) =>
        removeById(drafts, id),
      );
      return { previous, previousDetail, applicationId };
    },
    onError: (error, id, snapshot, context) => {
      context.client.setQueryData(
        workspaceKeys.essayPromptDrafts.list(),
        snapshot?.previous,
      );
      if (snapshot?.applicationId) {
        context.client.setQueryData(
          workspaceKeys.applications.detail(snapshot.applicationId),
          snapshot.previousDetail,
        );
      }
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, _id, snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      if (snapshot?.applicationId) {
        void context.client.invalidateQueries({
          queryKey: workspaceKeys.applications.detail(snapshot.applicationId),
        });
      }
    },
  });
}

export function useRestoreEssayPromptDraft() {
  return useMutation({
    mutationFn: restoreEssayPromptDraft,
    onSuccess: (draft, _id, _snapshot, context) => {
      context.client.setQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
        (current) => insertAtStart(current, draft),
      );
      patchDetailDrafts(context.client, draft.application_id, (drafts) =>
        insertAtStart(drafts, draft),
      );
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context);
    },
    onSettled: (draft, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      if (draft?.application_id) {
        void context.client.invalidateQueries({
          queryKey: workspaceKeys.applications.detail(draft.application_id),
        });
      }
    },
  });
}

export function useConvertEssayPromptDraft() {
  return useMutation({
    mutationFn: ({
      id,
      title,
      essayType,
    }: {
      id: string;
      title: string;
      essayType?: Essay["essay_type"];
    }) => convertEssayPromptDraft(id, { title, essay_type: essayType }),
    onSuccess: (essay, { id }, _snapshot, context) => {
      context.client.setQueryData<EssayPromptDraftSummary[]>(
        workspaceKeys.essayPromptDrafts.list(),
        (current) => removeById(current, id),
      );
      patchDetailDrafts(context.client, essay.application_id ?? undefined, (drafts) =>
        removeById(drafts, id),
      );
      context.client.setQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
        (current) => insertAtStart(current, essay),
      );
    },
    onError: (error, _vars, _snapshot, context) => {
      handleMutationError(error, context);
    },
    onSettled: (essay, _error, _vars, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essayPromptDrafts.list(),
      });
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.essays.list(),
      });
      if (essay?.application_id) {
        void context.client.invalidateQueries({
          queryKey: workspaceKeys.applications.detail(essay.application_id),
        });
      }
    },
  });
}
