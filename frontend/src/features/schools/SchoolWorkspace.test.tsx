import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ApplicationDetail, SchoolRequirement } from "@/api/workspace/types";

import {
  createWorkspaceFetchPreset,
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
  workspaceReferenceFixture,
} from "@/test/render-app";

const provenance = {
  published_at: "2026-07-12T12:00:00Z",
  source: "Admissions office",
  source_url: "https://example.edu/admissions",
  verified_at: "2026-07-12",
};

function requirement(
  overrides: Partial<SchoolRequirement> = {},
): SchoolRequirement {
  return {
    applicability: "required",
    audience: {},
    cycle_year: 2027,
    detail: {},
    id: "70000000-0000-4000-8000-000000000001",
    kind: "fee",
    label: "Application fee",
    provenance,
    school_unitid: workspaceApplicationFixture.school_unitid,
    ...overrides,
  };
}

function renderWorkspace(detail: ApplicationDetail) {
  return renderApp(
    `/app/schools/${detail.application.school_unitid}?tab=application`,
    {
      fetchHandler: (input, init) => {
        if (
          String(input).includes(`/v1/applications/${detail.application.id}`)
        ) {
          return jsonResponse(detail);
        }
        return defaultAuthenticatedFetch(input, init);
      },
    },
  );
}

describe("SchoolWorkspace honesty states", () => {
  it("renders common items to verify when there is no published requirements catalog", async () => {
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      {
        fetchHandler: (input, init) => {
          if (
            String(input).includes(
              `/v1/applications/${workspaceApplicationFixture.id}`,
            )
          ) {
            return jsonResponse({
              application: workspaceApplicationFixture,
              tasks: [],
              essays: [],
              prompt_drafts: [],
              reference: workspaceReferenceFixture,
            });
          }
          return defaultAuthenticatedFetch(input, init);
        },
      },
    );

    expect(
      await screen.findByText("Common items to verify"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Published school requirements"),
    ).not.toBeInTheDocument();
  });

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

  it("suppresses tracking actions for published not-required items", async () => {
    const user = userEvent.setup();
    renderWorkspace({
      application: workspaceApplicationFixture,
      essays: [],
      prompt_drafts: [],
      reference: {
        ...workspaceReferenceFixture,
        populated: true,
        requirements: [requirement({ applicability: "not_required" })],
      },
      tasks: [],
    });

    await user.click(await screen.findByText("Application fee"));
    expect(
      screen.getByText("No tracking needed for a cataloged not-required item."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Tracking status for Application fee"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add task for Fee")).not.toBeInTheDocument();
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

  it("reloads the application after changing cycle year", async () => {
    const fetchHandler = createWorkspaceFetchPreset();
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      {
        fetchHandler,
      },
    );

    expect(await screen.findByText("2026-27")).toBeInTheDocument();
    const cycleInput = screen.getByLabelText("Cycle year");
    fireEvent.change(cycleInput, { target: { value: "2028" } });
    fireEvent.blur(cycleInput);

    expect(await screen.findByText("2027-28")).toBeInTheDocument();
  });
});
