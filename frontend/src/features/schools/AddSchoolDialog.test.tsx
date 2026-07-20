import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type {
  ApplicationCreate,
  ApplicationView,
  SchoolSearchResult,
} from "@/api/workspace/types";
import {
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
  workspaceReferenceFixture,
} from "@/test/render-app";

const princetonSearchResult: SchoolSearchResult = {
  unitid: 186131,
  name: "Princeton University",
  city: "Princeton",
  state: "NJ",
  website_url: "https://www.princeton.edu",
  on_list: false,
  active_cycle_years: [],
  has_legacy_application: false,
};

function applicationFromInput(
  input: ApplicationCreate,
  school: SchoolSearchResult,
): ApplicationView {
  return {
    ...workspaceApplicationFixture,
    id: "10000000-0000-4000-8000-000000000777",
    school_unitid: input.unitid,
    school_name: school.name,
    school_city: school.city,
    school_state: school.state,
    website_url: school.website_url,
    list_type: input.list_type,
    round: input.round,
    cycle_year: input.cycle_year,
    deadline: input.deadline ?? null,
  };
}

function statefulAddSchoolFetch({
  searchResult = princetonSearchResult,
  initialApplications = [],
  currentCycleYear = 2027,
}: {
  searchResult?: SchoolSearchResult;
  initialApplications?: ApplicationView[];
  currentCycleYear?: number;
} = {}) {
  const posts: ApplicationCreate[] = [];
  let applications: ApplicationView[] = [...initialApplications];

  const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/v1/config")) {
      return jsonResponse({ current_admissions_cycle_year: currentCycleYear });
    }

    if (url.includes("/v1/schools/search")) {
      const matchingApplications = applications.filter(
        (application) => application.school_unitid === searchResult.unitid,
      );
      return jsonResponse([
        {
          ...searchResult,
          on_list: searchResult.on_list || matchingApplications.length > 0,
          active_cycle_years: Array.from(
            new Set([
              ...searchResult.active_cycle_years,
              ...matchingApplications.flatMap((application) =>
                application.cycle_year === null ? [] : [application.cycle_year],
              ),
            ]),
          ).sort((a, b) => a - b),
          has_legacy_application:
            searchResult.has_legacy_application ||
            matchingApplications.some(
              (application) => application.cycle_year === null,
            ),
        },
      ]);
    }

    if (url.endsWith("/v1/applications")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as ApplicationCreate;
        posts.push(body);
        const application = applicationFromInput(body, searchResult);
        applications = [application, ...applications];
        return jsonResponse({ application });
      }

      return jsonResponse(applications);
    }

    if (url.includes("/v1/applications/")) {
      return jsonResponse({
        application: applications[0],
        tasks: [],
        essays: [],
        reference: workspaceReferenceFixture,
      });
    }

    return defaultAuthenticatedFetch(input, init);
  };

  return { fetchHandler, posts };
}

async function openAddSchoolDialog() {
  const user = userEvent.setup();
  renderApp("/app/schools", {
    fetchHandler: statefulAddSchoolFetch().fetchHandler,
  });
  await user.click(await screen.findByRole("button", { name: "Add school" }));
  return user;
}

