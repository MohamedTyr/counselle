import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { CoverageCounters as CoverageCountersData } from "@/api/cds-admin/types";

import { CoverageCounters } from "./CoverageCounters";

/** 0ca3d448: a search narrowed to one result used to render "1 schools ·
 * 0 editions" — hardcoded plural labels on the two real counted nouns in
 * the counters line. */
function counters(overrides: Partial<CoverageCountersData> = {}): CoverageCountersData {
  return {
    schools: 4,
    editions: 5,
    needs_review: 1,
    processing: 0,
    approved: 3,
    failed: 0,
    missing: 12,
    ...overrides,
  };
}

function renderCounters(data: CoverageCountersData) {
  return render(
    <CoverageCounters
      counters={data}
      failedActive={false}
      needsReviewActive={false}
      onToggleFailed={vi.fn()}
      onToggleNeedsReview={vi.fn()}
    />,
  );
}

describe("CoverageCounters — school/edition pluralization", () => {
  test("singular counts read '1 school · 0 editions', not '1 schools · 0 editions'", () => {
    renderCounters(counters({ schools: 1, editions: 0 }));

    expect(screen.getByText("school")).toBeInTheDocument();
    expect(screen.getByText("editions")).toBeInTheDocument();
    expect(screen.queryByText("schools")).not.toBeInTheDocument();
  });

  test("plural counts keep the 's'", () => {
    renderCounters(counters({ schools: 4, editions: 5 }));

    expect(screen.getByText("schools")).toBeInTheDocument();
    expect(screen.getByText("editions")).toBeInTheDocument();
  });
});
