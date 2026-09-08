import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SchoolFactsDeadlines } from "@/features/schools/facts/SchoolFactsDeadlines";
import type { DeadlinesBlock } from "@/features/schools/facts/school-facts-types";

/*
 * Honesty-critical: every string here is already composed server-side
 * (`app/facts/service.py::_build_deadlines`) — this component only lays the
 * wire's own words out. The five clauses this file exists to guard:
 *
 *   1. A dated row carries its cycle label.
 *   2. A rolling deadline renders "Rolling" verbatim.
 *   3. A round the source marks not-offered renders "Not offered",
 *      state "value" — never "Not reported".
 *   4. The group foot always renders.
 *   5. No fact renders when the block is empty.
 */

function block(overrides: Partial<DeadlinesBlock> = {}): DeadlinesBlock {
  return {
    rows: [
      {
        round: "Regular decision",
        date: "2027-01-02",
        display: "January 2, 2027",
        reported_period: "2026-27",
        state: "value",
        observed_at: "2026-06-01T00:00:00Z",
      },
      {
        round: "Rolling admission",
        date: null,
        display: "Rolling",
        reported_period: null,
        state: "value",
        observed_at: "2026-06-01T00:00:00Z",
      },
      {
        round: "Early decision",
        date: null,
        display: "Not offered",
        reported_period: null,
        state: "value",
        observed_at: "2026-06-01T00:00:00Z",
      },
      {
        round: "Early action",
        date: null,
        display: "Not checked",
        reported_period: null,
        state: "not_fetched",
        observed_at: null,
      },
    ],
    foot: "Dates last confirmed June 2026 for the 2026-27 cycle. Confirm on the school's site before you apply.",
    ...overrides,
  };
}

describe("SchoolFactsDeadlines", () => {
  test("a dated row carries its cycle label as a context suffix", () => {
    render(<SchoolFactsDeadlines deadlines={block()} />);
    expect(screen.getByText("January 2, 2027")).toBeInTheDocument();
    expect(screen.getByText("2026-27")).toBeInTheDocument();
  });

  test("a rolling deadline renders \"Rolling\" verbatim", () => {
    render(<SchoolFactsDeadlines deadlines={block()} />);
    expect(screen.getByText("Rolling")).toBeInTheDocument();
  });

  test("a not-offered round renders \"Not offered\", styled as a value, never as an absence", () => {
    const { container } = render(<SchoolFactsDeadlines deadlines={block()} />);
    const cell = [...container.querySelectorAll("td")].find(
      (candidate) => candidate.textContent === "Not offered",
    );
    expect(cell).toBeDefined();
    expect(cell?.className).not.toContain("italic");
    expect(cell?.className).not.toContain("--school-fact-absent");
    /* And it never collapses into "Not checked" — a student who reads
     * "not offered" stops looking, so the two rows must read differently. */
    expect(screen.getByText("Not checked")).toBeInTheDocument();
  });

  test("the group foot always renders", () => {
    render(<SchoolFactsDeadlines deadlines={block()} />);
    expect(
      screen.getByText(
        "Dates last confirmed June 2026 for the 2026-27 cycle. Confirm on the school's site before you apply.",
      ),
    ).toBeInTheDocument();
  });

  test("an empty block renders nothing", () => {
    const { container } = render(
      <SchoolFactsDeadlines deadlines={{ rows: [], foot: "Confirm on the school's site before you apply." }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
