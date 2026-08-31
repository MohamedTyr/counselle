import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import type { ReviewMetric } from "@/api/cds-admin/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createTestQueryClient } from "@/test/render-app";

import { MetricRow } from "./MetricRow";
import {
  ReviewControllerContext,
  type ReviewController,
} from "./review-context";

/** 0a95837: the "superseded by re-extraction" note is a session-local,
 * self-observed inference — `cds-review-page.tsx` populates `supersededRefs`
 * only from what it itself watched disappear right after *this session's
 * own* Re-run call. The wire carries no per-metric "superseded" flag, so a
 * metric with `pending_edit: null` on a fresh page load looks identical to
 * one that just lost an edit to a re-run. The note must never appear on a
 * fresh load — that would be inventing a fact the data can't support. */
function metric(overrides: Partial<ReviewMetric> = {}): ReviewMetric {
  return {
    ref: "financial_aid.pct_need_met",
    title: "Percent of need met",
    description: null,
    type: "number",
    unit: "%",
    source_hints: [],
    value: 42,
    raw_value: "42",
    display: "42%",
    availability_status: "reported",
    extraction_status: "verified",
    evidence: { page_number: 8, excerpt: "42% of need met.", section: null, row_label: null, column_label: null },
    flags: [],
    pending_edit: null,
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

function renderRow(metricRow: ReviewMetric, controllerValue: ReviewController) {
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
  return render(
    <Providers>
      <MetricRow documentId={1} domainId="financial_aid" metric={metricRow} readOnly={false} />
    </Providers>,
  );
}

describe("MetricRow — the superseded-by-re-run note", () => {
  test("never appears on a fresh load, even for a metric with no pending edit", () => {
    renderRow(metric({ pending_edit: null }), controller({ supersededRefs: new Set() }));

    expect(screen.queryByText(/Superseded by re-extraction/)).not.toBeInTheDocument();
  });

  test("appears once this session's own Re-run swept this exact metric's edit", () => {
    renderRow(
      metric({ ref: "financial_aid.pct_need_met", pending_edit: null }),
      controller({ supersededRefs: new Set(["financial_aid.pct_need_met"]) }),
    );

    expect(screen.getByText(/Superseded by re-extraction/)).toBeInTheDocument();
  });

  test("stays silent when the metric still carries a pending edit, even if its ref is in supersededRefs", () => {
    renderRow(
      metric({
        ref: "financial_aid.pct_need_met",
        pending_edit: {
          value: 45,
          raw_value: "45",
          availability_status: "reported",
          evidence: { page_number: 9, excerpt: "45%", section: null, row_label: null, column_label: null },
          note: null,
          edited_by: "admin@counselle.test",
          edited_at: "2026-08-31T00:00:00Z",
        },
      }),
      controller({ supersededRefs: new Set(["financial_aid.pct_need_met"]) }),
    );

    expect(screen.queryByText(/Superseded by re-extraction/)).not.toBeInTheDocument();
  });
});
