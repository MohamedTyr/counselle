import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  ApplicationDetail,
  SchoolEssayPrompt,
  SchoolRequirement,
} from "@/api/workspace/types";

import {
  createWorkspaceFetchPreset,
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
  workspaceEssayFixture,
  workspaceReferenceFixture,
} from "@/test/render-app";

const provenance = {
  published_at: "2026-07-12T12:00:00Z",
  source: "Admissions office",
  source_url: "https://example.edu/admissions",
  verified_at: "2026-07-12",
};

function prompt(overrides: Partial<SchoolEssayPrompt> = {}): SchoolEssayPrompt {
  return {
    applicability: "required",
    audience: {},
    cycle_year: 2027,
    group_id: null,
    id: "60000000-0000-4000-8000-000000000001",
    ordinal: 1,
    prompt: "Why this school?",
    provenance,
    school_unitid: workspaceApplicationFixture.school_unitid,
    word_limit: 250,
    ...overrides,
  };
}

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
  it("renders a loaded empty catalog as unavailable data without inventing facts", async () => {
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
      await screen.findByText(
        "No catalog data for the 2026-27 application cycle",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing is inferred or fabricated\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Common items to verify")).toBeInTheDocument();
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

  it("requires a cycle and suppresses supplied reference prompts when it is unknown", async () => {
    renderWorkspace({
      application: { ...workspaceApplicationFixture, cycle_year: null },
      essays: [],
      prompt_drafts: [],
      reference: {
        ...workspaceReferenceFixture,
        cycle_year: null,
        prompts: [prompt()],
        status: "cycle_required",
      },
      tasks: [],
    });

    expect(
      await screen.findByText("Confirm the application cycle first"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Why this school?")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start writing" }),
    ).not.toBeInTheDocument();
  });

  it("suppresses draft and tracking actions for published not-required items", async () => {
    const user = userEvent.setup();
    renderWorkspace({
      application: workspaceApplicationFixture,
      essays: [],
      prompt_drafts: [],
      reference: {
        ...workspaceReferenceFixture,
        populated: true,
        prompts: [prompt({ applicability: "not_required" })],
        requirements: [requirement({ applicability: "not_required" })],
      },
      tasks: [],
    });

    expect(
      await screen.findByText(
        "No draft action because this prompt is published as not required.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start writing" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("Application fee"));
    expect(
      screen.getByText("No tracking needed for a cataloged not-required item."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Tracking status for Application fee"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add task for Fee")).not.toBeInTheDocument();
  });

  it("keeps a linked essay visible when its prompt leaves the published catalog", async () => {
    renderWorkspace({
      application: workspaceApplicationFixture,
      essays: [
        {
          ...workspaceEssayFixture,
          prompt_ref: "60000000-0000-4000-8000-000000000099",
          title: "Preserved historical draft",
        },
      ],
      prompt_drafts: [],
      reference: workspaceReferenceFixture,
      tasks: [],
    });

    expect(
      await screen.findByText("Historical or unavailable prompts"),
    ).toBeInTheDocument();
    expect(screen.getByText("Preserved historical draft")).toBeInTheDocument();
    expect(screen.getByText(/Prompt unavailable/)).toBeInTheDocument();
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

  it("reloads the cycle-scoped reference after changing cycle year", async () => {
    const fetchHandler = createWorkspaceFetchPreset();
    renderApp(
      `/app/schools/${workspaceApplicationFixture.school_unitid}?tab=application`,
      {
        fetchHandler,
      },
    );

    expect(
      await screen.findByText(
        "No catalog data for the 2026-27 application cycle",
      ),
    ).toBeInTheDocument();
    const cycleInput = screen.getByLabelText("Cycle year");
    fireEvent.change(cycleInput, { target: { value: "2028" } });
    fireEvent.blur(cycleInput);

    expect(
      await screen.findByText(
        "No catalog data for the 2027-28 application cycle",
      ),
    ).toBeInTheDocument();
  });
});
