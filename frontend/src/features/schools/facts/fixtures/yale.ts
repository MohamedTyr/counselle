import type {
  DegreeShare,
  DerivedFact,
  LaneRow,
  RoundRow,
  SchoolFacts,
  Fact,
} from "@/features/schools/facts/school-facts-types";
import {
  absentTopics,
  caveatRegistry,
  index,
  indexDerived,
  page,
  reported,
} from "@/features/schools/facts/fixtures/shared";
import { gettingInFacts } from "@/features/schools/facts/fixtures/yale-getting-in";
import { moneyFacts } from "@/features/schools/facts/fixtures/yale-money";
import { academicsFacts } from "@/features/schools/facts/fixtures/yale-academics";
import { campusLifeFacts } from "@/features/schools/facts/fixtures/yale-campus-life";
import { outcomesFacts } from "@/features/schools/facts/fixtures/yale-outcomes";
import { applyingFacts } from "@/features/schools/facts/fixtures/yale-applying";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

/* One file per section, because the fact array is the bulk of the fixture
 * and "where is the money row" should not be a scroll. */
const yaleFacts = (): Fact[] => [
  ...gettingInFacts,
  ...moneyFacts,
  ...academicsFacts,
  ...campusLifeFacts,
  ...outcomesFacts,
  ...applyingFacts,
];

