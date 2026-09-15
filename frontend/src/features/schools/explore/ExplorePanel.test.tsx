import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import { authQueryKey } from "@/app/auth";
import { schoolsExploreQueryKey } from "@/api/schools/explore";
import type {
  ExploreFields,
  ExploreResponse,
  ExploreSchoolCard,
  FitCategory,
} from "@/api/schools/explore";
import type { ApplicationView } from "@/api/workspace/types";
import { workspaceKeys } from "@/api/workspace/keys";
import { ExplorePanel } from "@/features/schools/explore/ExplorePanel";
import {
  authUserFixture,
  createTestQueryClient,
  jsonResponse,
  workspaceApplicationFixture,
} from "@/test/render-app";

/*
 * This deliberately mounts the real ExplorePanel and its query/mutation hooks.
 * A card category is server-owned presentation data, while `list_type` remains
 * the student's explicit My List choice. A shallow SchoolResultCard test could
 * not catch an accidental future bridge between those two paths.
 */

const fields = {
  act_composite_p25: null,
  act_composite_p75: null,
  control: "private",
  cost_attendance_in_state: null,
  cost_attendance_out_of_state: null,
  deadline_regular: null,
  grad_rate_4y: null,
  is_rolling: false,
  need_met_pct: null,
  offers_early_action: false,
  offers_early_decision: false,
  sat_ebrw_p25: null,
  sat_ebrw_p75: null,
  sat_math_p25: null,
  sat_math_p75: null,
  undergraduates: null,
} as ExploreFields;

function school(category: FitCategory): ExploreSchoolCard {
  return {
    city: "Testville",
    fields,
    fit: {
      algorithm_version: "admissions-fit-v1",
      baseline_admit_rate: category === "Reach" ? 15 : 65,
      baseline_category: category,
      basis: "school_rate",
      category,
      caveats: [],
      evidence_level: "baseline_only",
      signals: [],
      unavailable: [],
    },
    name: "Fit Separation College",
    state: "MA",
    unitid: 451,
    website_url: null,
  };
}

function exploreResponse(category: FitCategory): ExploreResponse {
  return {
    band_caption: "",
    browsable_total: 1,
    catalog_total: 1,
    control_counts: { private: 1, private_for_profit: 0, public: 0 },
    entrance_difficulty_note: "",
    exclusions: [],
    facts_observed_from: null,
    filter_options: {
      campus_setting: [],
      region: [],
      religious_affiliation: [],
    },
    fit_profile_summary: {
      has_academic_candidate: true,
      has_complete_test_candidate: true,
      suggested_profile_fields: [],
    },
    majors_match_note: "",
    narrowest: null,
    page: 1,
    page_size: 24,
    religious_affiliation_note: "",
    schools: [school(category)],
    sorted_null_tail: null,
    total: 1,
    total_is_capped: false,
  };
}

function application(): ApplicationView {
  return {
    ...workspaceApplicationFixture,
    id: "10000000-0000-4000-8000-000000000451",
    list_type: "Target",
    school_city: "Testville",
    school_name: "Fit Separation College",
    school_state: "MA",
    school_unitid: 451,
  };
}

function renderPanel({
  applications = [],
  category,
}: {
  applications?: ApplicationView[];
  category: FitCategory;
}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(authQueryKey, authUserFixture);
  let currentApplications = applications;
  let currentCategory = category;
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/schools/explore")) {
      return jsonResponse(exploreResponse(currentCategory));
    }
    if (url.endsWith("/v1/applications")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          list_type: ApplicationView["list_type"];
        };
        const created = { ...application(), list_type: body.list_type };
        currentApplications = [created, ...currentApplications];
        return jsonResponse({ application: created });
      }
      return jsonResponse(currentApplications);
    }
    if (url.includes("/v1/applications/") && init?.method === "PATCH") {
      throw new Error("Explore must not patch an existing application for fit");
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetch);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/app/schools?tab=explore"]}>
        <ExplorePanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return {
    fetch,
    queryClient,
    setCategory(next: FitCategory) {
      currentCategory = next;
    },
  };
}

describe("ExplorePanel fit/list separation", () => {
  it.each(["Reach", "Safety"] as const)(
    "adds a %s fit school with the existing manual Target list type",
    async (category) => {
      const user = userEvent.setup();
      const { fetch } = renderPanel({ category });

      await screen.findByText(category);
      await user.click(
        screen.getByRole("button", {
          name: "Add Fit Separation College to your list",
        }),
      );

      await waitFor(() =>
        expect(
          fetch.mock.calls.find(
            ([input, init]) =>
              String(input).endsWith("/v1/applications") &&
              init?.method === "POST",
          ),
        ).toBeDefined(),
      );
      const [, init] = fetch.mock.calls.find(
        ([input, requestInit]) =>
          String(input).endsWith("/v1/applications") &&
          requestInit?.method === "POST",
      )!;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        list_type: "Target",
      });
    },
  );

  it("keeps an existing Target application on-list without a patch when its fit refetches", async () => {
    const { fetch, queryClient, setCategory } = renderPanel({
      applications: [application()],
      category: "Reach",
    });

    await screen.findByText("Reach");
    expect(screen.getByText("On list")).toBeInTheDocument();

    setCategory("Safety");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: schoolsExploreQueryKey });
    });

    expect(await screen.findByText("Safety")).toBeInTheDocument();
    expect(screen.getByText("On list")).toBeInTheDocument();
    expect(
      queryClient.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )?.[0]?.list_type,
    ).toBe("Target");
    expect(
      fetch.mock.calls.filter(
        ([input, init]) =>
          String(input).includes("/v1/applications/") &&
          init?.method === "PATCH",
      ),
    ).toHaveLength(0);
  });
});
