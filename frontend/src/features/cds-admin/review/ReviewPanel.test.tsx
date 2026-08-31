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
    flagQueueIndex: -1,
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
  // verified" counts, which share plain digits with the flag bar. Located
  // by `data-testid`, not the `h-10` Tailwind utility class: a spacing
  // change to that class previously broke this lookup with an unrelated
  // "flag bar not found" error instead of a real assertion failure.
  const bar = result.getByTestId("flag-bar");
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

describe("ReviewPanel — flag bar denominator counts metrics, not raw flags", () => {
  /** `flag-queue.ts`'s `buildFlagQueue` pushes one entry per *metric*
   * (`if (hasUnresolvedFlag(metric)) queue.push(metric)`), so `toReview`
   * (`controller.flagQueueLength`) is a metric count. `flags_summary.total`
   * (`service_review._flags_summary`) counts *flags*, and a metric can carry
   * more than one: `excerpt_on_cited_page` and `corrupt_text_layer`
   * independently flag the same ref (`domain/cds/validators.py`). Every
   * other fixture in this file gives each metric exactly one flag, which
   * satisfies both the correct and the buggy implementation equally — this
   * is the fixture that tells them apart. */
  function twoFlagMetric(ref: string): ReviewMetric {
    return {
      ...warningMetric(ref),
      flags: [
        {
          code: "excerpt_on_cited_page",
          severity: "warning",
          message: "excerpt not found on cited page",
          metric_ref: ref,
        },
        {
          code: "corrupt_text_layer",
          severity: "warning",
          message: "corrupt text layer on this page",
          metric_ref: ref,
        },
      ],
    };
  }

  test("one flagged metric carrying two flags: denominator is 1 (metrics), not 2 (flags)", () => {
    const { bar } = renderPanel(
      review({
        sections: [
          {
            domain_id: "financial_aid",
            title: "Financial Aid",
            status: null,
            counts: {},
            metrics: [twoFlagMetric("a")],
          },
        ],
        flags_summary: { unresolved: 0, total: 2 },
      }),
      controller({ flagQueueLength: 1 }),
    );

    const text = bar.textContent?.replace(/\s+/g, " ");
    // Before the fix this read "1 to review of 2" — `flags_summary.total`
    // (a flag count) standing in for a metric-count denominator, implying
    // one of two things was already handled when nothing was.
    expect(text).toContain("1 to review of 1");
    expect(text).not.toContain("of 2");
  });
});

describe("ReviewPanel — flag-queue position indicator", () => {
  test("nothing focused yet (flagQueueIndex -1): no position shown, just the remaining count", () => {
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
      controller({ flagQueueLength: 2, flagQueueIndex: -1 }),
    );

    expect(bar.textContent?.replace(/\s+/g, " ")).toContain("2 to review of 2");
    expect(screen.queryByText(/^\d+ of \d+$/)).not.toBeInTheDocument();
  });

  /** 12 presses of `n` on an 8-entry queue wrap silently — the remaining
   * count above never moves on a read-only document, so nothing in the bar
   * previously told an operator they'd lapped the queue. This pins that the
   * position is both an index (1-based for display) over the *queue*
   * length, not `flags_summary.total` — same unit `goToFlagBy` itself
   * walks, so the number can never claim a position the queue doesn't
   * have. */
  test("a flag is focused: shows its 1-based position over the flag-queue length", () => {
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
      controller({ flagQueueLength: 8, flagQueueIndex: 2 }),
    );

    expect(bar.textContent?.replace(/\s+/g, " ")).toContain("3 of 8");
  });
});