function yaleDerived(): DerivedFact[] {
  return [
    {
      key: "admit_rate",
      label: "Admit rate",
      state: reported("4.6%", 4.6),
      formula: "2,275 admitted ÷ 49,000 applicants",
      inputs: [
        {
          ref: "admissions.admitted_total",
          label: "admitted",
          evidence: page(3, "C1. Total admitted: 2,275", "C1"),
        },
        {
          ref: "admissions.applicants_total",
          label: "applicants",
          evidence: page(3, "C1. Total applicants: 49,000", "C1"),
        },
      ],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "early_decision_admit_rate",
      label: "Early round admit rate",
      state: { kind: "not_reported" },
      formula: "early admitted ÷ early applicants",
      inputs: [],
      /* Trap 4: ED counts combine ED I and ED II, and there are no EA counts
       * at all. Subtracting to get an "RD rate" at a school with an early
       * round is polluted by early admits and overstates it. */
      blockedBy:
        "The CDS does not publish early-action counts, so a round-by-round rate cannot be calculated here.",
      caveatRefs: [],
    },
    {
      key: "waitlist_conversion",
      label: "Waitlist conversion",
      state: reported("0%", 0),
      formula: "0 admitted ÷ 704 who accepted a place",
      inputs: [
        {
          ref: "admissions.waitlist_admitted_count",
          label: "admitted",
          evidence: page(3, "C2. Admitted from the waitlist: 0", "C2"),
        },
      ],
      blockedBy: null,
      caveatRefs: ["waitlist-volatile"],
    },
    {
      key: "sticker_cost",
      label: "Sticker cost of attendance",
      state: reported("$87,400"),
      formula:
        "$67,250 tuition + $1,850 fees + $11,700 housing + $8,400 food + $1,200 books",
      inputs: [
        {
          ref: "cost.tuition_out_of_state",
          label: "tuition",
          evidence: page(6, "G1. Tuition: $67,250", "G1"),
        },
      ],
      blockedBy: null,
      caveatRefs: ["cost-stale-direction"],
    },
    {
      key: "need_fully_met_share",
      label: "Students with need whose need was fully met",
      state: reported("100%", 100),
      formula: "912 fully met ÷ 912 determined to have need",
      inputs: [
        {
          ref: "financial_aid.h2_h_need_fully_met_count",
          label: "fully met",
          evidence: page(7, "H2. h: 912", "H2", "h"),
        },
        {
          ref: "financial_aid.h2_c_need_based_determined_count",
          label: "with need",
          evidence: page(7, "H2. c: 912", "H2", "c"),
        },
      ],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "classes_under_20",
      label: "Classes with fewer than 20 students",
      state: reported("70%", 70),
      formula: "1,101 sections under 20 ÷ 1,649 sections",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "classes_50_plus",
      label: "Classes of 50 or more",
      state: reported("6%", 6),
      formula: "105 sections of 50+ ÷ 1,649 sections",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "faculty_full_time_percent",
      label: "Faculty who are full time",
      state: reported("90%", 90),
      formula: "1,062 full-time ÷ 1,180 total",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "faculty_terminal_degree_percent",
      label: "Faculty holding a terminal degree",
      state: reported("97%", 97),
      formula: "1,145 with terminal degree ÷ 1,180 total",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "international_percent",
      label: "Undergraduates who are international",
      state: reported("12%", 12),
      formula: "792 nonresident ÷ 6,600 undergraduates",
      inputs: [],
      blockedBy: null,
      caveatRefs: ["not-additive"],
    },
    {
      key: "four_year_completion_rate",
      label: "Four-year graduation rate",
      state: reported("88%", 88),
      formula: "1,367 completed in four years ÷ 1,554 cohort",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
    {
      key: "four_to_six_year_gap",
      label: "Four-to-six-year gap",
      state: reported("9 points"),
      formula: "97% six-year − 88% four-year",
      inputs: [],
      blockedBy: null,
      caveatRefs: [],
    },
  ];
}

function yaleShares(): DegreeShare[] {
  return [
    {
      ref: "degrees.social_sciences",
      label: "Social sciences",
      state: reported("24%", 24),
      percent: 24,
    },
    {
      ref: "degrees.biological_sciences",
      label: "Biological sciences",
      state: reported("14%", 14),
      percent: 14,
    },
    {
      ref: "degrees.engineering",
      label: "Engineering",
      state: reported("9%", 9),
      percent: 9,
    },
    {
      ref: "degrees.computer_science",
      label: "Computer science",
      state: reported("8%", 8),
      percent: 8,
    },
    {
      ref: "degrees.history",
      label: "History",
      state: reported("7%", 7),
      percent: 7,
    },
    {
      ref: "degrees.mathematics",
      label: "Mathematics",
      state: reported("4%", 4),
      percent: 4,
    },
    {
      ref: "degrees.visual_performing_arts",
      label: "Visual and performing arts",
      state: reported("3%", 3),
      percent: 3,
    },
    /* A string percent, preserved exactly as printed. Parsing "<1%" to a
     * number would throw away the qualifier that makes it honest, so this
     * never backs a sort or a range filter. */
    {
      ref: "degrees.agriculture",
      label: "Agriculture",
      state: reported("<1%", "<1%"),
      percent: null,
    },
    /* A real zero, not an absence: nobody graduated in this last year. */
    {
      ref: "degrees.architecture",
      label: "Architecture",
      state: reported("0%", 0),
      percent: 0,
    },
    {
      ref: "degrees.education",
      label: "Education",
      state: { kind: "not_in_template_version" },
      percent: null,
    },
  ];
}

function yaleRounds(): RoundRow[] {
  return [
    {
      code: "REA",
      offered: "yes",
      restrictive: true,
      deadline: {
        id: "rea-deadline",
        label: "Restrictive early action deadline",
        official: {
          state: reported("November 1, 2026"),
          source: "yale.edu",
          sourceUrl: "https://admissions.yale.edu/deadlines",
          verifiedAt: "Aug 12, 2026",
        },
        /* The disagreement case: the CDS carries the prior cycle's date. */
        cds: {
          state: reported("November 15"),
          evidence: page(
            3,
            "C15. Early action closing date: November 15",
            "C15",
          ),
        },
        /* A genuine conflict — Nov 1 on the school's current page against a
         * Nov 15 figure in the form — not a formatting difference. */
        disagrees: true,
        caveatRefs: [],
      },
      notification: reported("Mid-December"),
    },
    {
      code: "ED",
      offered: "no",
      restrictive: false,
      deadline: {
        id: "ed-deadline",
        label: "Early decision deadline",
        official: null,
        cds: null,
        disagrees: false,
        caveatRefs: [],
      },
      notification: { kind: "not_applicable" },
    },
    {
      code: "EA",
      offered: "not_reported",
      restrictive: false,
      deadline: {
        id: "ea-deadline",
        label: "Early action deadline",
        official: null,
        cds: null,
        disagrees: false,
        caveatRefs: [],
      },
      notification: { kind: "not_reported" },
    },
    {
      code: "RD",
      offered: "yes",
      restrictive: false,
      deadline: {
        id: "rd-deadline",
        label: "Regular decision deadline",
        official: {
          state: reported("January 2, 2027"),
          source: "yale.edu",
          sourceUrl: "https://admissions.yale.edu/deadlines",
          verifiedAt: "Aug 12, 2026",
        },
        cds: {
          state: reported("January 2"),
          evidence: page(
            3,
            "C14. Regular admission closing date: January 2",
            "C14",
          ),
        },
        disagrees: false,
        caveatRefs: [],
      },
      notification: reported("April 1"),
    },
  ];
}

function yaleLanes(): LaneRow[] {
  return [
    {
      id: "fee",
      label: "Application fee",
      official: {
        state: reported("$80"),
        source: "yale.edu",
        sourceUrl: "https://admissions.yale.edu/fee",
        verifiedAt: "Aug 12, 2026",
      },
      cds: {
        state: reported("$80"),
        evidence: page(3, "C13. Application fee: $80", "C13"),
      },
      disagrees: false,
      caveatRefs: [],
    },
    {
      id: "fee-waiver",
      label: "Need-based fee waiver",
      official: {
        state: reported("Available"),
        source: "yale.edu",
        sourceUrl: "https://admissions.yale.edu/fee",
        verifiedAt: "Aug 12, 2026",
      },
      cds: {
        state: reported("Yes", true),
        evidence: page(3, "C13. Fee waiver available: Yes", "C13"),
      },
      disagrees: false,
      caveatRefs: [],
    },
    {
      id: "test-policy",
      label: "Testing policy",
      official: {
        state: reported("Test-flexible for 2026–27"),
        source: "yale.edu",
        sourceUrl: "https://admissions.yale.edu/testing",
        verifiedAt: "Aug 12, 2026",
      },
      cds: {
        state: reported("Considered but not required"),
        evidence: page(
          3,
          "C8. SAT/ACT policy: considered but not required",
          "C8",
        ),
      },
      disagrees: false,
      caveatRefs: [],
    },
    {
      id: "reply-deadline",
      label: "Reply deadline",
      official: {
        state: reported("May 1, 2027"),
        source: "yale.edu",
        sourceUrl: "https://admissions.yale.edu/deadlines",
        verifiedAt: "Aug 12, 2026",
      },
      cds: { state: { kind: "not_reported" }, evidence: null },
      disagrees: false,
      caveatRefs: [],
    },
  ];
}

export const yale: SchoolFacts = {
  identity: {
    unitid: 130794,
    name: "Yale University",
    city: "New Haven",
    state: "CT",
    control: "private",
    undergraduates: 6600,
    websiteUrl: "https://www.yale.edu",
    domain: "yale.edu",
  },
  edition: {
    academicYear: 2025,
    documentId: "cds-130794-2025",
    documentUrl:
      "https://oir.yale.edu/institutional-research/common-data-set.pdf",
    currentness: "current",
    stalenessReason: null,
    /* One partial domain, so the partial-extraction banner renders. */
    partialDomainCount: 1,
    configuredDomainCount: 13,
    currentDefinitionMatch: true,
  },
  coverage: {
    "getting-in": {
      verified: 24,
      configured: 28,
      notInTemplate: 4,
      packet: "accepted",
    },
    money: {
      verified: 41,
      configured: 67,
      notInTemplate: 0,
      packet: "accepted",
    },
    academics: {
      verified: 18,
      configured: 24,
      notInTemplate: 0,
      packet: "accepted",
    },
    "campus-life": {
      verified: 11,
      configured: 19,
      notInTemplate: 0,
      packet: "partial",
    },
    outcomes: {
      verified: 10,
      configured: 10,
      notInTemplate: 0,
      packet: "accepted",
    },
    applying: {
      verified: 9,
      configured: 12,
      notInTemplate: 0,
      packet: "accepted",
    },
  },
  facts: index(yaleFacts()),
  derived: indexDerived(yaleDerived()),
  caveats: caveatRegistry,
  absent: absentTopics(),
  rounds: yaleRounds(),
  applyingLanes: yaleLanes(),
  degreeShares: yaleShares(),
};
