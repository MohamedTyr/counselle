import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";
import {
  absentTopics,
  caveatRegistry,
  f,
  index,
  indexDerived,
  page,
  reported,
} from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const northeastern: SchoolFacts = {
  identity: {
    unitid: 167358,
    name: "Northeastern University",
    city: "Boston",
    state: "MA",
    control: "private",
    undergraduates: 21500,
    websiteUrl: "https://www.northeastern.edu",
    domain: "northeastern.edu",
  },
  edition: {
    academicYear: 2024,
    documentId: "cds-167358-2024",
    documentUrl: null,
    currentness: "stale",
    stalenessReason: "older_edition",
    partialDomainCount: 0,
    configuredDomainCount: 13,
    /* Read under an older metric definition, so the definition banner
     * renders alongside the stale one. */
    currentDefinitionMatch: false,
  },
  coverage: {
    "getting-in": {
      verified: 19,
      configured: 28,
      notInTemplate: 2,
      packet: "accepted",
    },
    money: {
      verified: 33,
      configured: 67,
      notInTemplate: 1,
      packet: "accepted",
    },
    /* No packet at all for this section — the rail shows an em dash. */
    academics: {
      verified: 0,
      configured: 24,
      notInTemplate: 0,
      packet: "missing",
    },
    "campus-life": {
      verified: 8,
      configured: 19,
      notInTemplate: 0,
      packet: "accepted",
    },
    outcomes: {
      verified: 7,
      configured: 10,
      notInTemplate: 0,
      packet: "accepted",
    },
    applying: {
      verified: 6,
      configured: 12,
      notInTemplate: 0,
      packet: "accepted",
    },
  },
  facts: index([
    /* The admit rate refuses to compute because applicants is unreported. */
    f("admissions.applicants_total", "Total applicants", {
      kind: "not_reported",
    }),
    f("admissions.admitted_total", "Total admitted", reported("3,850"), {
      evidence: page(3, "C1. Total admitted: 3,850", "C1"),
    }),
    f(
      "class_profile.sat_composite_middle_50",
      "SAT composite, middle 50%",
      reported("1490–1540"),
      {
        caveats: ["sat-submitters"],
        evidence: page(4, "SAT Composite 25th 1490 · 75th 1540", "C9"),
      },
    ),
    f(
      "class_profile.average_high_school_gpa",
      "Average high school GPA",
      reported("4.24"),
      {
        caveats: ["gpa-submitted-low"],
        evidence: page(4, "C12. Average high school GPA: 4.24", "C12"),
      },
    ),
    /* One combined figure, every itemized row blank by design. */
    f(
      "cost.comprehensive_tuition_food_housing_amount",
      "Combined tuition, food and housing",
      reported("$89,900"),
      {
        caveats: ["combined-cost-only"],
        evidence: page(6, "G1. Comprehensive fee: $89,900", "G1"),
      },
    ),
    f(
      "cost.tuition_out_of_state",
      "Tuition",
      { kind: "not_reported" },
      {
        caveats: ["combined-cost-only"],
      },
    ),
    f(
      "cost.required_fees",
      "Required fees",
      { kind: "not_reported" },
      {
        caveats: ["combined-cost-only"],
      },
    ),
    f(
      "cost.housing_amount",
      "Housing",
      { kind: "not_reported" },
      {
        caveats: ["combined-cost-only"],
      },
    ),
    f(
      "cost.food_amount",
      "Food",
      { kind: "not_reported" },
      {
        caveats: ["combined-cost-only"],
      },
    ),
    f(
      "cost.books_and_supplies",
      "Books and supplies",
      { kind: "not_reported" },
      {
        caveats: ["combined-cost-only"],
      },
    ),
    f(
      "financial_aid.h2_i_average_percent_need_met",
      "Average percent of need met, as printed",
      reported("78%", 78),
      {
        caveats: ["need-met-recipients"],
        evidence: page(7, "H2. i. Average percent of need met: 78%", "H2", "i"),
      },
    ),
    f(
      "enrollment.undergraduate_total",
      "Undergraduate enrollment",
      reported("21,500"),
      { evidence: page(2, "B1. Total undergraduates: 21,500", "B1") },
    ),
    f(
      "outcomes.first_year_retention_reported_percent",
      "First-year retention",
      reported("97%", 97),
      { caveats: ["retention-copied"] },
    ),
  ]),
  derived: indexDerived([
    {
      key: "admit_rate",
      label: "Admit rate",
      state: { kind: "not_reported" },
      formula: "admitted ÷ applicants",
      inputs: [],
      blockedBy:
        "Applicants not reported, so the admit rate cannot be calculated.",
      caveatRefs: [],
    },
    {
      key: "sticker_cost",
      label: "Sticker cost of attendance",
      state: reported("$89,900"),
      formula: "one combined figure — the school does not itemize",
      inputs: [],
      blockedBy: null,
      caveatRefs: ["combined-cost-only"],
    },
    {
      key: "need_fully_met_share",
      label: "Students with need whose need was fully met",
      state: { kind: "not_reported" },
      formula: "fully met ÷ determined to have need",
      inputs: [],
      /* Short enough to sit in the strip's 12px foot without becoming four
       * lines; the pointer to the printed figure is a caveat on the row. */
      blockedBy:
        "The count whose need was fully met is not reported, so the honest share cannot be calculated.",
      caveatRefs: ["printed-need-met-below"],
    },
  ]),
  caveats: caveatRegistry,
  absent: absentTopics(),
  rounds: [
    {
      code: "ED",
      offered: "yes",
      restrictive: false,
      deadline: {
        id: "ne-ed",
        label: "Early decision deadline",
        official: {
          state: reported("November 1, 2026"),
          source: "northeastern.edu",
          sourceUrl: "https://admissions.northeastern.edu/deadlines",
          verifiedAt: "Aug 09, 2026",
        },
        cds: {
          state: reported("November 1"),
          evidence: page(
            3,
            "C15. Early decision closing date: November 1",
            "C15",
          ),
        },
        disagrees: false,
        caveatRefs: [],
      },
      notification: reported("Mid-December"),
    },
    {
      code: "RD",
      offered: "yes",
      restrictive: false,
      deadline: {
        id: "ne-rd",
        label: "Regular decision deadline",
        official: null,
        cds: {
          state: reported("January 1"),
          evidence: page(
            3,
            "C14. Regular admission closing date: January 1",
            "C14",
          ),
        },
        disagrees: false,
        caveatRefs: [],
      },
      notification: { kind: "not_reported" },
    },
  ],
  applyingLanes: [
    {
      id: "fee",
      label: "Application fee",
      official: null,
      cds: {
        state: reported("$75"),
        evidence: page(3, "C13. Application fee: $75", "C13"),
      },
      disagrees: false,
      caveatRefs: ["stale-edition"],
    },
  ],
  degreeShares: [],
};
