import { renderHook, act } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { AppProviders } from "@/app/AppProviders";
import { authQueryKey, useLogout } from "@/app/auth";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  authUserFixture,
  createTestQueryClient,
  emptyResponse,
} from "@/test/render-app";

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <AppProviders queryClient={queryClient}>{children}</AppProviders>;
  };
}

describe("private auth cache boundary", () => {
  it("removes Profile and workspace caches on logout", async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith("/v1/auth/logout") &&
        init?.method === "POST"
      ) {
        return emptyResponse();
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authQueryKey, {
      ...authUserFixture,
      id: "owner-a",
    });
    queryClient.setQueryData(workspaceKeys.profile.detail(), {
      academics: { gpa_unweighted: 3.9 },
    });
    queryClient.setQueryData(workspaceKeys.tasks.list(), [{ id: "task-a" }]);

    const { result } = renderHook(() => useLogout(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(queryClient.getQueryData(authQueryKey)).toBeNull();
    expect(
      queryClient.getQueryData(workspaceKeys.profile.detail()),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(workspaceKeys.tasks.list()),
    ).toBeUndefined();
  });
});
