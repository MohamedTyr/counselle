import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

import type { DocumentReviewOut, ReviewMetric } from "@/api/cds-admin/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createTestQueryClient } from "@/test/render-app";

import { ReviewPanel } from "./ReviewPanel";
import {
  ReviewControllerContext,
  type ReviewController,
} from "./review-context";

/** 0de6eff: `flags_summary.unresolved` counts only `error`-severity flags —
 * its one job is gating Approve. The flag bar, the n/p walk buttons, and the
 * "Everything extracted cleanly" line must key off the flag queue the panel
 * can actually walk (flagged metrics with no pending edit, warnings
 * included), never off `unresolved` — a document whose flags are all
 * `warning` must not read "No flags" while listing 18 of them underneath. */
function warningMetric(ref: string): ReviewMetric {
  return {
    ref,
    title: ref,
    description: null,
    type: "string",
    unit: null,
    source_hints: [],
    value: "some value",
    raw_value: "some value",
    display: "some value",
    availability_status: "reported",
    extraction_status: "verified",
    evidence: null,
    flags: [
      {
        code: "possible_hallucinated_page_citation",
        severity: "warning",
        message: "possible hallucinated page citation",
        metric_ref: ref,
      },
    ],
    pending_edit: null,
  };
}

function cleanMetric(ref: string): ReviewMetric {
  return { ...warningMetric(ref), flags: [] };
}

function review(overrides: Partial<DocumentReviewOut> = {}): DocumentReviewOut {
  return {
    document: {
      id: 1,
      school_year_id: 1,
      school_id: 1,
      school_name: "Yale University",
      academic_year: 2025,
      pdf_sha256: "sha",
      pdf_size_bytes: 100,
      original_filename: "yale.pdf",
      source_kind: "upload",
      retrieved_at: "2026-08-01T00:00:00Z",
      invalidated_at: null,
      superseded_at: null,
      is_candidate: true,
      is_active: false,
      is_correction_pending: false,
      page_count: 43,
    },
    extraction: {
      id: "ext-1",
      status: "succeeded",
      extractor_version: "1",
      model_id: "m",
      finished_at: "2026-08-01T00:01:00Z",
      error_code: null,
      counts: {},
    },
    sections: [],
    flags_summary: { unresolved: 0, total: 0 },
    ...overrides,
  };
}

function controller(overrides: Partial<ReviewController> = {}): ReviewController {
  return {
    openDomains: new Set(),
    setOpenDomains: () => {},
    editingRef: null,
    setEditingRef: () => {},
    registerMetricRef: () => {},
    reportFocus: () => {},
    focusMetric: () => {},
    jumpEvidence: () => {},
    goToNextFlag: () => {},
    goToPrevFlag: () => {},
    flagQueueLength: 0,
    flaggedFirst: false,
    shortcutsOpen: false,
    setShortcutsOpen: () => {},
    supersededRefs: new Set(),
    ...overrides,
  };
}

function renderPanel(
  reviewValue: DocumentReviewOut,
  controllerValue: ReviewController,
  readOnly = false,
) {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={createTestQueryClient()}>
        <TooltipProvider>
          <ReviewControllerContext value={controllerValue}>
            {children}
          </ReviewControllerContext>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }
  const result = render(
    <Providers>
      <ReviewPanel
        documentId={1}
        flaggedFirst={false}
        onFlaggedFirstChange={vi.fn()}
        onRerun={vi.fn()}
        readOnly={readOnly}
        review={reviewValue}
      />
    </Providers>,
  );
  // The flag bar strip (§5.5) — scoping assertions to it, not the whole
  // document, avoids colliding with the accordion header's own "N/M
  // verified" counts, which share plain digits with the flag bar.
  const bar = result.container.querySelector<HTMLElement>("div.h-10");
  if (!bar) throw new Error("flag bar not found");
  return { ...result, bar };
}

describe("ReviewPanel — the flag bar never lies about warning-only flags", () => {
  test("warnings present, zero error-severity flags: reports them as still to review, not 'No flags', and enables n/p", () => {
    const { bar } = renderPanel(
      review({
        sections: [
          {
            domain_id: "financial_aid",
            title: "Financial Aid",
            status: null,
            counts: {},
            metrics: [warningMetric("a"), warningMetric("b")],
          },
        ],
        flags_summary: { unresolved: 0, total: 2 },
      }),
      controller({ flagQueueLength: 2 }),
    );

    expect(bar.textContent).not.toMatch(/No flags/);
    expect(bar.textContent?.replace(/\s+/g, " ")).toContain("2 to review of 2");
    expect(
      screen.queryByText(/Everything extracted cleanly/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous unresolved flag" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Next unresolved flag" }),
    ).toBeEnabled();
  });

  test("genuinely zero flags: says 'No flags', disables n/p, and shows the clean-extraction line", () => {
    const { bar } = renderPanel(
      review({
        sections: [
          {
            domain_id: "financial_aid",
            title: "Financial Aid",
            status: null,
            counts: {},
            metrics: [cleanMetric("a")],
          },
        ],
        flags_summary: { unresolved: 0, total: 0 },
      }),
      controller({ flagQueueLength: 0 }),
    );

    expect(bar.textContent).toMatch(/No flags/);
    expect(
      screen.getByText(
        "Everything extracted cleanly. Spot-check a section, then approve.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous unresolved flag" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next unresolved flag" }),
    ).toBeDisabled();
  });

  test("every flag already edited (toReview 0, total > 0): 'all edited', never 'No flags' and never the clean-extraction claim", () => {
    const editedMetric: ReviewMetric = {
      ...warningMetric("a"),
      pending_edit: {
        value: "corrected",
        raw_value: "corrected",
        availability_status: "reported",
        evidence: { page_number: 9, excerpt: "corrected", section: null, row_label: null, column_label: null },
        note: null,
        edited_by: "admin@counselle.test",
        edited_at: "2026-08-31T00:00:00Z",
      },
    };
    const { bar } = renderPanel(
      review({
        sections: [
          {
            domain_id: "financial_aid",
            title: "Financial Aid",
            status: null,
            counts: {},
            metrics: [editedMetric],
          },
        ],
        flags_summary: { unresolved: 0, total: 1 },
      }),
      controller({ flagQueueLength: 0 }),
    );

    expect(bar.textContent?.replace(/\s+/g, " ")).toContain("1 flag, all edited");
    expect(bar.textContent).not.toMatch(/No flags/);
    expect(
      screen.queryByText(/Everything extracted cleanly/),
    ).not.toBeInTheDocument();
  });
});
