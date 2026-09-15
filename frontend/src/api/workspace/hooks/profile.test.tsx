import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { schoolsExploreQueryKey } from "@/api/schools/explore";
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
  it("aborts every active Explore query before forcing its fresh local-Profile refetch", async () => {
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
    expect(cancel).toHaveBeenCalledWith({
      queryKey: schoolsExploreQueryKey,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: schoolsExploreQueryKey,
      refetchType: "active",
    });
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      invalidate.mock.invocationCallOrder[0]!,
    );
    expect(queryClient.getQueryState(firstExploreKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(secondExploreKey)?.isInvalidated).toBe(
      true,
    );
  });
});
