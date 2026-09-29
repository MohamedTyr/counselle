import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useUpdateProfile } from "@/api/workspace/hooks/profile";
import { workspaceKeys } from "@/api/workspace/keys";
import type { Profile } from "@/api/workspace/types";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useUpdateProfile", () => {
  it("writes the server's normalized profile straight into the cache", async () => {
    const queryClient = createTestQueryClient();
    const profile: Profile = { academics: { gpa_unweighted: 3.8 } };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(profile)),
    );

    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ academics: { gpa_unweighted: 3.8 } });
    });

    expect(queryClient.getQueryData(workspaceKeys.profile.detail())).toEqual(
      profile,
    );
  });
});
