import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { SchoolFactsResponse } from "@/features/schools/facts/school-facts-types";
import { schoolChancesFactFixtures } from "@/features/schools/chances/school-chances-fixtures";
import {
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
} from "@/test/render-app";

const UNITID = workspaceApplicationFixture.school_unitid;
const PATH = `/app/schools/${UNITID}`;

function factsFixture(
  overrides: Partial<SchoolFactsResponse> = {},
): SchoolFactsResponse {
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
    deadlines: {
      rows: [],
      foot: "Confirm on the school's site before you apply.",
    },
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
    expect(
      document.querySelector("[data-slot=school-chances-panel]"),
    ).toBeNull();
  });

  test("selecting Compare requests GET /v1/profile exactly once after facts resolve", async () => {
    const requestedUrls: string[] = [];
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        const url = String(input);
        requestedUrls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(
            factsFixture({ sections: schoolChancesFactFixtures.full.sections }),
          );
        }
        if (url.endsWith("/v1/profile")) return jsonResponse({});
        return defaultAuthenticatedFetch(input, init);
      },
    });

    expect(await screen.findByRole("tab", { name: "Compare" })).toBeVisible();
    expect(
      requestedUrls.some((request) => request.endsWith("/v1/profile")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));

    await waitFor(() =>
      expect(
        requestedUrls.filter((request) => request === "GET /v1/profile"),
      ).toHaveLength(1),
    );
    expect(window.location.search).toContain("tab=chances");
  });

  test("returns to Compare from About with the cached Profile and no skeleton flash", async () => {
    const requestedUrls: string[] = [];
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        const url = String(input);
        requestedUrls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(
            factsFixture({ sections: schoolChancesFactFixtures.full.sections }),
          );
        }
        if (url.endsWith("/v1/profile")) {
          return jsonResponse({
            academics: { gpa_unweighted: "3.82", gpa_scale: "4.0" },
          });
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Compare" }));
    await screen.findByRole("radio", { name: "GPA", checked: true });
    expect(
      requestedUrls.filter((request) => request === "GET /v1/profile"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    await screen.findByRole("tab", { name: "About", selected: true });
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));

    expect(
      await screen.findByRole("radio", { name: "GPA", checked: true }),
    ).toBeVisible();
    expect(
      document.querySelector("[data-slot=school-chances-skeleton]"),
    ).toBeNull();
    expect(
      requestedUrls.filter((request) => request === "GET /v1/profile"),
    ).toHaveLength(1);
  });

  test("pushes tab navigation while metric changes replace and preserves shareable parameters", async () => {
    renderApp(`${PATH}?from=school-list`, {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.includes(`/v1/schools/${UNITID}/facts`))
          return jsonResponse(
            factsFixture({ sections: schoolChancesFactFixtures.full.sections }),
          );
        if (url.endsWith("/v1/profile")) return jsonResponse({});
        return defaultAuthenticatedFetch(input, init);
      },
    });

    const beforeTab = window.history.length;
    fireEvent.click(await screen.findByRole("tab", { name: "Compare" }));
    await screen.findByRole("radio", { name: "GPA", checked: true });
    expect(window.history.length).toBe(beforeTab + 1);
    expect(window.location.search).toContain("from=school-list");

    fireEvent.click(screen.getByRole("radio", { name: "SAT" }));
    await screen.findByRole("radio", { name: "SAT", checked: true });
    expect(window.history.length).toBe(beforeTab + 1);
    expect(window.location.search).toContain("tab=chances");
    expect(window.location.search).toContain("metric=sat");

    window.history.back();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(
      await screen.findByRole("tab", { name: "About", selected: true }),
    ).toBeVisible();
    window.history.forward();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(
      await screen.findByRole("radio", { name: "SAT", checked: true }),
    ).toBeVisible();
  });

  test("Compare scenarios — drag, keyboard, and pill exact entry — issue no PATCH, application, or estimator request", async () => {
    const requestedUrls: string[] = [];
    renderApp(PATH, {
      fetchHandler: (input, init) => {
        const url = String(input);
        requestedUrls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes(`/v1/schools/${UNITID}/facts`)) {
          return jsonResponse(
            factsFixture({ sections: schoolChancesFactFixtures.full.sections }),
          );
        }
        if (url.endsWith("/v1/profile")) {
          return jsonResponse({
            academics: { gpa_unweighted: "3.80", gpa_scale: "4.0" },
          });
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Compare" }));
    // The plot itself is the slider now (school-chances-redesign plan §5) —
    // its own `role="slider"` control replaces the old bordered-slider
    // input this selector used to find by its "Explore GPA" label.
    const slider = await screen.findByRole("slider", { name: "GPA" });
    const requestsBeforeScenario = [...requestedUrls];

    // Keyboard step.
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() =>
      expect(slider).toHaveAttribute("aria-valuenow", "3.81"),
    );

    // Pointer drag.
    Object.defineProperties(slider, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 300,
      toJSON: () => ({}),
      top: 0,
      width: 300,
      x: 0,
      y: 0,
    });
    fireEvent.pointerDown(slider, { button: 0, clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 150, pointerId: 1 });
    await waitFor(() =>
      expect(slider).not.toHaveAttribute("aria-valuenow", "3.81"),
    );

    // Pill exact entry.
    fireEvent.keyDown(slider, { key: "Enter" });
    const input = await screen.findByLabelText("Enter an exact value");
    fireEvent.input(input, { target: { value: "3.79" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(slider).toHaveAttribute("aria-valuenow", "3.79"),
    );

    expect(requestedUrls).toEqual(requestsBeforeScenario);
  });

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

  test('a 404 renders the "we don\'t have this school" Empty, never the error card', async () => {
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
