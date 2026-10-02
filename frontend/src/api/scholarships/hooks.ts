import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createScholarship,
  getScholarship,
  listAll,
  listPublished,
  readSavedIds,
  setScholarshipStatus,
  updateScholarship,
  writeSavedIds,
} from "@/api/scholarships/mock-db";
import type { Scholarship, ScholarshipDraft, ScholarshipStatus } from "@/api/scholarships/types";

export const scholarshipKeys = {
  all: ["scholarships"] as const,
  published: () => [...scholarshipKeys.all, "published"] as const,
  admin: () => [...scholarshipKeys.all, "admin"] as const,
  detail: (id: string) => [...scholarshipKeys.all, "detail", id] as const,
  saved: () => [...scholarshipKeys.all, "saved"] as const,
};

export function useScholarships() {
  return useQuery({ queryKey: scholarshipKeys.published(), queryFn: listPublished });
}

export function useAdminScholarships() {
  return useQuery({ queryKey: scholarshipKeys.admin(), queryFn: listAll });
}

export function useAdminScholarship(id: string | null) {
  return useQuery({
    queryKey: scholarshipKeys.detail(id ?? "new"),
    queryFn: () => getScholarship(id as string),
    enabled: id !== null,
    retry: false,
  });
}

export function useSavedScholarshipIds() {
  return useQuery({
    queryKey: scholarshipKeys.saved(),
    queryFn: () => Promise.resolve(readSavedIds()),
    staleTime: Infinity,
  });
}

export function useToggleSavedScholarship() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const current = client.getQueryData<string[]>(scholarshipKeys.saved()) ?? [];
      const next = current.includes(id)
        ? current.filter((saved) => saved !== id)
        : [id, ...current];
      client.setQueryData(scholarshipKeys.saved(), next);
      return writeSavedIds(next);
    },
  });
}

export function useSaveScholarship() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: ScholarshipDraft }) =>
      id === null ? createScholarship(draft) : updateScholarship(id, draft),
    onSuccess: (saved: Scholarship) => {
      client.setQueryData(scholarshipKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: scholarshipKeys.admin() });
      void client.invalidateQueries({ queryKey: scholarshipKeys.published() });
    },
  });
}

/** Optimistic status change (publish, archive, restore) from the admin list. */
export function useSetScholarshipStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ScholarshipStatus }) =>
      setScholarshipStatus(id, status),
    onMutate: async ({ id, status }) => {
      await client.cancelQueries({ queryKey: scholarshipKeys.admin() });
      const previous = client.getQueryData<Scholarship[]>(scholarshipKeys.admin());
      client.setQueryData<Scholarship[]>(scholarshipKeys.admin(), (current) =>
        current?.map((item) => (item.id === id ? { ...item, status } : item)),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      client.setQueryData(scholarshipKeys.admin(), context?.previous);
    },
    onSettled: (saved) => {
      if (saved) client.setQueryData(scholarshipKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: scholarshipKeys.admin() });
      void client.invalidateQueries({ queryKey: scholarshipKeys.published() });
    },
  });
}
