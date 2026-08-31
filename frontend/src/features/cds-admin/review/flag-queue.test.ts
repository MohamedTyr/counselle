import type { ReviewFlagOut, ReviewMetric, ReviewSection } from "@/api/cds-admin/types";
import {
  buildFlagQueue,
  countFlaggedMetrics,
  countPendingEdits,
  countSectionUnresolved,
  hasUnresolvedFlag,
  hiddenUnresolvedCount,
  sectionRailSeverity,
  sectionsWithUnresolvedFlags,
  sortMetricsFlaggedFirst,
} from "@/features/cds-admin/review/flag-queue";

function flag(overrides: Partial<ReviewFlagOut> = {}): ReviewFlagOut {
  return {
    code: "C1",
    message: "admits (8,412) > applicants (7,932)",
    metric_ref: "admissions.applicants",
    severity: "error",
    ...overrides,
  };
}

function metric(overrides: Partial<ReviewMetric> = {}): ReviewMetric {
  return {
    availability_status: "reported",
    description: null,
    display: "100",
    evidence: { column_label: null, excerpt: null, page_number: 3, row_label: null, section: null },
    extraction_status: "verified",
    flags: [],
    pending_edit: null,
    raw_value: "100",
    ref: "domain.metric",
    source_hints: ["A1"],
    title: "Metric",
    type: "number",
    unit: null,
    value: 100,
    ...overrides,
  };
}

function section(overrides: Partial<ReviewSection> = {}): ReviewSection {
  return {
    counts: { verified: 1 },
    domain_id: "identity",
    metrics: [metric()],
    status: "verified",
    title: "General information",
    ...overrides,
  };
}

describe("hasUnresolvedFlag", () => {
  it("is false with no flags", () => {
    expect(hasUnresolvedFlag(metric())).toBe(false);
  });

  it("is true with a flag and no pending edit", () => {
    expect(hasUnresolvedFlag(metric({ flags: [flag()] }))).toBe(true);
  });

  it("is false once a pending edit covers the flag (§ addressed)", () => {
    const edited = metric({
      flags: [flag()],
      pending_edit: {
        availability_status: "reported",
        edited_at: "2026-08-01T00:00:00Z",
        edited_by: "admin",
        evidence: { column_label: null, excerpt: "text", page_number: 3, row_label: null, section: null },
        note: null,
        raw_value: "8,412",
        value: 8412,
      },
    });
    expect(hasUnresolvedFlag(edited)).toBe(false);
  });
});

describe("buildFlagQueue", () => {
  it("collects unresolved metrics across every section, in section order", () => {
    const sections = [
      section({ domain_id: "a", metrics: [metric({ ref: "a.1", flags: [flag()] })] }),
      section({ domain_id: "b", metrics: [metric({ ref: "b.1" }), metric({ ref: "b.2", flags: [flag()] })] }),
    ];
    const queue = buildFlagQueue(sections, false);
    expect(queue.map((m) => m.ref)).toEqual(["a.1", "b.2"]);
  });

  it("excludes flags whose metric has a pending edit", () => {
    const sections = [
      section({
        metrics: [
          metric({
            ref: "x",
            flags: [flag()],
            pending_edit: {
              availability_status: "reported",
              edited_at: "2026-08-01T00:00:00Z",
              edited_by: "admin",
              evidence: { column_label: null, excerpt: "e", page_number: 1, row_label: null, section: null },
              note: null,
              raw_value: "v",
              value: "v",
            },
          }),
        ],
      }),
    ];
    expect(buildFlagQueue(sections, false)).toHaveLength(0);
  });
});

describe("sortMetricsFlaggedFirst", () => {
  it("moves unresolved-flag metrics to the front, stable otherwise", () => {
    const metrics = [
      metric({ ref: "1" }),
      metric({ ref: "2", flags: [flag()] }),
      metric({ ref: "3" }),
      metric({ ref: "4", flags: [flag()] }),
    ];
    expect(sortMetricsFlaggedFirst(metrics, true).map((m) => m.ref)).toEqual([
      "2",
      "4",
      "1",
      "3",
    ]);
  });

  it("leaves order untouched when flaggedFirst is off", () => {
    const metrics = [metric({ ref: "1" }), metric({ ref: "2", flags: [flag()] })];
    expect(sortMetricsFlaggedFirst(metrics, false).map((m) => m.ref)).toEqual(["1", "2"]);
  });
});

