import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { authQueryKey } from "@/app/auth";
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
