import { screen, waitFor } from "@testing-library/react";

import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";
import {
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
} from "@/test/render-app";

const UNITID = workspaceApplicationFixture.school_unitid;
const PATH = `/app/schools/${UNITID}`;

function factsFixture(overrides: Partial<SchoolFactsResponse> = {}): SchoolFactsResponse {
  return {
    identity: {
      unitid: UNITID,
      name: "Fixture University",
      city: "Somewhere",
      state: "CA",
      control: "private",
      undergraduates: 1000,
      website_url: "https://fixture.example.edu",
      domain: "fixture.example.edu",
    },
    has_collegedata: true,
    observed_at: "2026-06-01T00:00:00Z",
    is_stale: false,
    freshness_line: "Checked June 2026",
    deadlines: { rows: [], foot: "Confirm on the school's site before you apply." },
    sections: [],
    caveats: [],
    ...overrides,
  };
}

/*
 * Honesty-critical: a pending fetch must render the skeleton, never a
 * redirect (`SchoolDetailRoute.tsx` used to `Navigate` away from a school
 * with no synchronous data — plan §5.2). A 404 must render the "we don't
 * have this school" Empty state, never the generic error card, and a 5xx
 * must render the error card, never a silent empty catalog.
 */

describe("SchoolDetailRoute — facts fetch states", () => {
  test("opening About never requests the lazy Profile resource", async () => {
    const requestedUrls: string[] = [];
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        requestedUrls.push(String(input));
        if (String(input).includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(factsFixture());
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    expect(
      await screen.findByRole("tab", { name: "About", selected: true }),
    ).toBeInTheDocument();
    expect(requestedUrls).not.toContain("/v1/profile");
    expect(requestedUrls.some((url) => url.endsWith("/v1/profile"))).toBe(
      false,
    );
  });

  /* Phase 3 turns these deliberately red contract slots into exercised route
   * tests when the Compare panel exists. Phase 0 must not mount a placeholder
   * panel merely to make Profile's lazy-creation GET happen. */
  test.todo(
    "selecting Compare requests GET /v1/profile exactly once after facts resolve",
  );
  test.todo(
    "Compare scenarios issue no PATCH, application, or estimator request",
  );

  test("a pending query renders the skeleton, never a redirect", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        if (String(input).includes(`/v1/schools/${UNITID}/facts`)) {
          return pending;
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    /* The skeleton is up immediately — never a URL change away from the
     * school page while the fetch is in flight. */
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(window.location.pathname).toBe(PATH);

    resolve(jsonResponse(factsFixture()));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Fixture University",
      ),
    );
    expect(window.location.pathname).toBe(PATH);
  });

  test("a 404 renders the \"we don't have this school\" Empty, never the error card", async () => {
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        if (String(input).includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(
            { error: { message: "That school is not in our database." } },
            { status: 404 },
          );
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    expect(
      await screen.findByText("We don't have this school"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Could not load this school's facts")).toBeNull();
  });

  test("a 500 renders the error card, never a silent empty page", async () => {
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        if (String(input).includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse({ error: { message: "boom" } }, { status: 500 });
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    expect(
      await screen.findByText("Could not load this school's facts"),
    ).toBeInTheDocument();
    expect(screen.queryByText("We don't have this school")).toBeNull();
  });

  test("has_collegedata: false renders the About tab's empty state, not the whole-page 404", async () => {
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        if (String(input).includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(factsFixture({ has_collegedata: false }));
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    expect(
      await screen.findByText("No facts collected for Fixture University"),
    ).toBeInTheDocument();
  });
});
