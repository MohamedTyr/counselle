import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import {
  useArchiveActivity,
  useArchiveEssay,
  useCreateActivity,
  useCreateEssay,
  useCreateTask,
  useReorderActivities,
  useRestoreActivity,
  useUpdateApplication,
  useUpdateActivity,
  useUpdateHonor,
  useUpdateEssay,
  useUpdateTask,
} from "@/api/workspace/hooks";
import { useUpdateInList } from "@/api/workspace/hooks/shared";
import { workspaceKeys } from "@/api/workspace/keys";
import type {
  ApplicationDetail,
  ApplicationView,
  Activity,
  Essay,
  EssaySummary,
  Honor,
  Task,
} from "@/api/workspace/types";
import {
  createTestQueryClient,
  emptyResponse,
  jsonResponse,
  workspaceActivityFixture,
  workspaceApplicationFixture,
  workspaceEssayFixture,
  workspaceHonorFixture,
  workspaceReferenceFixture,
  workspaceTaskFixture,
} from "@/test/render-app";

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("workspace mutation hooks", () => {
  it("optimistically inserts a created task and replaces it with the server row", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(workspaceKeys.tasks.list(), []);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useCreateTask(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ title: "Draft supplement" });
    });

    await waitFor(() => {
      const tasks = queryClient.getQueryData(workspaceKeys.tasks.list());
      expect(tasks).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^temp-/),
          title: "Draft supplement",
        }),
      ]);
    });

    deferred.resolve(
      jsonResponse({ ...workspaceTaskFixture, title: "Draft supplement" }),
    );

    await waitFor(() => {
      const tasks = queryClient.getQueryData(workspaceKeys.tasks.list());
      expect(tasks).toEqual([
        expect.objectContaining({
          id: workspaceTaskFixture.id,
          title: "Draft supplement",
        }),
      ]);
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.applications.detail(
          workspaceTaskFixture.application_id!,
        ),
      });
    });
  });

  it("optimistically sets completed_at when a single task update marks it done", async () => {
    const queryClient = createTestQueryClient();
    const openTask: Task = { ...workspaceTaskFixture, completed_at: null };
    queryClient.setQueryData(workspaceKeys.tasks.list(), [openTask]);
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: openTask.id, patch: { status: "done" } });
    });

    await waitFor(() => {
      const tasks = queryClient.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      );
      expect(tasks?.[0]?.status).toBe("done");
      expect(tasks?.[0]?.completed_at).not.toBeNull();
    });

    deferred.resolve(jsonResponse({ ...openTask, status: "done" }));
  });

  it("optimistically clears completed_at when a task is moved out of done", async () => {
    const queryClient = createTestQueryClient();
    const doneTask: Task = {
      ...workspaceTaskFixture,
      status: "done",
      completed_at: "2026-01-01T00:00:00.000Z",
    };
    queryClient.setQueryData(workspaceKeys.tasks.list(), [doneTask]);
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: doneTask.id, patch: { status: "todo" } });
    });

    await waitFor(() => {
      const tasks = queryClient.getQueryData<Task[]>(
        workspaceKeys.tasks.list(),
      );
      expect(tasks?.[0]?.status).toBe("todo");
      expect(tasks?.[0]?.completed_at).toBeNull();
    });

    deferred.resolve(
      jsonResponse({ ...doneTask, status: "todo", completed_at: null }),
    );
  });

  it("rolls back optimistic application list and detail patches on error", async () => {
    const queryClient = createTestQueryClient();
    const detail: ApplicationDetail = {
      application: workspaceApplicationFixture,
      tasks: [],
      essays: [],
      prompt_drafts: [],
      reference: workspaceReferenceFixture,
    };
    queryClient.setQueryData(workspaceKeys.applications.list(), [
      workspaceApplicationFixture,
    ]);
    queryClient.setQueryData(
      workspaceKeys.applications.detail(workspaceApplicationFixture.id),
      detail,
    );
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useUpdateApplication(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        id: workspaceApplicationFixture.id,
        patch: { status: "Applying" },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ApplicationDetail>(
          workspaceKeys.applications.detail(workspaceApplicationFixture.id),
        )?.application.status,
      ).toBe("Applying");
    });

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ApplicationDetail>(
          workspaceKeys.applications.detail(workspaceApplicationFixture.id),
        )?.application.status,
      ).toBe(workspaceApplicationFixture.status);
    });
    expect(
      queryClient.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )?.[0]?.status,
    ).toBe(workspaceApplicationFixture.status);
  });

  it("rolls back optimistic essay list and detail patches on error", async () => {
    const queryClient = createTestQueryClient();
    const essay: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    };
    queryClient.setQueryData(workspaceKeys.essays.list(), [
      workspaceEssayFixture,
    ]);
    queryClient.setQueryData(workspaceKeys.essays.detail(essay.id), essay);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useUpdateEssay(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        id: essay.id,
        patch: { title: "Changed title" },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id))
          ?.title,
      ).toBe("Changed title");
    });

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id))
          ?.title,
      ).toBe(workspaceEssayFixture.title);
    });
    expect(
      queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list())?.[0]
        ?.title,
    ).toBe(workspaceEssayFixture.title);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.applications.detail(
        workspaceEssayFixture.application_id!,
      ),
    });
  });

  it("invalidates application detail after creating an application essay", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(workspaceKeys.essays.list(), []);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(workspaceEssayFixture)),
    );

    const { result } = renderHook(() => useCreateEssay(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        application_id: workspaceApplicationFixture.id,
        title: "Supplemental essay",
      });
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.applications.detail(
          workspaceApplicationFixture.id,
        ),
      });
    });
  });

  it("removes archived essay detail cache before any SSE echo", async () => {
    const queryClient = createTestQueryClient();
    const essay: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    };
    queryClient.setQueryData(workspaceKeys.essays.list(), [
      workspaceEssayFixture,
    ]);
    queryClient.setQueryData(workspaceKeys.essays.detail(essay.id), essay);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useArchiveEssay(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate(essay.id);
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id)),
      ).toBeUndefined();
    });
    expect(
      queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()),
    ).toEqual([]);

    deferred.resolve(emptyResponse());

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.essays.detail(essay.id),
      });
    });
    expect(
      queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id)),
    ).toBeUndefined();
  });

  it("rolls back archived essay list and detail caches on error", async () => {
    const queryClient = createTestQueryClient();
    const previousList: EssaySummary[] = [workspaceEssayFixture];
    const previousDetail: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    };
    queryClient.setQueryData(workspaceKeys.essays.list(), previousList);
    queryClient.setQueryData(
      workspaceKeys.essays.detail(previousDetail.id),
      previousDetail,
    );
    const deferred = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => deferred.promise),
    );

    const { result } = renderHook(() => useArchiveEssay(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate(previousDetail.id);
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()),
      ).toEqual([]);
      expect(
        queryClient.getQueryData<Essay>(
          workspaceKeys.essays.detail(previousDetail.id),
        ),
      ).toBeUndefined();
    });

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));

    await waitFor(() => {
      expect(
        queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()),
      ).toEqual(previousList);
      expect(
        queryClient.getQueryData<Essay>(
          workspaceKeys.essays.detail(previousDetail.id),
        ),
      ).toEqual(previousDetail);
    });
  });

  it("ignores stale activity update responses that settle after newer edits", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<Activity[]>(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
    ]);
    const firstPatch = deferredResponse();
    let currentPosition = workspaceActivityFixture.position;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input, init) => {
        if (!init?.method || init.method === "GET") {
          return jsonResponse([
            { ...workspaceActivityFixture, position: currentPosition },
          ]);
        }
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.position === "First edit") {
          return firstPatch.promise;
        }
        currentPosition = body.position;
        return jsonResponse({ ...workspaceActivityFixture, ...body });
      }),
    );

    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        id: workspaceActivityFixture.id,
        patch: { position: "First edit" },
      });
      result.current.mutate({
        id: workspaceActivityFixture.id,
        patch: { position: "Second edit" },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(
          workspaceKeys.activities.list(),
        )?.[0]?.position,
      ).toBe("Second edit");
    });

    firstPatch.resolve(
      jsonResponse({ ...workspaceActivityFixture, position: "First edit" }),
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(
          workspaceKeys.activities.list(),
        )?.[0]?.position,
      ).toBe("Second edit");
    });
  });

  it("accepts an older update success when the newer optimistic update fails", async () => {
    type TestItem = {
      id: string;
      label: string;
      updated_at: string;
    };
    const queryClient = createTestQueryClient();
    const queryKey = ["workspace", "test-items"] as const;
    const baseItem: TestItem = {
      id: "item-1",
      label: "Original",
      updated_at: "2026-07-01T12:00:00Z",
    };
    queryClient.setQueryData<TestItem[]>(queryKey, [baseItem]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const first = deferred<TestItem>();
    const second = deferred<TestItem>();
    const updateItem = vi.fn((_id: string, patch: Partial<TestItem>) =>
      patch.label === "First edit" ? first.promise : second.promise,
    );

    const { result } = renderHook(
      () => useUpdateInList<TestItem, Partial<TestItem>>(queryKey, updateItem),
      { wrapper: wrapper(queryClient) },
    );

    act(() => {
      result.current.mutate({
        id: baseItem.id,
        patch: { label: "First edit" },
      });
      result.current.mutate({
        id: baseItem.id,
        patch: { label: "Second edit" },
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<TestItem[]>(queryKey)?.[0]?.label).toBe(
        "Second edit",
      );
    });

    act(() => {
      second.reject(new Error("failed"));
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<TestItem[]>(queryKey)?.[0]?.label).toBe(
        "First edit",
      );
    });

    act(() => {
      first.resolve({
        ...baseItem,
        label: "First edit accepted",
        updated_at: "2026-07-01T12:01:00Z",
      });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<TestItem[]>(queryKey)?.[0]?.label).toBe(
        "First edit accepted",
      );
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });

  it("serializes fast activity edits for the same row and keeps the latest value", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<Activity[]>(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
    ]);
    const firstPatch = deferredResponse();
    const activePatchBodies: unknown[] = [];
    let activePatchCount = 0;
    let maxConcurrentPatches = 0;
    let serverPosition = workspaceActivityFixture.position;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input, init) => {
        if (!init?.method || init.method === "GET") {
          return jsonResponse([
            { ...workspaceActivityFixture, position: serverPosition },
          ]);
        }

        const body = JSON.parse(String(init.body ?? "{}"));
        activePatchBodies.push(body);
        activePatchCount += 1;
        maxConcurrentPatches = Math.max(maxConcurrentPatches, activePatchCount);
        if (body.position === "First edit") {
          return firstPatch.promise.finally(() => {
            activePatchCount -= 1;
          });
        }

        serverPosition = body.position;
        activePatchCount -= 1;
        return jsonResponse({ ...workspaceActivityFixture, ...body });
      }),
    );

    const { result } = renderHook(() => useUpdateActivity(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        id: workspaceActivityFixture.id,
        patch: { position: "First edit" },
      });
      result.current.mutate({
        id: workspaceActivityFixture.id,
        patch: { position: "Second edit" },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(
          workspaceKeys.activities.list(),
        )?.[0]?.position,
      ).toBe("Second edit");
    });
    expect(activePatchBodies).toEqual([{ position: "First edit" }]);

    firstPatch.resolve(
      jsonResponse({ ...workspaceActivityFixture, position: "First edit" }),
    );

    await waitFor(() => {
      expect(activePatchBodies).toEqual([
        { position: "First edit" },
        { position: "Second edit" },
      ]);
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(
          workspaceKeys.activities.list(),
        )?.[0]?.position,
      ).toBe("Second edit");
    });
    expect(maxConcurrentPatches).toBe(1);
  });

  it("merges queued honor edits while one patch is in flight", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<Honor[]>(workspaceKeys.honors.list(), [
      workspaceHonorFixture,
    ]);
    const firstPatch = deferredResponse();
    const patchBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input, init) => {
        if (!init?.method || init.method === "GET") {
          return jsonResponse([workspaceHonorFixture]);
        }

        const body = JSON.parse(String(init.body ?? "{}"));
        patchBodies.push(body);
        if (patchBodies.length === 1) {
          return firstPatch.promise;
        }
        return jsonResponse({ ...workspaceHonorFixture, ...body });
      }),
    );

    const { result } = renderHook(() => useUpdateHonor(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({
        id: workspaceHonorFixture.id,
        patch: { title: "First title" },
      });
      result.current.mutate({
        id: workspaceHonorFixture.id,
        patch: { title: "Second title" },
      });
      result.current.mutate({
        id: workspaceHonorFixture.id,
        patch: { levels: ["state"] },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Honor[]>(workspaceKeys.honors.list())?.[0],
      ).toEqual(expect.objectContaining({ title: "Second title" }));
    });
    expect(patchBodies).toEqual([{ title: "First title" }]);

    firstPatch.resolve(
      jsonResponse({ ...workspaceHonorFixture, title: "First title" }),
    );

    await waitFor(() => {
      expect(patchBodies).toEqual([
        { title: "First title" },
        { title: "Second title", levels: ["state"] },
      ]);
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Honor[]>(workspaceKeys.honors.list())?.[0],
      ).toEqual(
        expect.objectContaining({
          levels: ["state"],
          title: "Second title",
        }),
      );
    });
  });

  it("rolls back failed activity create, update, archive, and reorder mutations", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<Activity[]>(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ detail: "failed" }, { status: 500 })),
    );

    const create = renderHook(() => useCreateActivity(), {
      wrapper: wrapper(queryClient),
    });
    act(() => {
      create.result.current.mutate({ position: "New activity" });
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(workspaceKeys.activities.list()),
      ).toEqual([workspaceActivityFixture]);
    });
    create.unmount();

    const update = renderHook(() => useUpdateActivity(), {
      wrapper: wrapper(queryClient),
    });
    act(() => {
      update.result.current.mutate({
        id: workspaceActivityFixture.id,
        patch: { position: "Changed" },
      });
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(
          workspaceKeys.activities.list(),
        )?.[0]?.position,
      ).toBe(workspaceActivityFixture.position);
    });
    update.unmount();

    const archive = renderHook(() => useArchiveActivity(), {
      wrapper: wrapper(queryClient),
    });
    act(() => {
      archive.result.current.mutate(workspaceActivityFixture.id);
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<Activity[]>(workspaceKeys.activities.list()),
      ).toEqual([workspaceActivityFixture]);
    });
    archive.unmount();

    const secondActivity: Activity = {
      ...workspaceActivityFixture,
      id: "40000000-0000-4000-8000-000000000002",
      position: "Second",
      sort_order: 2,
    };
    queryClient.setQueryData<Activity[]>(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
      secondActivity,
    ]);
    const reorder = renderHook(() => useReorderActivities(), {
      wrapper: wrapper(queryClient),
    });
    act(() => {
      reorder.result.current.mutate([
        secondActivity.id,
        workspaceActivityFixture.id,
      ]);
    });
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<Activity[]>(workspaceKeys.activities.list())
          ?.map((activity) => activity.id),
      ).toEqual([workspaceActivityFixture.id, secondActivity.id]);
    });
    reorder.unmount();
  });

  it("inserts restored activities by sort order", async () => {
    const queryClient = createTestQueryClient();
    const firstActivity: Activity = {
      ...workspaceActivityFixture,
      id: "40000000-0000-4000-8000-000000000001",
      position: "First",
      sort_order: 1,
    };
    const middleActivity: Activity = {
      ...workspaceActivityFixture,
      id: "40000000-0000-4000-8000-000000000002",
      position: "Middle",
      sort_order: 2,
    };
    const lastActivity: Activity = {
      ...workspaceActivityFixture,
      id: "40000000-0000-4000-8000-000000000003",
      position: "Last",
      sort_order: 3,
    };
    queryClient.setQueryData<Activity[]>(workspaceKeys.activities.list(), [
      firstActivity,
      lastActivity,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(middleActivity)),
    );

    const { result } = renderHook(() => useRestoreActivity(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate(middleActivity.id);
    });

    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<Activity[]>(workspaceKeys.activities.list())
          ?.map((activity) => activity.id),
      ).toEqual([firstActivity.id, middleActivity.id, lastActivity.id]);
    });
  });
});
