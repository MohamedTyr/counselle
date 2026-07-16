import { useRef } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";

import { workspaceKeys } from "@/api/workspace/keys";
import {
  appendItem,
  insertAtStart,
  nowIso,
  patchById,
  removeById,
  replaceById,
  replaceTempById,
} from "@/api/workspace/optimistic";
import { handleMutationError } from "@/api/workspace/hook-utils";

export type Snapshot<T> = { previous: T | undefined };
export type TempSnapshot<T> = Snapshot<T> & { tempId: string };
type UpdateSnapshot<T> = Snapshot<T> & { mutationId: number };
type MutationStatus = "pending" | "success" | "error";
type QueuedUpdate<TPatch, TItem> = {
  patch: TPatch;
  reject: (error: unknown) => void;
  resolve: (item: TItem) => void;
};

export function uniqueIds(ids: readonly (string | null | undefined)[]) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function invalidateApplicationDetail(
  client: QueryClient,
  applicationId: string | null | undefined,
) {
  if (!applicationId) {
    return;
  }
  void client.invalidateQueries({
    queryKey: workspaceKeys.applications.detail(applicationId),
  });
}

export function invalidateApplicationDetails(
  client: QueryClient,
  applicationIds: readonly (string | null | undefined)[],
) {
  uniqueIds(applicationIds).forEach((applicationId) => {
    invalidateApplicationDetail(client, applicationId);
  });
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
      await context.client.cancelQueries({ queryKey });
      const previous = context.client.getQueryData<TItem[]>(queryKey);
      const optimistic = makeTemp(input, previous);
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        appendItem(current, optimistic),
      );
      return { previous, tempId: optimistic.id };
    },
    onError: (error, _input, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous);
      handleMutationError(error, context);
    },
    onSuccess: (item, _input, snapshot, context) => {
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        replaceTempById(current, snapshot.tempId, item),
      );
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey });
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key });
      });
    },
  });
}

export function useUpdateInList<
  TItem extends { id: string; updated_at: string },
  TPatch,
>(
  queryKey: readonly unknown[],
  updateFn: (id: string, patch: TPatch) => Promise<TItem>,
) {
  const latestByIdRef = useRef(
    new Map<string, { mutationId: number; status: MutationStatus }>(),
  );
  const nextMutationIdRef = useRef(0);

  function isLatest(id: string, mutationId: number | undefined) {
    return (
      mutationId !== undefined &&
      latestByIdRef.current.get(id)?.mutationId === mutationId
    );
  }

  function latestFailedAfter(id: string, mutationId: number | undefined) {
    const latest = latestByIdRef.current.get(id);
    return (
      mutationId !== undefined &&
      latest !== undefined &&
      latest.mutationId > mutationId &&
      latest.status === "error"
    );
  }

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TPatch }) =>
      updateFn(id, patch),
    onMutate: async (
      { id, patch },
      context,
    ): Promise<UpdateSnapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey });
      const previous = context.client.getQueryData<TItem[]>(queryKey);
      const mutationId = nextMutationIdRef.current + 1;
      nextMutationIdRef.current = mutationId;
      latestByIdRef.current.set(id, { mutationId, status: "pending" });
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        patchById(current, id, {
          ...(patch as Partial<TItem>),
          updated_at: nowIso(),
        }),
      );
      return { mutationId, previous };
    },
    onError: (error, _vars, snapshot, context) => {
      if (snapshot && isLatest(_vars.id, snapshot.mutationId)) {
        latestByIdRef.current.set(_vars.id, {
          mutationId: snapshot.mutationId,
          status: "error",
        });
        context.client.setQueryData(queryKey, snapshot?.previous);
      }
      handleMutationError(error, context);
    },
    onSuccess: (item, { id }, snapshot, context) => {
      if (snapshot && isLatest(id, snapshot.mutationId)) {
        latestByIdRef.current.set(id, {
          mutationId: snapshot.mutationId,
          status: "success",
        });
        context.client.setQueryData<TItem[]>(queryKey, (current) =>
          replaceById(current, id, item),
        );
        return;
      }

      if (latestFailedAfter(id, snapshot?.mutationId)) {
        context.client.setQueryData<TItem[]>(queryKey, (current) =>
          replaceById(current, id, item),
        );
        void context.client.invalidateQueries({ queryKey });
      }
    },
    onSettled: (_data, _error, vars, snapshot, context) => {
      if (isLatest(vars.id, snapshot?.mutationId)) {
        void context.client.invalidateQueries({ queryKey });
      } else if (_data && latestFailedAfter(vars.id, snapshot?.mutationId)) {
        void context.client.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useQueuedUpdateInList<
  TItem extends { id: string; updated_at: string },
  TPatch extends object,
>(
  queryKey: readonly unknown[],
  updateFn: (id: string, patch: TPatch) => Promise<TItem>,
) {
  const activeByIdRef = useRef(new Map<string, Promise<void>>());
  const queuedByIdRef = useRef(new Map<string, QueuedUpdate<TPatch, TItem>>());

  function flushQueued(id: string) {
    const queued = queuedByIdRef.current.get(id);
    if (!queued) {
      return;
    }

    queuedByIdRef.current.delete(id);
    const request = updateFn(id, queued.patch);
    const active = request
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeByIdRef.current.delete(id);
        flushQueued(id);
      });
    activeByIdRef.current.set(
      id,
      active.catch(() => undefined),
    );
  }

  function enqueue(id: string, patch: TPatch) {
    if (!activeByIdRef.current.has(id)) {
      const request = updateFn(id, patch);
      const active = request.finally(() => {
        activeByIdRef.current.delete(id);
        flushQueued(id);
      });
      activeByIdRef.current.set(
        id,
        active.then(() => undefined, () => undefined),
      );
      return request;
    }

    const existing = queuedByIdRef.current.get(id);
    if (existing) {
      existing.patch = { ...existing.patch, ...patch };
      return new Promise<TItem>((resolve, reject) => {
        const previousResolve = existing.resolve;
        const previousReject = existing.reject;
        existing.resolve = (item) => {
          previousResolve(item);
          resolve(item);
        };
        existing.reject = (error) => {
          previousReject(error);
          reject(error);
        };
      });
    }

    return new Promise<TItem>((resolve, reject) => {
      queuedByIdRef.current.set(id, { patch, reject, resolve });
    });
  }

  return useUpdateInList(queryKey, enqueue);
}

