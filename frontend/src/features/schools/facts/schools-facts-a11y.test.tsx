import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SchoolFactsNav } from "@/features/schools/facts/SchoolFactsNav";
import { SchoolFactsSection } from "@/features/schools/facts/SchoolFactsSection";
import { SchoolFactsSkeleton } from "@/features/schools/facts/SchoolFactsSkeleton";
import type {
  DeadlinesBlock,
  Fact,
  FactGroup,
  FactSection,
} from "@/features/schools/facts/school-facts-types";
import { TableBlock } from "@/features/schools/facts/TableBlock";

/*
 * Phase 2 exit-gate a11y coverage for the facts (About) tab (plan §7 Phase 2
 * row): landmarks, the visible-focus token contract, "never colour alone"
 * for a fact's absence state, `TableBlock`'s region/aria-label contract, and
 * the loading skeleton's `aria-busy`. These earn their place because they
 * are the specific accessibility clauses the plan calls out as hard gates,
 * not routine render checks (`TableBlock.test.tsx` already covers the
 * cell-content honesty rule this file's TableBlock section does not repeat).
 */

const emptyDeadlines: DeadlinesBlock = { rows: [], foot: "" };

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

function group(overrides: Partial<FactGroup> & Pick<FactGroup, "id" | "facts">): FactGroup {
  return { label: null, foot: null, chart: null, ...overrides };
}

function section(
  overrides: Partial<FactSection> & Pick<FactSection, "id" | "title" | "groups">,
): FactSection {
  return { fetch_state: "ok", never_checked: false, line: null, foot: null, ...overrides };
}

describe("Landmarks", () => {
  test("SchoolFactsNav is a navigation landmark named 'School fact sections'", () => {
    render(
      <SchoolFactsNav
        onSelect={() => {}}
        sections={[
          { id: "getting-in", title: "Getting In" },
          { id: "money", title: "Money" },
        ]}
        selected="getting-in"
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "School fact sections" }),
    ).toBeInTheDocument();
  });

  test("a section is a labelled region, named by its own heading", () => {
    const active = section({
      id: "money",
      title: "Money Matters",
      groups: [
        group({
          id: "cost",
          facts: [scalarFact({ key: "money.cost", label: "Cost", display: "$62,000" })],
        }),
      ],
    });
    render(<SchoolFactsSection deadlines={emptyDeadlines} section={active} />);

    const region = screen.getByRole("region", { name: "Money Matters" });
    expect(region.tagName).toBe("SECTION");
    const heading = screen.getByRole("heading", { level: 2, name: "Money Matters" });
    expect(region).toHaveAttribute("aria-labelledby", heading.id);
  });
});

describe("Focus rings -- the visible-focus token contract, not a pixel", () => {
  test("a nav row carries the buttons/sidebar-rows focus-ring token", () => {
    render(
      <SchoolFactsNav
        onSelect={() => {}}
        sections={[{ id: "getting-in", title: "Getting In" }]}
        selected="getting-in"
      />,
    );

    const row = screen.getByRole("button", { name: "Getting In" });
    expect(row.className).toContain("focus-visible:ring-2");
    expect(row.className).toContain("focus-visible:ring-[var(--focus-ring)]");
  });

  test("a table's inline link carries the same focus-ring token", () => {
    const linked = section({
      id: "money",
      title: "Money",
      groups: [
        group({
          id: "aid",
          facts: [
            {
              key: "money.aid_link",
              label: "Financial Aid",
              tab: "money-matters",
              state: "value",
              kind: "link",
              display: "Financial Aid Website",
              unit: null,
              value: "https://example.edu/aid",
              observed_at: "2026-06-01T00:00:00Z",
              reported_period: null,
              caveat_ids: [],
            },
          ],
        }),
      ],
    });
    render(<SchoolFactsSection deadlines={emptyDeadlines} section={linked} />);

    const link = screen.getByRole("link", { name: "Financial Aid Website" });
    expect(link.className).toContain("focus-visible:ring-2");
    expect(link.className).toContain("focus-visible:ring-[var(--focus-ring)]");
  });
});

describe("A fact's absence state is never colour alone", () => {
  test("distinct absence states render distinct, readable sentences -- not merely a colour class", () => {
    const withAbsences = section({
      id: "academics",
      title: "Academics",
      groups: [
        group({
          id: "faculty",
          facts: [
            scalarFact({
              key: "faculty.count",
              label: "Faculty count",
              state: "not_reported",
              display: "Not reported",
            }),
            scalarFact({
              key: "faculty.pct_terminal",
              label: "% with terminal degree",
              state: "not_published",
              display: "Not published",
            }),
            scalarFact({
              key: "faculty.ratio",
              label: "Student:faculty ratio",
              state: "value",
              display: "8:1",
            }),
          ],
        }),
      ],
    });
    render(<SchoolFactsSection deadlines={emptyDeadlines} section={withAbsences} />);

    const notReported = screen.getByText("Not reported");
    const notPublished = screen.getByText("Not published");
    const reportedValue = screen.getByText("8:1");

    // Every state is carried by real, distinguishable text content --
    // never an identical string distinguished only by a colour class.
    expect(notReported.textContent).not.toBe(notPublished.textContent);
    expect(notReported.className).toContain("italic");
    expect(notPublished.className).toContain("italic");
    // The reported value is never styled with the absence ink/slant --
    // a legitimate value can never be mistaken for the absence grammar.
    expect(reportedValue.className).not.toContain("italic");
  });
});

describe("TableBlock's region/aria-label contract", () => {
  const matrixFact: Fact = {
    key: "campus_life.sports_offered",
    label: "Sports offered",
    tab: "campus-life",
    state: "value",
    kind: "matrix",
    display: "2 sports",
    unit: null,
    value: {
      rows: [
        { label: "Basketball", Men: true, Women: false },
        { label: "Soccer", Men: false, Women: true },
      ],
    },
    observed_at: "2026-01-01T00:00:00Z",
    reported_period: null,
    caveat_ids: [],
  };

  test("the scroll container is a keyboard-reachable, labelled region", () => {
    render(<TableBlock fact={matrixFact} />);

    const region = screen.getByRole("region", { name: "Sports offered" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  test("a true cell is an icon labelled 'Offered', a false cell a dash labelled 'Not offered' with a title -- never a blank cell", () => {
    render(<TableBlock fact={matrixFact} />);

    const offered = screen.getAllByLabelText("Offered");
    expect(offered.length).toBe(2);

    const notOffered = screen.getAllByLabelText("Not offered");
    expect(notOffered.length).toBe(2);
    for (const cell of notOffered) {
      expect(cell).toHaveAttribute("title", "Not offered");
      expect(cell.textContent?.trim()).not.toBe("");
    }
  });
});

describe("SchoolFactsSkeleton", () => {
  test("marks itself aria-busy while loading", () => {
    const { container } = render(<SchoolFactsSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });
});
