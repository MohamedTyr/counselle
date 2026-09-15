import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { authQueryKey } from "@/app/auth";
import { schoolsExploreQueryKey } from "@/api/schools/explore";
import { useWorkspaceEvents } from "@/api/workspace/events";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  authUserFixture,
  createTestQueryClient,
  installMockEventSource,
  jsonResponse,
  MockWorkspaceEventSource,
} from "@/test/render-app";
import type { ChangeEvent } from "@/api/workspace/types";

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function change(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: 1,
    v: 1,
    type: "task.updated",
    data: {
      object_type: "task",
      object_id: "task-id",
      op: "updated",
      actor: "student",
      application_id: "application-id",
    },
    ...overrides,
  };
}

describe("workspace events", () => {
  it("opens the workspace stream and invalidates object-specific keys", () => {
    installMockEventSource();
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useWorkspaceEvents(), { wrapper: wrapper(queryClient) });

    expect(MockWorkspaceEventSource.instances[0]?.url).toBe(
      "/v1/workspace/events",
    );

    act(() => {
      MockWorkspaceEventSource.instances[0]?.emit("task.updated", change());
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.tasks.list(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.applications.all(),
    });
  });

  it("invalidates all application caches for task and essay changes", () => {
    installMockEventSource();
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useWorkspaceEvents(), { wrapper: wrapper(queryClient) });

    act(() => {
      MockWorkspaceEventSource.instances[0]?.emit("task.updated", change());
      MockWorkspaceEventSource.instances[0]?.emit(
        "essay.updated",
        change({
          type: "essay.updated",
          data: {
            object_type: "essay",
            object_id: "essay-id",
            op: "updated",
            actor: "student",
            application_id: "application-id",
          },
        }),
      );
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.tasks.list(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.essays.list(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.essays.detail("essay-id"),
    });
    expect(invalidate).toHaveBeenCalledTimes(5);
    expect(
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters.queryKey) ===
          JSON.stringify(workspaceKeys.applications.all()),
      ),
    ).toHaveLength(2);
  });

  it("aborts Explore before forcing a fresh refetch for profile.updated", async () => {
    installMockEventSource();
    const queryClient = createTestQueryClient();
    const cancel = vi.spyOn(queryClient, "cancelQueries");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const firstExploreKey = [
      ...schoolsExploreQueryKey,
      "owner-a",
      { q: "first" },
      1,
    ] as const;
    const secondExploreKey = [
      ...schoolsExploreQueryKey,
      "owner-a",
      { q: "second" },
      2,
    ] as const;
    queryClient.setQueryData(firstExploreKey, { page: 1 });
    queryClient.setQueryData(secondExploreKey, { page: 2 });

    renderHook(() => useWorkspaceEvents(), { wrapper: wrapper(queryClient) });

    act(() => {
      MockWorkspaceEventSource.instances[0]?.emit(
        "profile.updated",
        change({
          type: "profile.updated",
          data: {
            object_type: "profile",
            object_id: "profile-id",
            op: "updated",
            actor: "student",
            application_id: null,
          },
        }),
      );
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.profile.detail(),
    });
    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith({
        queryKey: schoolsExploreQueryKey,
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: schoolsExploreQueryKey,
        refetchType: "active",
      });
    });
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      invalidate.mock.invocationCallOrder.find(
        (order) => order > cancel.mock.invocationCallOrder[0]!,
      )!,
    );
    expect(queryClient.getQueryState(firstExploreKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(secondExploreKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("forces a network auth check on stream error and closes after an expired session", async () => {
    installMockEventSource();
    const fetch = vi.fn(() =>
      jsonResponse({ detail: "Unauthorized" }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authQueryKey, authUserFixture);

    renderHook(() => useWorkspaceEvents(), { wrapper: wrapper(queryClient) });

    act(() => {
      MockWorkspaceEventSource.instances[0]?.emitError();
    });

    await waitFor(() => {
      expect(MockWorkspaceEventSource.instances[0]?.closed).toBe(true);
    });
    expect(fetch).toHaveBeenCalledWith(
      "/v1/me",
      expect.objectContaining({ method: "GET" }),
    );
    expect(queryClient.getQueryData(authQueryKey)).toBeNull();
  });

  it("rechecks auth on a later stream error after an authenticated transient error", async () => {
    installMockEventSource();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(authUserFixture))
      .mockImplementationOnce(() =>
        jsonResponse({ detail: "Unauthorized" }, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authQueryKey, authUserFixture);

    renderHook(() => useWorkspaceEvents(), { wrapper: wrapper(queryClient) });
    const source = MockWorkspaceEventSource.instances[0];

    act(() => {
      source?.emitError();
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(source?.closed).toBe(false);
    expect(queryClient.getQueryData(authQueryKey)).toEqual(authUserFixture);

    act(() => {
      source?.emitError();
    });

    await waitFor(() => {
      expect(source?.closed).toBe(true);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(authQueryKey)).toBeNull();
  });
});
