import { act, renderHook, waitFor } from "@testing-library/react";
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { authQueryKey } from "@/app/auth";
import {
  getExplore,
  schoolsExploreQueryKey,
  type ExploreFields,
  type ExploreResponse,
  useExplore,
} from "@/api/schools/explore";
import { useWorkspaceEvents } from "@/api/workspace/events";
import {
  authUserFixture,
  createTestQueryClient,
  installMockEventSource,
  jsonResponse,
  MockWorkspaceEventSource,
} from "@/test/render-app";

const response: ExploreResponse = {
  band_caption: "School score ranges are contextual.",
  browsable_total: 1,
  catalog_total: 1,
  control_counts: { private: 1, private_for_profit: 0, public: 0 },
  entrance_difficulty_note: "",
  exclusions: [],
  facts_observed_from: null,
  filter_options: { campus_setting: [], region: [], religious_affiliation: [] },
  fit_profile_summary: {
    has_academic_candidate: true,
    has_complete_test_candidate: false,
    suggested_profile_fields: ["test_scores"],
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

const cardFieldsFixture: ExploreFields = {
  accepts_common_app: null,
  act_composite_avg: null,
  act_composite_p25: null,
  act_composite_p75: null,
  admit_rate: 42,
  admit_rate_men: null,
  admit_rate_women: null,
  admitted_total: null,
  applicants_total: null,
  application_fee: null,
  application_fee_waiver: null,
  avg_indebtedness: null,
  books_and_supplies: null,
  calendar: null,
  control: "private",
  cost_attendance_in_state: null,
  cost_attendance_out_of_state: null,
  deadline_regular: null,
  enrolled_total: null,
  entrance_difficulty: null,
  faculty_full_time: null,
  faculty_part_time: null,
  faculty_terminal_pct: null,
  gender_model: null,
  gpa_avg: null,
  grad_rate_4y: null,
  grad_rate_5y: null,
  grad_rate_6y: null,
  graduate_students: null,
  graduates_with_loans_pct: null,
  greek_pct_men: null,
  greek_pct_women: null,
  hbcu: false,
  housing_pct: null,
  hsi: null,
  institution_level: null,
  international_pct: null,
  is_rolling: null,
  land_grant: false,
  locale: null,
  majors: null,
  majors_count: null,
  need_met_pct: null,
  offers_early_action: null,
  offers_early_decision: null,
  other_expenses: null,
  region: "New England (CT, ME, MA, NH, RI, VT)",
  religious_affiliation: null,
  retention_pct: null,
  room_and_board: null,
  sat_ebrw_p25: null,
  sat_ebrw_p75: null,
  sat_math_p25: null,
  sat_math_p75: null,
  special_programs: null,
  tribal: false,
  tuition_in_state: null,
  tuition_out_of_state: null,
  undergraduate_full_time: null,
  undergraduates: null,
  waitlist_used: null,
  yield_rate: null,
};

function responseWithMarker(marker: string): ExploreResponse {
  return { ...response, facts_observed_from: marker };
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function setAuthenticatedOwner(
  queryClient: ReturnType<typeof createTestQueryClient>,
  ownerId = authUserFixture.id,
) {
  queryClient.setQueryData(authQueryKey, { ...authUserFixture, id: ownerId });
}

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("Explore fit wire contract", () => {
  it("retains the typed server-owned Profile summary without a client fallback", async () => {
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);

    await expect(getExplore({}, 1)).resolves.toEqual(response);
    expect(response.fit_profile_summary).toEqual({
      has_academic_candidate: true,
      has_complete_test_candidate: false,
      suggested_profile_fields: ["test_scores"],
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/schools/explore?page=1&page_size=24"),
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("requires fit on a nonempty Explore card fixture at the API boundary", async () => {
    const responseWithCard: ExploreResponse = {
      ...response,
      schools: [
        {
          city: null,
          fields: cardFieldsFixture,
          fit: {
            algorithm_version: "admissions-fit-v1",
            baseline_admit_rate: 42,
            baseline_category: "Target",
            basis: "school_rate",
            category: "Target",
            caveats: [],
            evidence_level: "baseline_only",
            signals: [],
            unavailable: [],
          },
          name: "Fit Contract University",
          state: "MA",
          unitid: 42,
          website_url: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(responseWithCard)),
    );

    const parsed = await getExplore({}, 1);

    expect(parsed.schools).toHaveLength(1);
    expect(parsed.schools[0]?.fit.category).toBe("Target");
  });

  it("passes a caller abort signal through the Explore transport", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);

    await getExplore({}, 1, controller.signal);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/schools/explore?page=1&page_size=24"),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("uses a stale Explore query on remount, focus, and reconnect", async () => {
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    setAuthenticatedOwner(queryClient);
    const first = renderHook(() => useExplore({}, 1), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    first.unmount();

    renderHook(() => useExplore({}, 1), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it("owner-scopes personalized Explore cache entries", async () => {
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    setAuthenticatedOwner(queryClient, "owner-a");

    const { result } = renderHook(() => useExplore({ q: "fit" }, 1), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(response));

    expect(
      queryClient.getQueryData([
        ...schoolsExploreQueryKey,
        "owner-a",
        { q: "fit" },
        1,
      ]),
    ).toEqual(response);
    expect(
      queryClient.getQueryData([...schoolsExploreQueryKey, { q: "fit" }, 1]),
    ).toBeUndefined();
  });

  it("never uses owner A's response as owner B's loading placeholder", async () => {
    const ownerB = "owner-b";
    const next = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(responseWithMarker("owner-a")))
      .mockImplementationOnce(() => next.promise);
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    setAuthenticatedOwner(queryClient, "owner-a");

    const { result } = renderHook(() => useExplore({ q: "same" }, 1), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => {
      expect(result.current.data?.facts_observed_from).toBe("owner-a");
    });

    act(() => {
      setAuthenticatedOwner(queryClient, ownerB);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(true);

    await act(async () => {
      next.resolve(jsonResponse(responseWithMarker("owner-b")));
    });
    await waitFor(() => {
      expect(result.current.data?.facts_observed_from).toBe("owner-b");
    });
  });

  it("cancels the first load on profile.updated and ignores its late response", async () => {
    installMockEventSource();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const requestInits: RequestInit[] = [];
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestInits.push(init ?? {});
      return requestInits.length === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    setAuthenticatedOwner(queryClient);

    const { result } = renderHook(
      () => {
        const explore = useExplore({}, 1);
        useWorkspaceEvents();
        return explore;
      },
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    act(() => {
      MockWorkspaceEventSource.instances[0]?.emit("profile.updated", {
        data: {
          actor: "student",
          application_id: null,
          object_id: "profile-id",
          object_type: "profile",
          op: "updated",
        },
        id: 1,
        type: "profile.updated",
        v: 1,
      });
    });

    await waitFor(() => {
      expect(requestInits[0]?.signal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      first.resolve(jsonResponse(responseWithMarker("stale")));
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(true);

    await act(async () => {
      second.resolve(jsonResponse(responseWithMarker("fresh")));
    });

    await waitFor(() => {
      expect(result.current.data?.facts_observed_from).toBe("fresh");
    });
  });
});