export function useArchiveFromList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  archiveFn: (id: string) => Promise<unknown>,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
) {
  return useMutation({
    mutationFn: archiveFn,
    onMutate: async (id, context): Promise<Snapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey });
      const previous = context.client.getQueryData<TItem[]>(queryKey);
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        removeById(current, id),
      );
      return { previous };
    },
    onError: (error, _id, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous);
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey });
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key });
      });
    },
  });
}

export function useRestoreToList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  restoreFn: (id: string) => Promise<TItem>,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
  insertRestored: (
    current: TItem[] | undefined,
    item: TItem,
  ) => TItem[] = insertAtStart,
) {
  return useMutation({
    mutationFn: restoreFn,
    onSuccess: (item, _id, _snapshot, context) => {
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        insertRestored(current, item),
      );
    },
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context);
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey });
      alsoInvalidate.forEach((key) => {
        void context.client.invalidateQueries({ queryKey: key });
      });
    },
  });
}

export function useReorderList<TItem extends { id: string }>(
  queryKey: readonly unknown[],
  reorderFn: (ids: string[]) => Promise<TItem[]>,
) {
  return useMutation({
    mutationFn: reorderFn,
    onMutate: async (ids, context): Promise<Snapshot<TItem[]>> => {
      await context.client.cancelQueries({ queryKey });
      const previous = context.client.getQueryData<TItem[]>(queryKey);
      const order = new Map(ids.map((id, index) => [id, index]));
      context.client.setQueryData<TItem[]>(queryKey, (current) =>
        current
          ? [...current].sort((a, b) => order.get(a.id)! - order.get(b.id)!)
          : current,
      );
      return { previous };
    },
    onError: (error, _ids, snapshot, context) => {
      context.client.setQueryData(queryKey, snapshot?.previous);
      handleMutationError(error, context);
    },
    onSuccess: (items, _ids, _snapshot, context) => {
      context.client.setQueryData(queryKey, items);
    },
    onSettled: (_data, _error, _ids, _snapshot, context) => {
      void context.client.invalidateQueries({ queryKey });
    },
  });
}
