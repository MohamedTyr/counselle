import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createWorkspaceFetchPreset,
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
} from "@/test/render-app";

describe("SchoolWorkspace honesty states", () => {
  it("renders a query failure as an error instead of an empty catalog", async () => {
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      {
        fetchHandler: (input, init) => {
          if (
            String(input).includes(
              `/v1/applications/${workspaceApplicationFixture.id}`,
            )
          ) {
            return jsonResponse(
              { detail: "catalog unavailable" },
              { status: 500 },
            );
          }
          return defaultAuthenticatedFetch(input, init);
        },
      },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Could not load this application",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This is not shown as an empty catalog/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No catalog data for/)).not.toBeInTheDocument();
  });

  it("shows the facts note when the deadline is inherited", async () => {
    const fetchHandler = createWorkspaceFetchPreset({
      applications: [
        {
          ...workspaceApplicationFixture,
          deadline: "2026-11-01",
          deadline_source: "facts",
          deadline_checked_at: "2026-09-12",
        },
      ],
    });
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      { fetchHandler },
    );

    expect(
      await screen.findByText("From Counselle’s data, checked Sep 2026"),
    ).toBeInTheDocument();
  });

  it("offers to return to Counselle's date when a differing one is inherited", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    const baseFetchHandler = createWorkspaceFetchPreset({
      applications: [
        {
          ...workspaceApplicationFixture,
          deadline: "2026-10-15",
          deadline_source: "student",
          deadline_inherited_date: "2026-11-01",
          deadline_inherited_checked_at: "2026-09-12",
        },
      ],
    });
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body ?? "{}")));
      }
      return baseFetchHandler(input, init);
    };
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      { fetchHandler },
    );

    await user.click(
      await screen.findByRole("button", { name: "Use Counselle’s date" }),
    );

    await waitFor(() =>
      expect(patches).toContainEqual({ deadline: null }),
    );
  });

  it("does not offer to inherit when no date is available to inherit", async () => {
    const fetchHandler = createWorkspaceFetchPreset({
      applications: [
        {
          ...workspaceApplicationFixture,
          deadline: "2026-10-15",
          deadline_source: "student",
          deadline_inherited_date: null,
          deadline_inherited_checked_at: null,
        },
      ],
    });
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      { fetchHandler },
    );

    await screen.findByText("Application deadline");
    expect(
      screen.queryByRole("button", { name: "Use Counselle’s date" }),
    ).not.toBeInTheDocument();
  });

  it("does not patch a facts-sourced deadline when the field is only focused, not edited", async () => {
    const patches: unknown[] = [];
    const baseFetchHandler = createWorkspaceFetchPreset({
      applications: [
        {
          ...workspaceApplicationFixture,
          deadline: "2026-11-01",
          deadline_source: "facts",
          deadline_checked_at: "2026-09-12",
          aid_deadline: "2026-11-15",
          aid_deadline_source: "facts",
          aid_deadline_checked_at: "2026-09-12",
        },
      ],
    });
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body ?? "{}")));
      }
      return baseFetchHandler(input, init);
    };
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      { fetchHandler },
    );

    await screen.findAllByText("From Counselle’s data, checked Sep 2026");
    const dateInputs = document.querySelectorAll('input[type="date"]');
    for (const input of dateInputs) {
      (input as HTMLInputElement).focus();
      (input as HTMLInputElement).blur();
    }

    // Give any accidental auto-save time to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(patches).toHaveLength(0);
  });

  it("returns the aid deadline to Counselle's date on click", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    const baseFetchHandler = createWorkspaceFetchPreset({
      applications: [
        {
          ...workspaceApplicationFixture,
          aid_deadline: "2026-10-01",
          aid_deadline_source: "student",
          aid_deadline_inherited_date: "2026-11-15",
          aid_deadline_inherited_checked_at: "2026-09-12",
        },
      ],
    });
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body ?? "{}")));
      }
      return baseFetchHandler(input, init);
    };
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      { fetchHandler },
    );

    const useInheritedButtons = await screen.findAllByRole("button", {
      name: "Use Counselle’s date",
    });
    await user.click(useInheritedButtons[0]);

    await waitFor(() =>
      expect(patches).toContainEqual({ aid_deadline: null }),
    );
  });

  it("archives from the workspace and offers an undo restore", async () => {
    const user = userEvent.setup();
    const fetchHandler = createWorkspaceFetchPreset();
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      {
        fetchHandler,
      },
    );

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(window.location.pathname).toBe("/app/schools"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      (
        await screen.findAllByRole("button", {
          name: "Open Harvard University details",
        })
      )[0],
    ).toBeInTheDocument();
  });
});
