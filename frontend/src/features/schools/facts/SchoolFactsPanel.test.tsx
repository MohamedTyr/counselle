import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";

import { SchoolFactsPanel } from "@/features/schools/facts/SchoolFactsPanel";
import type {
  Fact,
  FactSection,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

/*
 * Honesty-critical: every sentence a student reads on this page is composed
 * server-side and carried verbatim on the wire (plan §5.2). These tests
 * check that the panel renders exactly what it is given, distinguishes the
 * whole-page states correctly, and never authors a word of its own.
 */

function identity(): SchoolFactsResponse["identity"] {
  return {
    unitid: 130794,
    name: "Yale University",
    city: "New Haven",
    state: "CT",
    control: "private",
    undergraduates: 6600,
    website_url: "https://yale.edu",
    domain: "yale.edu",
  };
}

function scalarFact(overrides: Partial<Fact> & Pick<Fact, "key" | "label">): Fact {
  return {
    tab: "admission",
    state: "value",
    kind: "scalar",
    display: "value",
    unit: null,
    value: null,
    observed_at: "2026-06-01T00:00:00Z",
    reported_period: null,
    caveat_ids: [],
    ...overrides,
  };
}

function section(
  overrides: Partial<FactSection> & Pick<FactSection, "id" | "title">,
): FactSection {
  return {
    fetch_state: "ok",
    never_checked: false,
    line: null,
    foot: null,
    groups: [
      {
        id: "g1",
        label: "Group one",
        foot: null,
        chart: null,
        facts: [scalarFact({ key: "k1", label: "Metric one", display: "42" })],
      },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<SchoolFactsResponse> = {}): SchoolFactsResponse {
  return {
    identity: identity(),
    has_collegedata: true,
    observed_at: "2026-06-01T00:00:00Z",
    is_stale: false,
    freshness_line: "Checked June 2026",
    deadlines: { rows: [], foot: "Confirm on the school's site before you apply." },
    sections: [section({ id: "getting-in", title: "Getting in" })],
    caveats: [],
    ...overrides,
  };
}

function renderPanel(data: SchoolFactsResponse, initialSection?: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialSection ? `/?section=${initialSection}` : "/"]}
    >
      <SchoolFactsPanel data={data} />
    </MemoryRouter>,
  );
}

describe("freshness", () => {
  test("renders the wire's freshness_line plus the fixed second clause, once", () => {
    renderPanel(response());
    expect(screen.getByText("Checked June 2026")).toBeInTheDocument();
    expect(
      screen.getAllByText(/is when we last saw a value published/),
    ).toHaveLength(1);
  });

  test("a stale school's freshness line is the wire's swapped sentence, never a second claim", () => {
    renderPanel(
      response({
        is_stale: true,
        freshness_line: "Last checked January 2026 — this may be out of date",
        caveats: [{ id: "stale_facts", text: "may be out of date", severity: "ordinary" }],
      }),
    );
    expect(
      screen.getByText("Last checked January 2026 — this may be out of date"),
    ).toBeInTheDocument();
    /* Never two freshness claims on one page — the caveat text is not
     * re-rendered as a second line beside it. */
    expect(screen.queryByText("may be out of date")).toBeNull();
  });
});

describe("whole-page states", () => {
  test("has_collegedata: false renders the no-facts-collected Empty, not a wall of rows", () => {
    renderPanel(response({ has_collegedata: false }));
    expect(
      screen.getByText("No facts collected for Yale University"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask Counselle" })).toBeInTheDocument();
  });

  test("every section never_fetched renders \"haven't checked... yet\", not a failure line", () => {
    renderPanel(
      response({
        sections: [
          section({
            id: "getting-in",
            title: "Getting in",
            fetch_state: "not_fetched",
            never_checked: true,
            line: "We haven't checked this page yet.",
            groups: [],
          }),
        ],
      }),
    );
    expect(
      screen.getByText("We haven't checked Yale University's pages yet"),
    ).toBeInTheDocument();
  });

  test("a mixed never_fetched + http_error page renders the read-failure line", () => {
    renderPanel(
      response({
        sections: [
          section({
            id: "getting-in",
            title: "Getting in",
            fetch_state: "not_fetched",
            never_checked: false,
            groups: [],
          }),
        ],
      }),
    );
    expect(
      screen.getByText("We couldn't read Yale University's pages on the last check"),
    ).toBeInTheDocument();
  });

  test("any section still ok renders the normal panel, never a whole-page Empty", () => {
    renderPanel(response());
    expect(
      screen.getByRole("heading", { level: 2, name: "Getting in" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/haven't checked/)).toBeNull();
  });

  test("every section partial (no section fully ok) still renders the normal panel, never the whole-page Empty", () => {
    /* Finding 4 (Phase 2 review): a `partial` section holds real values
     * from tabs that succeeded -- a failed tab never hides a value we
     * hold (plan §5.1). No section here is `ok`, but none is a bare
     * failure either, so the page must render normally. */
    renderPanel(
      response({
        sections: [
          section({
            id: "getting-in",
            title: "Getting in",
            fetch_state: "partial",
            never_checked: false,
          }),
        ],
      }),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Getting in" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/haven't checked/)).toBeNull();
    expect(screen.queryByText(/couldn't read/)).toBeNull();
  });
});

describe("section lines and period foot", () => {
  test("a not_published section's line renders verbatim, alongside a normal section", () => {
    /* Two sections so the whole page still counts as readable (one is
     * `ok`) — a not_published section on its own is the different,
     * whole-page case covered above. */
    renderPanel(
      response({
        sections: [
          section({ id: "getting-in", title: "Getting in" }),
          section({
            id: "money",
            title: "Money",
            fetch_state: "not_published",
            line: "We don't hold this school's Money information.",
            groups: [],
          }),
        ],
      }),
      "money",
    );
    expect(
      screen.getByText("We don't hold this school's Money information."),
    ).toBeInTheDocument();
  });

  test("a fact with no reported_period renders no suffix; the section's period foot renders exactly once", () => {
    renderPanel(
      response({
        sections: [
          section({
            id: "getting-in",
            title: "Getting in",
            foot: "Where no year is shown, we don't know which year the figure covers.",
            groups: [
              {
                id: "g1",
                label: "Group",
                foot: null,
                chart: null,
                facts: [
                  scalarFact({ key: "k1", label: "Metric one", display: "42" }),
                  scalarFact({ key: "k2", label: "Metric two", display: "43" }),
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(
      screen.getAllByText(
        "Where no year is shown, we don't know which year the figure covers.",
      ),
    ).toHaveLength(1);
  });
});

describe("no band-caption literal on the client", () => {
  test("the group's wire foot is rendered verbatim — this file authors no caption text", () => {
    const caption =
      "This band holds the middle half of the enrolled students who reported a score.";
    renderPanel(
      response({
        sections: [
          section({
            id: "getting-in",
            title: "Getting in",
            groups: [
              {
                id: "test-detail",
                label: null,
                foot: caption,
                chart: null,
                facts: [
                  {
                    key: "class_profile.sat_math",
                    label: "SAT Math",
                    tab: "admission",
                    state: "value",
                    kind: "band",
                    display: "700-790",
                    unit: null,
                    value: { p25: 700, p75: 790, min: 200, max: 800, submitted_percent: null },
                    observed_at: "2026-06-01T00:00:00Z",
                    reported_period: null,
                    caveat_ids: [],
                  },
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(screen.getByText(caption)).toBeInTheDocument();
  });
});
