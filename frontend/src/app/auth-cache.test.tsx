import { renderHook, act, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { AppProviders } from "@/app/AppProviders";
import { authQueryKey, useAuthUser, useLogout } from "@/app/auth";
import {
  schoolsExploreQueryKey,
  type ExploreResponse,
  useExplore,
} from "@/api/schools/explore";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  authUserFixture,
  createTestQueryClient,
  emptyResponse,
  jsonResponse,
} from "@/test/render-app";

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function responseWithMarker(marker: string): ExploreResponse {
  return {
    band_caption: "",
    browsable_total: 0,
    catalog_total: 0,
    control_counts: { private: 0, private_for_profit: 0, public: 0 },
    entrance_difficulty_note: "",
    exclusions: [],
    facts_observed_from: marker,
    filter_options: {
      campus_setting: [],
      region: [],
      religious_affiliation: [],
    },
    fit_profile_summary: {
      has_academic_candidate: false,
      has_complete_test_candidate: false,
      suggested_profile_fields: ["gpa"],
    },
    majors_match_note: "",
    narrowest: null,
    page: 1,
    page_size: 24,
    religious_affiliation_note: "",
    schools: [],
    sorted_null_tail: null,
    total: 0,
    total_is_capped: false,
  };
}

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <AppProviders queryClient={queryClient}>{children}</AppProviders>;
  };
}

describe("private auth cache boundary", () => {
  it("aborts and removes Profile, Explore, and workspace caches on logout", async () => {
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
    const exploreKey = [
      ...schoolsExploreQueryKey,
      "owner-a",
      { q: "private" },
      1,
    ] as const;
    queryClient.setQueryData(exploreKey, responseWithMarker("owner-a"));
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
    expect(queryClient.getQueryData(exploreKey)).toBeUndefined();
    expect(
      queryClient.getQueryData(workspaceKeys.profile.detail()),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(workspaceKeys.tasks.list()),
    ).toBeUndefined();
  });

  it("does not let a late A logout clear B's fresh owner-scoped Explore response", async () => {
    const exploreA = deferred<Response>();
    const exploreB = deferred<Response>();
    const logoutA = deferred<Response>();
    const exploreRequestInits: RequestInit[] = [];
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/schools/explore")) {
        exploreRequestInits.push(init ?? {});
        return exploreRequestInits.length === 1
          ? exploreA.promise
          : exploreB.promise;
      }
      if (url.endsWith("/v1/auth/logout")) {
        return logoutA.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    const ownerA = "owner-a";
    const ownerB = "owner-b";
    queryClient.setQueryData(authQueryKey, {
      ...authUserFixture,
      id: ownerA,
    });

    const { result } = renderHook(
      () => ({
        explore: useExplore({ q: "switch" }, 1),
        logout: useLogout(),
        owner: useAuthUser()?.id ?? null,
      }),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(exploreRequestInits).toHaveLength(1));

    let logoutPromise!: Promise<void>;
    act(() => {
      logoutPromise = result.current.logout.mutateAsync();
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/v1/auth/logout",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    act(() => {
      queryClient.setQueryData(authQueryKey, {
        ...authUserFixture,
        id: ownerB,
      });
    });

    await waitFor(() => {
      expect(exploreRequestInits[0]?.signal?.aborted).toBe(true);
      expect(exploreRequestInits).toHaveLength(2);
    });

    await act(async () => {
      logoutA.resolve(emptyResponse());
      await logoutPromise;
    });

    expect(exploreRequestInits[1]?.signal?.aborted).toBe(false);
    expect(result.current.owner).toBe(ownerB);

    await act(async () => {
      exploreB.resolve(jsonResponse(responseWithMarker("owner-b")));
    });

    await waitFor(() => {
      expect(result.current.explore.data?.facts_observed_from).toBe("owner-b");
    });
    expect(
      queryClient.getQueryData([
        ...schoolsExploreQueryKey,
        ownerA,
        { q: "switch" },
        1,
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        ...schoolsExploreQueryKey,
        ownerB,
        { q: "switch" },
        1,
      ]),
    ).toEqual(responseWithMarker("owner-b"));
  });
});
