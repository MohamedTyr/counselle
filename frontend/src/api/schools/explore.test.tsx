import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { authQueryKey } from "@/app/auth";
import {
  getExplore,
  schoolsExploreQueryKey,
  type ExploreFields,
  type ExploreResponse,
  useExplore,
} from "@/api/schools/explore";
import {
  authUserFixture,
  createTestQueryClient,
  jsonResponse,
} from "@/test/render-app";

const response: ExploreResponse = {
  control_counts: { private: 1, private_for_profit: 0, public: 0 },
  entrance_difficulty_note: "",
  exclusions: [],
  facts_observed_from: null,
  filter_options: { campus_setting: [], region: [], religious_affiliation: [] },
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
  it("sends a credentialed, paged request and returns the typed response", async () => {
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);

    await expect(getExplore({}, 1)).resolves.toEqual(response);
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
          fit: { admit_rate: 42, category: "Target" },
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
    expect(parsed.schools[0]?.fit).toEqual({
      admit_rate: 42,
      category: "Target",
    });
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

  it("caches one catalog answer per query, not per reader", async () => {
    const fetch = vi.fn(() => jsonResponse(response));
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    setAuthenticatedOwner(queryClient, "owner-a");

    const { result } = renderHook(() => useExplore({ q: "fit" }, 1), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(
      queryClient.getQueryData([...schoolsExploreQueryKey, { q: "fit" }, 1]),
    ).toEqual(response);
  });
});
