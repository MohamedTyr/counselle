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
