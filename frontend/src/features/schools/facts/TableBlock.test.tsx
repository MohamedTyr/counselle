import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { TableBlock } from "@/features/schools/facts/TableBlock";
import type { Fact } from "@/features/schools/facts/school-facts-types";

/*
 * Honesty-critical: a `false` matrix cell is a real "no" (the sport is not
 * offered), never a missing cell — plan §5.2/§7 requires a dash WITH an
 * aria-label, not a blank `<td>`.
 */

function matrixFact(overrides: Partial<Fact> = {}): Fact {
  return {
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
    ...overrides,
  };
}

describe("a matrix's false cell", () => {
  test("renders a dash with an aria-label, never an empty cell", () => {
    render(<TableBlock fact={matrixFact()} />);
    const dashes = screen.getAllByLabelText("Not offered");
    expect(dashes.length).toBeGreaterThan(0);
    for (const dash of dashes) {
      expect(dash.textContent?.trim()).not.toBe("");
    }
  });

  test("a true cell renders the Check icon labelled Offered", () => {
    render(<TableBlock fact={matrixFact()} />);
    expect(screen.getAllByLabelText("Offered").length).toBe(2);
  });

  test("every cell in the grid is accounted for — no blank <td>", () => {
    const { container } = render(<TableBlock fact={matrixFact()} />);
    const cells = container.querySelectorAll("tbody td:not(:first-child)");
    expect(cells.length).toBe(4);
    for (const cell of cells) {
      expect(cell.textContent?.trim() || cell.querySelector("svg")).toBeTruthy();
    }
  });
});

describe("the `table` kind (Phase 2 review, Finding 6)", () => {
  test("renders nothing -- no producer ships this shape, so no generic renderer exists for it", () => {
    const fact = matrixFact({ kind: "table", value: { rows: [{ a: "1" }] } });
    const { container } = render(<TableBlock fact={fact} />);
    expect(container.firstChild).toBeNull();
  });
});
