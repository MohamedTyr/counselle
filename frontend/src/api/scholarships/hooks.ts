import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createScholarship,
  getAdminScholarship,
  listAdminScholarships,
  listSavedScholarshipIds,
  listScholarshipRevisions,
  listScholarships,
  markScholarshipChecked,
  saveScholarship,
  setScholarshipStatus,
  unsaveScholarship,
  updateScholarship,
} from "@/api/scholarships/client";
import { toastScholarshipError } from "@/api/scholarships/errors";
import type {
  AdminScholarship,
  SavedIds,
  ScholarshipDraft,
  ScholarshipStatus,
} from "@/api/scholarships/types";

export const scholarshipKeys = {
  all: ["scholarships"] as const,
  published: () => [...scholarshipKeys.all, "published"] as const,
  admin: () => [...scholarshipKeys.all, "admin"] as const,
  detail: (id: string) => [...scholarshipKeys.all, "detail", id] as const,
  revisions: (id: string) => [...scholarshipKeys.all, "revisions", id] as const,
  saved: () => [...scholarshipKeys.all, "saved"] as const,
};

export function useScholarships() {
  return useQuery({
    queryKey: scholarshipKeys.published(),
    queryFn: ({ signal }) => listScholarships(signal),
    select: (data) => data.items,
  });
}

export function useAdminScholarships() {
  return useQuery({
    queryKey: scholarshipKeys.admin(),
    queryFn: ({ signal }) => listAdminScholarships(signal),
  });
}

export function useAdminScholarship(id: string | null) {
  return useQuery({
    queryKey: scholarshipKeys.detail(id ?? "new"),
    queryFn: ({ signal }) => getAdminScholarship(id as string, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useSavedScholarshipIds() {
  return useQuery({
    queryKey: scholarshipKeys.saved(),
    queryFn: ({ signal }) => listSavedScholarshipIds(signal),
    select: (data) => data.ids,
  });
}

/** Optimistic save/unsave. A failure puts the star back and says so. */
export function useToggleSavedScholarship() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) =>
      save ? saveScholarship(id) : unsaveScholarship(id),
    onMutate: async ({ id, save }) => {
      await client.cancelQueries({ queryKey: scholarshipKeys.saved() });
      const previous = client.getQueryData<SavedIds>(scholarshipKeys.saved());
      const ids = (previous?.ids ?? []).filter((saved) => saved !== id);
      client.setQueryData<SavedIds>(scholarshipKeys.saved(), { ids: save ? [id, ...ids] : ids });
      return { previous };
    },
    onError: (error, _input, context) => {
      client.setQueryData(scholarshipKeys.saved(), context?.previous);
      toastScholarshipError(error);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: scholarshipKeys.saved() });
    },
  });
  return {
    isPending: mutation.isPending,
    toggle: (id: string) => {
      const current = client.getQueryData<SavedIds>(scholarshipKeys.saved())?.ids ?? [];
      mutation.mutate({ id, save: !current.includes(id) });
    },
  };
}

function useStoreRecord() {
  const client = useQueryClient();
  return (saved: AdminScholarship) => {
    client.setQueryData(scholarshipKeys.detail(saved.id), saved);
    void client.invalidateQueries({ queryKey: scholarshipKeys.admin() });
    void client.invalidateQueries({ queryKey: scholarshipKeys.published() });
    void client.invalidateQueries({ queryKey: scholarshipKeys.revisions(saved.id) });
  };
}

/** Create (`id === null`) or fully replace a record. Errors are the caller's to show. */
export function useSaveScholarship() {
  const store = useStoreRecord();
  return useMutation({
    mutationFn: ({
      id,
      draft,
      expected_version,
    }: {
      id: string | null;
      draft: ScholarshipDraft;
      expected_version: number | null;
    }) =>
      id === null || expected_version === null
        ? createScholarship(draft)
        : updateScholarship(id, draft, expected_version),
    onSuccess: store,
  });
}

/** Optimistic status change (publish, unpublish, archive, restore). */
export function useSetScholarshipStatus() {
  const client = useQueryClient();
  const store = useStoreRecord();
  return useMutation({
    mutationFn: ({
      id,
      status,
      expected_version,
    }: {
      id: string;
      status: ScholarshipStatus;
      expected_version?: number;
    }) => setScholarshipStatus(id, status, expected_version),
    onMutate: async ({ id, status }) => {
      await client.cancelQueries({ queryKey: scholarshipKeys.admin() });
      const previous = client.getQueryData<AdminScholarship[]>(scholarshipKeys.admin());
      client.setQueryData<AdminScholarship[]>(scholarshipKeys.admin(), (current) =>
        current?.map((item) => (item.id === id ? { ...item, status } : item)),
      );
      return { previous };
    },
    onError: (error, { id }, context) => {
      client.setQueryData(scholarshipKeys.admin(), context?.previous);
      void client.invalidateQueries({ queryKey: scholarshipKeys.detail(id) });
      toastScholarshipError(error);
    },
    onSuccess: store,
  });
}

/** "Mark checked today": sets `last_checked_on` and nothing else. */
export function useMarkChecked() {
  const client = useQueryClient();
  const store = useStoreRecord();
  return useMutation({
    mutationFn: (id: string) => markScholarshipChecked(id),
    onError: (error, id) => {
      void client.invalidateQueries({ queryKey: scholarshipKeys.detail(id) });
      toastScholarshipError(error);
    },
    onSuccess: store,
  });
}

export function useScholarshipRevisions(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: scholarshipKeys.revisions(id ?? "new"),
    queryFn: ({ signal }) => listScholarshipRevisions(id as string, signal),
    enabled: enabled && id !== null,
  });
}