describe("sectionsWithUnresolvedFlags", () => {
  it("returns only domains carrying an unresolved flag", () => {
    const sections = [
      section({ domain_id: "clean", metrics: [metric()] }),
      section({ domain_id: "flagged", metrics: [metric({ flags: [flag()] })] }),
    ];
    expect(sectionsWithUnresolvedFlags(sections)).toEqual(["flagged"]);
  });
});

describe("sectionRailSeverity", () => {
  it("prefers error over warning", () => {
    const withBoth = section({
      metrics: [
        metric({ ref: "1", flags: [flag({ severity: "warning" })] }),
        metric({ ref: "2", flags: [flag({ severity: "error" })] }),
      ],
    });
    expect(sectionRailSeverity(withBoth)).toBe("error");
  });

  it("is null when nothing is unresolved", () => {
    expect(sectionRailSeverity(section())).toBeNull();
  });
});

describe("countFlaggedMetrics", () => {
  it("counts a metric once even when it carries more than one flag", () => {
    const sections = [
      section({
        metrics: [
          metric({ ref: "1", flags: [flag(), flag({ code: "C2" })] }),
          metric({ ref: "2", flags: [flag()] }),
          metric({ ref: "3" }),
        ],
      }),
    ];
    // Two metrics carry flags (one of them carries two) — the review
    // screen's denominator is metrics, not the three raw flags this
    // document has (`ReviewPanel.tsx`'s "N to review of M").
    expect(countFlaggedMetrics(sections)).toBe(2);
  });

  it("still counts a flagged metric once its flag is addressed by a pending edit", () => {
    const sections = [
      section({
        metrics: [
          metric({
            ref: "1",
            flags: [flag()],
            pending_edit: {
              availability_status: "reported",
              edited_at: "2026-08-01T00:00:00Z",
              edited_by: "admin",
              evidence: { column_label: null, excerpt: "e", page_number: 1, row_label: null, section: null },
              note: null,
              raw_value: "v",
              value: "v",
            },
          }),
        ],
      }),
    ];
    expect(countFlaggedMetrics(sections)).toBe(1);
  });
});

describe("countSectionUnresolved / countPendingEdits / hiddenUnresolvedCount", () => {
  it("counts unresolved flags per section", () => {
    const withTwo = section({
      metrics: [metric({ ref: "1", flags: [flag()] }), metric({ ref: "2", flags: [flag()] })],
    });
    expect(countSectionUnresolved(withTwo)).toBe(2);
  });

  it("counts pending edits across sections", () => {
    const pendingEdit = {
      availability_status: "reported",
      edited_at: "2026-08-01T00:00:00Z",
      edited_by: "admin",
      evidence: { column_label: null, excerpt: "e", page_number: 1, row_label: null, section: null },
      note: null,
      raw_value: "v",
      value: "v",
    };
    const sections = [
      section({ metrics: [metric({ ref: "1", pending_edit: pendingEdit })] }),
      section({ metrics: [metric({ ref: "2" }), metric({ ref: "3", pending_edit: pendingEdit })] }),
    ];
    expect(countPendingEdits(sections)).toBe(2);
  });

  it("surfaces the gap between the server's unresolved count and what the queue can enumerate (orphan flags)", () => {
    const sections = [section({ metrics: [metric({ ref: "1", flags: [flag()] })] })];
    // The server's flags_summary says 3 unresolved, but this document's
    // sections only carry one metric-attached flag — two are document-level
    // (`metric_ref: null`) and structurally invisible to the frontend.
    expect(hiddenUnresolvedCount(sections, { total: 3, unresolved: 3 })).toBe(2);
    expect(hiddenUnresolvedCount(sections, { total: 1, unresolved: 1 })).toBe(0);
  });
});
