import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CoverageCell, CoverageRow } from "@/api/cds-admin/types";

import { CoverageGrid } from "./CoverageGrid";

/** 0ca3d448: `adapters/cds_admin_queries.py::_cell_from_row` only populates
 * `candidate_domains` for "needs_review"/"failed" cells — "approved" and
 * "correction_pending" cells carry `active_domains`/`partial_domains`
 * instead, and `candidate_domains` is always `null` on them. Gating the
 * partial marker on `candidate_domains !== null` made it structurally
 * unreachable on every approved cell: a document extracted for 9 of 13
 * active domains rendered a bare "Approved" chip with no sub-marker, no
 * tooltip line, and an aria-label that dropped the incompleteness entirely —
 * a confident, and false, "this is complete" claim (root DESIGN.md §1.1: "a
 * badge must be true, never a guess"). This pins the fix across all three
 * honesty surfaces named in the fix: the cell's visual sub-marker, the
 * tooltip, and the aria-label. */
function cell(overrides: Partial<CoverageCell> = {}): CoverageCell {
  return {
    status: "approved",
    school_year_id: 1,
    document_id: 42,
    extraction_id: "extraction-1",
    extractor_version: "counselle-cds-v1",
    error_code: null,
    updated_at: "2026-08-01T00:00:00Z",
    active_domains: null,
    partial_domains: null,
    candidate_domains: null,
    job_status: null,
    ...overrides,
  };
}

function row(cells: Record<number, CoverageCell>): CoverageRow {
  return { school_id: 1, name: "Harvard University", state: "MA", cells };
}

function renderGrid(rows: CoverageRow[]) {
  return render(
    <TooltipProvider>
      <CoverageGrid
        emptyMessage="No schools match these filters."
        onOpenDocument={vi.fn()}
        onOpenUpload={vi.fn()}
        rows={rows}
        years={[2024]}
      />
    </TooltipProvider>,
  );
}

describe("CoverageGrid — approved-cell partial marker (honesty)", () => {
  test("an approved cell extracted for only some active domains shows the partial marker and a true aria-label", () => {
    renderGrid([
      row({
        2024: cell({ active_domains: 13, partial_domains: 9 }),
      }),
    ]);

    const button = screen.getByRole("button", {
      name: /Harvard University, 2023–24 — Approved, 9 of 13 active domains partial\. Open document review\./,
    });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("9/13 partial")).toBeInTheDocument();
  });

  test("an approved cell with zero partial active domains shows the bare Approved badge, no marker", () => {
    renderGrid([
      row({
        2024: cell({ active_domains: 13, partial_domains: 0 }),
      }),
    ]);

    const button = screen.getByRole("button", {
      name: "Harvard University, 2023–24 — Approved. Open document review.",
    });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText(/partial/)).not.toBeInTheDocument();
  });

  test("a correction_pending cell with partial active domains also gets the marker", () => {
    renderGrid([
      row({
        2024: cell({
          status: "correction_pending",
          active_domains: 8,
          partial_domains: 2,
        }),
      }),
    ]);

    expect(
      screen.getByRole("button", {
        name: /Correction pending, 2 of 8 active domains partial\. Open document review\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2/8 partial")).toBeInTheDocument();
  });
});
