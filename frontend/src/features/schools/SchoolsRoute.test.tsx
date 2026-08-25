import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ApplicationView } from "@/api/workspace/types";
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceApplicationFixture,
} from "@/test/render-app";

function application(
  overrides: Partial<ApplicationView> & Pick<ApplicationView, "id">,
): ApplicationView {
  const { id, ...rest } = overrides;

  return {
    ...workspaceApplicationFixture,
    id,
    school_unitid: Number(id.replace(/\D/g, "").slice(0, 6)) || 1,
    school_name: `School ${id}`,
    school_city: "Somewhere",
    school_state: "US",
    website_url: "https://example.edu",
    status: "Considering",
    list_type: "Target",
    round: "RD",
    deadline: "2027-01-05",
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    ...rest,
  };
}

const testApplications: ApplicationView[] = [
  application({
    id: "10000000-0000-4000-8000-000000000002",
    school_name: "Beta University",
    status: "Submitted",
    list_type: "Target",
    deadline: "2027-03-01",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000001",
    school_name: "Alpha College",
    status: "Applying",
    list_type: "Reach",
    deadline: "2027-01-05",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000003",
    school_name: "Gamma Institute",
    status: "Considering",
    list_type: "Safety",
    deadline: "2027-02-01",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000004",
    school_name: "Delta Academy",
    status: "Submitted",
    list_type: "Reach",
    deadline: "2027-04-01",
  }),
];

async function renderSchools(applications = testApplications) {
  renderApp("/app/schools", {
    fetchHandler: createWorkspaceFetchPreset({ applications }),
  });
  await screen.findByRole("table");
}

function tableSchoolNames() {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("button", { name: /Open .* details/ })
    .map((button) => button.getAttribute("aria-label"));
}

describe("SchoolsPage", () => {
  it("filters schools from the balance bar legend", async () => {
    const user = userEvent.setup();
    await renderSchools();

    await user.click(
      screen.getByRole("button", { name: "Show 2 Reach schools" }),
    );

    expect(screen.getByText("2 schools shown")).toBeInTheDocument();
  });

  it("filters schools from the view dropdown", async () => {
    const user = userEvent.setup();
    await renderSchools();

    await user.click(
      screen.getByRole("button", {
        name: "Choose application view filter",
      }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: /Submitted/ }));

    expect(screen.getByText("2 schools shown")).toBeInTheDocument();
  });

  it("sorts the desktop table by header controls", async () => {
    const user = userEvent.setup();
    await renderSchools();

    const table = screen.getByRole("table");
    const schoolHeader = within(table).getByRole("button", {
      name: "School",
    });

    await user.click(schoolHeader);

    expect(tableSchoolNames()).toEqual([
      "Open Alpha College details",
      "Open Beta University details",
      "Open Delta Academy details",
      "Open Gamma Institute details",
    ]);

    await user.click(schoolHeader);

    expect(tableSchoolNames()).toEqual([
      "Open Gamma Institute details",
      "Open Delta Academy details",
      "Open Beta University details",
      "Open Alpha College details",
    ]);
  });

  it("exposes sort controls outside the desktop table", async () => {
    const user = userEvent.setup();
    await renderSchools();

    await user.click(
      screen.getByRole("button", {
        name: "Choose school sort column",
      }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "School" }));
    await user.click(screen.getByRole("button", { name: "Sort ascending" }));

    expect(
      screen.getByRole("button", { name: "Sort descending" }),
    ).toBeInTheDocument();
  });

  it("renders the first-run empty state when there are no applications", async () => {
    renderApp("/app/schools", {
      fetchHandler: createWorkspaceFetchPreset({ applications: [] }),
    });

    expect(await screen.findByText("No schools yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add your first school" }),
    ).toBeInTheDocument();
  });

  it("renders the filter empty state when filters remove every school", async () => {
    const user = userEvent.setup();
    await renderSchools([
      application({
        id: "10000000-0000-4000-8000-000000000010",
        list_type: "Reach",
      }),
      application({
        id: "10000000-0000-4000-8000-000000000011",
        list_type: "Safety",
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: "Show 1 Reach school" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Choose application view filter" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: /Submitted/ }));

    expect(screen.getAllByText("No schools match these filters.")).not.toEqual(
      [],
    );
  });

  it("nudges a list with no safety schools toward Explore", async () => {
    await renderSchools([
      application({
        id: "10000000-0000-4000-8000-000000000020",
        list_type: "Reach",
      }),
    ]);

    expect(screen.getByText(/No safety schools/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Find some in Explore/ }),
    ).toBeInTheDocument();
  });

  it("redirects the legacy school query param to the canonical workspace page", async () => {
    const fetchSpy = createWorkspaceFetchPreset({
      applications: testApplications,
    });
    renderApp("/app/schools?school=10000000-0000-4000-8000-000000000001", {
      fetchHandler: fetchSpy,
    });

    expect(
      await screen.findByRole("heading", { name: "Alpha College" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(
      "/app/schools/10000000-0000-4000-8000-000000000001",
    );
    expect(window.location.search).toBe("");
  });

  it("opens a school row on its canonical workspace page", async () => {
    const user = userEvent.setup();
    await renderSchools();
    await user.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "Open Alpha College details",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Alpha College" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(
      "/app/schools/10000000-0000-4000-8000-000000000001",
    );
  });

  it("archives a school from its workspace and restores it with undo", async () => {
    const user = userEvent.setup();
    await renderSchools();

    await user.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "Open Alpha College details",
      }),
    );
    await screen.findByRole("heading", { name: "Alpha College" });
    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/schools"));
    expect(
      screen.queryByRole("button", { name: "Open Alpha College details" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(
      await screen.findAllByRole("button", {
        name: "Open Alpha College details",
      }),
    ).not.toEqual([]);
  });

  it("resizes columns by keyboard and cleans up pointer drag state", async () => {
    const { container, unmount } = renderApp("/app/schools", {
      fetchHandler: createWorkspaceFetchPreset({
        applications: testApplications,
      }),
    });
    await screen.findByRole("table");
    const resizeHandle = screen.getByRole("button", {
      name: "Resize School column",
    });
    const schoolColumn = container.querySelector('col[data-column="school"]');

    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" });

    expect(schoolColumn).toHaveStyle({ width: "308px" });

    fireEvent.pointerDown(resizeHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 40 });

    expect(document.body.style.cursor).toBe("col-resize");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});
