import type { ReviewMetric, ReviewSection } from "@/api/cds-admin/types";
import { sectionLetter } from "@/features/cds-admin/review/review-order";

function metric(sourceHints: string[]): ReviewMetric {
  return {
    availability_status: "reported",
    description: null,
    display: "1",
    evidence: null,
    extraction_status: "verified",
    flags: [],
    pending_edit: null,
    raw_value: "1",
    ref: "m",
    source_hints: sourceHints,
    title: "m",
    type: "number",
    unit: null,
    value: 1,
  };
}

function section(metrics: ReviewMetric[]): ReviewSection {
  return { counts: {}, domain_id: "d", metrics, status: null, title: "t" };
}

// Mirrors `app/cds/service_review.py::_natural_key`/`_domain_sort_key` — a
// domain's letter is the letter of its lowest source hint, natural-sorted
// (so "A2" < "A10"). This is what turns `enrollment` into "B." on screen.
describe("sectionLetter", () => {
  it("returns the letter of the lowest natural-sorted hint", () => {
    expect(sectionLetter(section([metric(["A2", "A10"]), metric(["A1"])]))).toBe("A");
  });

  it("picks the alphabetically earliest letter across metrics", () => {
    expect(sectionLetter(section([metric(["B2"]), metric(["A10"])]))).toBe("A");
  });

  it("returns null when no metric carries a source hint", () => {
    expect(sectionLetter(section([metric([])]))).toBeNull();
  });
});