describe("AddSchoolDialog", () => {
  it("searches, selects, confirms, and posts an application", async () => {
    const user = userEvent.setup();
    const addFetch = statefulAddSchoolFetch();
    renderApp("/app/schools", { fetchHandler: addFetch.fetchHandler });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );
    await user.click(await screen.findByText("Princeton University"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Princeton, NJ")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Fall enrollment year")).toHaveValue(
      2027,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add school" }),
    );

    await waitFor(() =>
      expect(addFetch.posts).toEqual([
        {
          deadline: null,
          cycle_year: 2027,
          list_type: "Target",
          round: "RD",
          unitid: 186131,
        },
      ]),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/app/schools/10000000-0000-4000-8000-000000000777",
      ),
    );
  });

  it("opens from the keyboard shortcut", async () => {
    const user = await openAddSchoolDialog();

    await user.keyboard("{Escape}");
    await user.keyboard("{Control>}k{/Control}");

    expect(
      screen.getByPlaceholderText("Search for a school..."),
    ).toBeInTheDocument();
  });

  it("keeps an aggregate on-list search result selectable for another cycle", async () => {
    const user = userEvent.setup();
    const onListSchool: SchoolSearchResult = {
      ...princetonSearchResult,
      on_list: true,
      active_cycle_years: [2026],
    };
    renderApp("/app/schools", {
      fetchHandler: statefulAddSchoolFetch({ searchResult: onListSchool })
        .fetchHandler,
    });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );

    expect(
      await screen.findByText("Tracked for 2025-26 · choose a cycle"),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByText("Princeton University"),
    );
    expect(
      within(screen.getByRole("dialog")).getByText("List type"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Fall enrollment year")).toHaveValue(2027);
  });

  it("blocks only an exact school-cycle duplicate", async () => {
    const user = userEvent.setup();
    const existing = {
      ...workspaceApplicationFixture,
      school_unitid: princetonSearchResult.unitid,
      cycle_year: 2027,
    };
    renderApp("/app/schools", {
      fetchHandler: statefulAddSchoolFetch({
        currentCycleYear: 2028,
        initialApplications: [existing],
        searchResult: { ...princetonSearchResult, on_list: true },
      }).fetchHandler,
    });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );
    await user.click(await screen.findByText("Princeton University"));

    const addButton = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Add school",
    });
    expect(screen.getByLabelText("Fall enrollment year")).toHaveValue(2028);
    expect(addButton).toBeEnabled();

    await user.clear(screen.getByLabelText("Fall enrollment year"));
    await user.type(screen.getByLabelText("Fall enrollment year"), "2027");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "already in your workspace for the 2026-27 cycle",
    );
    expect(addButton).toBeDisabled();
  });

  it("shows a config-driven cycle preselection that remains editable", async () => {
    const user = userEvent.setup();
    const addFetch = statefulAddSchoolFetch({ currentCycleYear: 2029 });
    renderApp("/app/schools", { fetchHandler: addFetch.fetchHandler });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );
    await user.click(await screen.findByText("Princeton University"));
    const cycleInput = screen.getByLabelText("Fall enrollment year");
    expect(cycleInput).toHaveValue(2029);

    await user.clear(cycleInput);
    await user.type(cycleInput, "2030");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    );
    await waitFor(() => expect(addFetch.posts[0]?.cycle_year).toBe(2030));
  });

  it("shows a search error instead of the empty state", async () => {
    const user = userEvent.setup();
    renderApp("/app/schools", {
      fetchHandler: (input, init) => {
        const url = String(input);

        if (url.includes("/v1/schools/search")) {
          return jsonResponse(
            { error: { message: "Search failed" } },
            { status: 500 },
          );
        }

        return defaultAuthenticatedFetch(input, init);
      },
    });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not search schools.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No schools found.")).not.toBeInTheDocument();
  });

  it("marks a cached result as tracked but still allows a new cycle", async () => {
    const user = userEvent.setup();
    let searchCount = 0;
    let resolveSecondSearch = () => undefined;
    const addFetch = statefulAddSchoolFetch();
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/v1/schools/search")) {
        searchCount += 1;
        if (searchCount > 1) {
          return new Promise<Response>((resolve) => {
            resolveSecondSearch = () => {
              void Promise.resolve(addFetch.fetchHandler(input, init)).then(
                resolve,
              );
            };
          });
        }
      }

      return addFetch.fetchHandler(input, init);
    };
    renderApp("/app/schools", { fetchHandler });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );
    await user.click(await screen.findByText("Princeton University"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    );
    await waitFor(() => expect(addFetch.posts).toHaveLength(1));
    const schoolLinks = await screen.findAllByRole("link", { name: "Schools" });
    await user.click(schoolLinks[0]);
    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );

    expect(
      await screen.findByText("Tracked for 2026-27 · choose a cycle"),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByText("Princeton University"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("2026-27 cycle");
    await user.clear(screen.getByLabelText("Fall enrollment year"));
    await user.type(screen.getByLabelText("Fall enrollment year"), "2028");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    ).toBeEnabled();
    resolveSecondSearch();
  });

  it("rolls back the optimistic row when the add request fails", async () => {
    const user = userEvent.setup();
    let rejectPost: (response: Response) => void = () => undefined;
    const postPromise = new Promise<Response>((resolve) => {
      rejectPost = resolve;
    });
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/v1/schools/search")) {
          return jsonResponse([princetonSearchResult]);
        }

        if (url.endsWith("/v1/applications")) {
          if (init?.method === "POST") {
            return postPromise;
          }

          return jsonResponse([]);
        }

        return defaultAuthenticatedFetch(input, init);
      },
    );
    renderApp("/app/schools", { fetchHandler });

    await user.click(await screen.findByRole("button", { name: "Add school" }));
    await user.type(
      screen.getByPlaceholderText("Search for a school..."),
      "princeton",
    );
    await user.click(await screen.findByText("Princeton University"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    );

    expect(await screen.findByText("1 school shown")).toBeInTheDocument();

    rejectPost(jsonResponse({ error: { message: "Failed" } }, { status: 500 }));

    expect(await screen.findByText("No schools yet")).toBeInTheDocument();
  });
});
