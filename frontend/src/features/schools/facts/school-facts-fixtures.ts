import type {
  AbsentTopic,
  Caveat,
  DegreeShare,
  DerivedFact,
  Evidence,
  Fact,
  FactState,
  LaneRow,
  RoundRow,
  SchoolFacts,
} from "@/features/schools/facts/school-facts-types";
import { ABSENT_TOPIC_EXPLANATION } from "@/features/schools/facts/school-facts-format";

/*
 * ============================================================================
 * FIXTURES. EVERY NUMBER BELOW IS FABRICATED.
 *
 * This file exists so the About tab can be designed and reviewed before the
 * packet-v8 read exists. It must be replaced by a real query against the CDS
 * Library views before this tab is shown to a student — AGENTS.md principle 3
 * is not negotiable, and a plausible number is a more dangerous lie than an
 * obvious one. The qualified refs below are illustrative of the shape the
 * manifest produces; they are not an assertion that these exact metric ids
 * exist.
 * ============================================================================
 *
 * The set is deliberately WORSE than reality, because a clean fixture set
 * hides exactly the render paths that matter. Between the three schools it
 * covers: a partial packet, a section with no packet at all, a school on a
 * stale edition, a school with no readable CDS whatsoever, three
 * not_in_template_version values carrying page proof, a suppressed value, a
 * not_applicable value, an ACT band under 50% submitted (the severe caveat),
 * a "<1%" string percent, a legitimate 0, a school publishing one combined
 * cost figure with every itemized row blank, a school whose applicant count
 * is unreported so the admit rate refuses to compute, and a current-cycle
 * deadline that disagrees with the CDS figure.
 */

// ---------------------------------------------------------------- builders

const reported = (display: string, raw: unknown = display): FactState => ({
  kind: "reported",
  display,
  raw,
});

const page = (
  pageNumber: number,
  excerpt: string,
  section: string | null = null,
  row: string | null = null,
): Evidence => ({
  pageNumber,
  excerpt,
  section,
  row,
  column: null,
});

/** Absence proof: the excerpt shows the row does not exist in this edition. */
const proof = (
  pageNumber: number,
  excerpt: string,
  section: string | null,
): Evidence => ({
  pageNumber,
  excerpt,
  section,
  row: null,
  column: null,
  isAbsenceProof: true,
});

function f(
  ref: string,
  label: string,
  state: FactState,
  options: {
    caveats?: string[];
    evidence?: Evidence | null;
    contexts?: Fact["contexts"];
  } = {},
): Fact {
  return {
    ref,
    label,
    state,
    evidence: options.evidence ?? null,
    contexts: options.contexts ?? [],
    caveatRefs: options.caveats ?? [],
  };
}

function index(facts: Fact[]): Record<string, Fact> {
  return Object.fromEntries(facts.map((item) => [item.ref, item]));
}

function indexDerived(items: DerivedFact[]): Record<string, DerivedFact> {
  return Object.fromEntries(items.map((item) => [item.key, item]));
}

// ---------------------------------------------------------------- caveats

const SHARED_CAVEATS: Caveat[] = [
  {
    id: "sat-submitters",
    severity: "ordinary",
    text: "62% of the enrolled class submitted an SAT score.",
    short: "62% submitted",
  },
  {
    id: "act-submitters-low",
    severity: "severe",
    text: "Only 41% of the class submitted an ACT score — this band describes the top third, not the class.",
    short: "only 41% submitted",
  },
  {
    id: "gpa-submitted-low",
    severity: "severe",
    text: "Only 44% of the class reported a GPA.",
    short: "only 44% reported",
  },
  {
    id: "rank-submitted-low",
    severity: "severe",
    text: "Only 31% of the class had a rank to report — most US high schools no longer rank.",
  },
  {
    id: "suppressed",
    severity: "severe",
    text: "The school withheld this value. We do not infer it.",
  },
  {
    id: "stale-edition",
    severity: "severe",
    text: "These figures come from the 2023–24 CDS, not the current one.",
  },
  {
    id: "need-met-recipients",
    severity: "ordinary",
    text: "of aid recipients, not all students — excludes PLUS and private loans",
  },
  {
    id: "ratio-basis",
    severity: "ordinary",
    text: "The school defines the population behind this ratio; it is not comparable cell-for-cell across schools.",
  },
  {
    id: "not-additive",
    severity: "ordinary",
    text: "Out-of-state and international are counted separately; these two figures do not add up to a share of non-local students.",
  },
  {
    id: "rank-nested",
    severity: "ordinary",
    text: "Bands overlap — the top tenth is inside the top quarter. They cannot be added or subtracted.",
  },
  {
    id: "waitlist-volatile",
    severity: "ordinary",
    text: "Waitlist numbers swing widely year to year. Read them as context, not as odds.",
  },
  {
    id: "retention-copied",
    severity: "ordinary",
    text: "Copied as the school printed it. Recomputing it would disagree with their own figure, because the rate carries form-defined exclusions.",
  },
  {
    id: "pell-not-prediction",
    severity: "ordinary",
    text: "Pell status is a socioeconomic fact, not a prediction about you. This is the school's published figure for low-income completion.",
  },
  {
    id: "cost-stale-direction",
    severity: "ordinary",
    text: "Published before the cycle's final costs were set, so it is a floor rather than an estimate.",
  },
  {
    id: "printed-need-met-below",
    severity: "ordinary",
    text: "The school's own printed “average percent of need met” is in Need-based aid below, with the caveat that makes it readable.",
  },
  {
    id: "combined-cost-only",
    severity: "ordinary",
    text: "This school publishes one combined figure rather than an itemized breakdown, so the itemized rows are blank by design.",
  },
];

const caveatRegistry: Record<string, Caveat> = Object.fromEntries(
  SHARED_CAVEATS.map((caveat) => [caveat.id, caveat]),
);

// ---------------------------------------------------------------- absences

function absentTopics(): AbsentTopic[] {
  const standard = ABSENT_TOPIC_EXPLANATION;
  return [
    {
      id: "need-blind",
      section: "getting-in",
      topic: "Need-blind or need-aware",
      explanation: standard,
    },
    {
      id: "admit-by-major",
      section: "getting-in",
      topic: "Admit rate by major or college",
      explanation: standard,
    },
    {
      id: "ea-counts",
      section: "getting-in",
      topic: "Early-action applicant and admit counts",
      explanation:
        "The Common Data Set publishes early-decision counts but no early-action counts at all, which is why no round-by-round rate can be calculated for an EA school.",
    },
    {
      id: "legacy-athlete",
      section: "getting-in",
      topic: "Legacy and athlete admit rates",
      explanation: standard,
    },
    {
      id: "superscoring",
      section: "getting-in",
      topic: "Superscoring policy",
      explanation: standard,
    },
    {
      id: "net-price-bands",
      section: "money",
      topic: "Net price by income band",
      explanation:
        "There is no income dimension anywhere in the cost or aid domains. Use the school's net price calculator, linked above, for a figure specific to your family.",
    },
    {
      id: "meets-full-need",
      section: "money",
      topic: "The meets-full-need pledge",
      explanation:
        "Only the realized outcome is published — how much need was met last year — never the promise itself.",
    },
    {
      id: "salary-outcomes",
      section: "outcomes",
      topic: "Salary, employment, and graduate-school placement",
      explanation:
        "College Scorecard publishes these; the Common Data Set does not.",
    },
    {
      id: "program-catalogue",
      section: "academics",
      topic: "The program and major catalogue",
      explanation:
        "The CDS reports what students graduated in, not what the school offers. “Do they have linguistics” is not answerable from this data.",
    },
    {
      id: "campus-setting",
      section: "campus-life",
      topic: "Campus setting and urbanicity",
      explanation:
        "A first-order fit filter with no Common Data Set field behind it.",
    },
    {
      id: "religious-affiliation",
      section: "campus-life",
      topic: "The school's own religious affiliation",
      explanation:
        "The selection-factor row says whether faith commitment is weighed in admission; nothing states the school's own affiliation. The two are easy to confuse.",
    },
    {
      id: "application-platform",
      section: "applying",
      topic: "Application platform (Common App / Coalition)",
      explanation: standard,
    },
    {
      id: "interview-format",
      section: "applying",
      topic: "Interview availability and format",
      explanation: standard,
    },
  ];
}

// ---------------------------------------------------------------- Yale

function yaleFacts(): Fact[] {
  return [
    f(
      "admissions.open_admission_all_students",
      "Open admission to all students",
      reported("No", false),
      { evidence: page(3, "C1. Open admission policy: No", "C1") },
    ),
    f(
      "class_profile.sat_composite_middle_50",
      "SAT composite, middle 50%",
      reported("1500–1560"),
      {
        caveats: ["sat-submitters"],
        evidence: page(4, "SAT Composite 25th 1500 · 75th 1560", "C9"),
        contexts: [
          {
            id: "cohort",
            label: "Cohort",
            display: "entering class, Fall 2025",
          },
        ],
      },
    ),
    f(
      "class_profile.act_composite_middle_50",
      "ACT composite, middle 50%",
      reported("34–35"),
      {
        caveats: ["act-submitters-low"],
        evidence: page(4, "ACT Composite 25th 34 · 75th 35", "C9"),
      },
    ),
    f(
      "class_profile.average_high_school_gpa",
      "Average high school GPA",
      { kind: "not_reported" },
      { evidence: page(4, "C12. Average high school GPA: [blank]", "C12") },
    ),
    f(
      "class_profile.class_rank_top_tenth_percent",
      "Class rank, top tenth",
      { kind: "not_in_template_version" },
      {
        evidence: proof(
          4,
          "C10 percent in top tenth of graduating class — this row is absent from the 2024–25 template; the grid runs C9 straight to C11.",
          "C10",
        ),
      },
    ),
    f(
      "class_profile.class_rank_top_quarter_percent",
      "Class rank, top quarter",
      { kind: "not_in_template_version" },
      {
        evidence: proof(
          4,
          "C10 percent in top quarter — absent from this template edition.",
          "C10",
        ),
      },
    ),
    f(
      "class_profile.class_rank_top_half_percent",
      "Class rank, top half",
      { kind: "not_in_template_version" },
      {
        evidence: proof(
          4,
          "C10 percent in top half — absent from this template edition.",
          "C10",
        ),
      },
    ),
    f(
      "class_profile.class_rank_submitted_percent",
      "Percent who submitted a class rank",
      { kind: "not_applicable" },
      {
        evidence: page(
          4,
          "C10. Not applicable — the school reports it does not collect class rank.",
          "C10",
        ),
      },
    ),
    f(
      "class_profile.sat_ebrw_p25",
      "SAT reading and writing, 25th",
      reported("740"),
      {
        caveats: ["sat-submitters"],
        evidence: page(4, "SAT EBRW 25th percentile 740", "C9"),
      },
    ),
    f(
      "class_profile.sat_ebrw_p50",
      "SAT reading and writing, 50th",
      reported("770"),
      {
        caveats: ["sat-submitters"],
        evidence: page(4, "SAT EBRW 50th percentile 770", "C9"),
      },
    ),
    f(
      "class_profile.sat_ebrw_p75",
      "SAT reading and writing, 75th",
      reported("780"),
      {
        caveats: ["sat-submitters"],
        evidence: page(4, "SAT EBRW 75th percentile 780", "C9"),
      },
    ),
    f("class_profile.sat_math_p25", "SAT math, 25th", reported("760"), {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT Math 25th percentile 760", "C9"),
    }),
    f("class_profile.sat_math_p50", "SAT math, 50th", reported("780"), {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT Math 50th percentile 780", "C9"),
    }),
    f("class_profile.sat_math_p75", "SAT math, 75th", reported("790"), {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT Math 75th percentile 790", "C9"),
    }),
    f(
      "class_profile.sat_submitters_percent",
      "Percent submitting SAT scores",
      reported("62%", 62),
      { evidence: page(4, "Percent submitting SAT scores 62%", "C9") },
    ),
    f(
      "class_profile.act_submitters_percent",
      "Percent submitting ACT scores",
      reported("41%", 41),
      {
        caveats: ["act-submitters-low"],
        evidence: page(4, "Percent submitting ACT scores 41%", "C9"),
      },
    ),
    f(
      "admissions.program_specific_factor_differences",
      "Do factors differ by program?",
      reported(
        "Yes — engineering and the arts weigh portfolio and prepared work more heavily than the general table shows.",
      ),
      { evidence: page(3, "C7. Relative importance — program note", "C7") },
    ),
    ...[
      [
        "rigor_of_secondary_school_record",
        "Rigor of secondary school record",
        "Very important",
      ],
      ["academic_gpa", "Academic GPA", "Very important"],
      ["standardized_test_scores", "Standardized test scores", "Considered"],
      ["application_essay", "Application essay", "Very important"],
      ["recommendations", "Recommendations", "Very important"],
      ["extracurricular_activities", "Extracurricular activities", "Important"],
      [
        "character_personal_qualities",
        "Character and personal qualities",
        "Very important",
      ],
      ["first_generation", "First generation", "Considered"],
      ["alumni_relation", "Alumni relation", "Considered"],
      [
        "level_of_applicant_interest",
        "Level of applicant interest",
        "Not considered",
      ],
      [
        "religious_affiliation_commitment",
        "Religious affiliation or commitment",
        "Not considered",
      ],
    ].map(([id, label, value]) =>
      f(`admissions.selection_factor_${id}`, label, reported(value), {
        evidence: page(3, `C7. ${label}: ${value}`, "C7"),
      }),
    ),
    f(
      "admissions.total_academic_units_required",
      "Total academic units required",
      reported("20"),
      {
        evidence: page(3, "C5. Total academic units required: 20", "C5"),
      },
    ),
    f(
      "admissions.total_academic_units_recommended",
      "Total academic units recommended",
      reported("24"),
      { evidence: page(3, "C5. Total academic units recommended: 24", "C5") },
    ),
    f(
      "admissions.english_units_required",
      "English units required",
      reported("4"),
      {
        evidence: page(3, "C5. English: 4 required", "C5"),
      },
    ),
    f(
      "admissions.mathematics_units_required",
      "Mathematics units required",
      reported("4"),
      {
        evidence: page(3, "C5. Mathematics: 4 required", "C5"),
      },
    ),
    f(
      "admissions.science_units_required",
      "Science units required",
      reported("3"),
      {
        evidence: page(3, "C5. Science: 3 required", "C5"),
      },
    ),
    f(
      "admissions.foreign_language_units_required",
      "Foreign language units required",
      reported("3"),
      { evidence: page(3, "C5. Foreign language: 3 required", "C5") },
    ),
    f(
      "admissions.social_studies_units_required",
      "Social studies units required",
      reported("3"),
      { evidence: page(3, "C5. Social studies: 3 required", "C5") },
    ),
    f(
      "admissions.has_waitlist_policy",
      "Does the school use a waitlist?",
      reported("Yes", true),
      {
        evidence: page(3, "C2. Waitlist policy: Yes", "C2"),
      },
    ),
    f(
      "admissions.waitlist_offered_count",
      "Students offered a waitlist place",
      reported("1,020"),
      {
        caveats: ["waitlist-volatile"],
        evidence: page(3, "C2. Offered a place on the waitlist: 1,020", "C2"),
      },
    ),
    f(
      "admissions.waitlist_accepted_count",
      "Students who accepted a place",
      reported("704"),
      {
        caveats: ["waitlist-volatile"],
        evidence: page(3, "C2. Accepting a place on the waitlist: 704", "C2"),
      },
    ),
    /* A legitimate zero. It renders as 0, in the value ink, at full weight —
     * it is a fact, and last year nobody came off this waitlist. */
    f(
      "admissions.waitlist_admitted_count",
      "Students admitted from the waitlist",
      reported("0", 0),
      {
        caveats: ["waitlist-volatile"],
        evidence: page(3, "C2. Admitted from the waitlist: 0", "C2"),
      },
    ),
    f("admissions.applicants_total", "Total applicants", reported("49,000"), {
      evidence: page(
        3,
        "C1. Total first-time, first-year applicants: 49,000",
        "C1",
      ),
    }),
    f("admissions.admitted_total", "Total admitted", reported("2,275"), {
      evidence: page(3, "C1. Total admitted: 2,275", "C1"),
    }),
    f("admissions.enrolled_total", "Total enrolled", reported("1,647"), {
      evidence: page(3, "C1. Total enrolled: 1,647", "C1"),
    }),
    f(
      "admissions.applicants_in_state",
      "In-state applicants",
      { kind: "not_applicable" },
      {
        evidence: page(
          3,
          "C1. Residency split — not applicable for a private institution.",
          "C1",
        ),
      },
    ),
    f(
      "admissions.admitted_in_state",
      "In-state admitted",
      { kind: "not_applicable" },
      {
        evidence: page(
          3,
          "C1. Residency split — not applicable for a private institution.",
          "C1",
        ),
      },
    ),

    // ---- Money
    f(
      "cost.tuition_in_state",
      "Tuition, in state",
      { kind: "not_applicable" },
      {
        evidence: page(6, "G1. Private institution — one tuition rate.", "G1"),
      },
    ),
    f("cost.tuition_out_of_state", "Tuition", reported("$67,250"), {
      caveats: ["cost-stale-direction"],
      evidence: page(6, "G1. Tuition: $67,250", "G1"),
      contexts: [{ id: "year", label: "Year", display: "2024–25" }],
    }),
    f("cost.required_fees", "Required fees", reported("$1,850"), {
      evidence: page(6, "G1. Required fees: $1,850", "G1"),
    }),
    f("cost.housing_amount", "Housing", reported("$11,700"), {
      evidence: page(6, "G1. Housing: $11,700", "G1"),
    }),
    f("cost.food_amount", "Food", reported("$8,400"), {
      evidence: page(6, "G1. Food: $8,400", "G1"),
    }),
    f("cost.books_and_supplies", "Books and supplies", reported("$1,200"), {
      evidence: page(6, "G1. Books and supplies: $1,200", "G1"),
    }),
    f(
      "cost.comprehensive_tuition_food_housing_amount",
      "Combined tuition, food and housing",
      { kind: "not_reported" },
      {
        evidence: page(
          6,
          "G1. Comprehensive fee: [blank] — itemized above.",
          "G1",
        ),
      },
    ),
    f("cost.living_at_home_amount", "Living at home", { kind: "not_reported" }),
    f(
      "cost.off_campus_housing_amount",
      "Off-campus housing",
      reported("$13,400"),
      {
        evidence: page(6, "G1. Off-campus housing: $13,400", "G1"),
      },
    ),
    f(
      "cost.tuition_guarantee_offered",
      "Is tuition guaranteed for four years?",
      reported("No", false),
      {
        evidence: page(6, "G2. Tuition guarantee: No", "G2"),
      },
    ),
    f("cost.per_credit_hour_charge", "Per-credit-hour charge", {
      kind: "not_applicable",
    }),
    f(
      "cost.final_costs_not_available",
      "Are these final costs?",
      reported("No — provisional", false),
      {
        caveats: ["cost-stale-direction"],
        evidence: page(
          6,
          "G0. Final costs not yet available at publication.",
          "G0",
        ),
      },
    ),
    f(
      "cost.final_costs_expected_date",
      "Final costs expected",
      reported("March 2026"),
      {
        evidence: page(6, "G0. Final costs expected March 2026.", "G0"),
      },
    ),
    f(
      "financial_aid.h2_c_need_based_determined_count",
      "Students determined to have financial need",
      reported("912"),
      {
        evidence: page(
          7,
          "H2. c. Number determined to have need: 912",
          "H2",
          "c",
        ),
      },
    ),
    f(
      "financial_aid.h2_h_need_fully_met_count",
      "Students whose need was fully met",
      reported("912"),
      {
        evidence: page(
          7,
          "H2. h. Number whose need was fully met: 912",
          "H2",
          "h",
        ),
      },
    ),
    f(
      "financial_aid.h2_i_average_percent_need_met",
      "Average percent of need met, as printed",
      reported("100%", 100),
      {
        caveats: ["need-met-recipients"],
        evidence: page(
          7,
          "H2. i. Average percent of need met: 100%",
          "H2",
          "i",
        ),
      },
    ),
    f(
      "financial_aid.h2_j_average_need_based_award",
      "Average need-based award",
      reported("$68,200"),
      {
        evidence: page(
          7,
          "H2. j. Average need-based award: $68,200",
          "H2",
          "j",
        ),
      },
    ),
    f(
      "financial_aid.h2_e_need_based_grant_recipients_percent",
      "Percent awarded a need-based grant",
      reported("53%", 53),
      {
        evidence: page(7, "H2. e. Awarded a need-based grant: 53%", "H2", "e"),
      },
    ),
    f(
      "financial_aid.h2_k_average_need_based_grant",
      "Average need-based grant",
      reported("$66,900"),
      {
        evidence: page(
          7,
          "H2. k. Average need-based grant: $66,900",
          "H2",
          "k",
        ),
      },
    ),
    f(
      "financial_aid.h2_m_average_need_based_loan",
      "Average need-based loan",
      reported("$4,100"),
      {
        evidence: page(7, "H2. m. Average need-based loan: $4,100", "H2", "m"),
      },
    ),
    f(
      "financial_aid.h5_borrowers_any_program_average_principal",
      "Average debt at graduation",
      reported("$14,700"),
      { evidence: page(8, "H5. Average principal borrowed: $14,700", "H5") },
    ),
    f(
      "financial_aid.h2a_n_non_need_award_recipients",
      "Students receiving merit aid without need",
      reported("0", 0),
      { evidence: page(7, "H2A. n. Non-need awards: 0", "H2A", "n") },
    ),
    f("financial_aid.h2a_q_average_non_need_award", "Average merit award", {
      kind: "not_applicable",
    }),
    f(
      "financial_aid.h14_athletic_scholarship_total",
      "Athletic scholarship total",
      { kind: "not_applicable" },
    ),
    f(
      "financial_aid.h6_nonresident_aid_available",
      "Aid available to nonresident students",
      reported("Yes", true),
      {
        evidence: page(8, "H6. Aid available to nonresident aliens: Yes", "H6"),
      },
    ),
    f(
      "financial_aid.h6_nonresident_aid_recipients",
      "Nonresident students receiving aid",
      reported("174"),
      {
        evidence: page(8, "H6. Number receiving aid: 174", "H6"),
      },
    ),
    f(
      "financial_aid.h6_nonresident_average_award",
      "Average nonresident award",
      { kind: "suppressed" },
      {
        caveats: ["suppressed"],
        evidence: page(
          8,
          "H6. Average award: withheld at the institution's request.",
          "H6",
        ),
      },
    ),
    f(
      "financial_aid.need_analysis_methodology",
      "Need analysis methodology",
      reported("Institutional — home equity and business assets are counted"),
      {
        evidence: page(7, "H1. Need analysis: Institutional methodology", "H1"),
      },
    ),
    f(
      "financial_aid.aid_reporting_status",
      "Aid figures are",
      reported("Final"),
      {
        evidence: page(7, "H0. Aid reporting status: final", "H0"),
      },
    ),
    f(
      "financial_aid.h8_css_profile_required",
      "CSS Profile required",
      reported("Yes", true),
      {
        evidence: page(8, "H8. CSS Profile required: Yes", "H8"),
      },
    ),
    f(
      "financial_aid.h8_fafsa_deadline",
      "FAFSA deadline",
      reported("March 1"),
      {
        evidence: page(8, "H8. FAFSA deadline: March 1", "H8"),
      },
    ),
    f(
      "financial_aid.net_price_calculator_url",
      "Net price calculator",
      reported("finaid.yale.edu/calculator"),
      { evidence: page(8, "H9. Net price calculator URL", "H9") },
    ),

    // ---- Academics
    f(
      "faculty.students_per_faculty",
      "Students per faculty member",
      reported("6 to 1"),
      {
        caveats: ["ratio-basis"],
        evidence: page(9, "I2. Student-to-faculty ratio: 6 to 1", "I2"),
      },
    ),
    f(
      "faculty.total_instructional_faculty",
      "Total instructional faculty",
      reported("1,180"),
      {
        evidence: page(9, "I1. Total instructional faculty: 1,180", "I1"),
      },
    ),
    f("faculty.full_time_faculty", "Full-time faculty", reported("1,062"), {
      evidence: page(9, "I1. Full-time: 1,062", "I1"),
    }),
    f(
      "faculty.faculty_with_terminal_degree",
      "Faculty with a terminal degree",
      reported("1,145"),
      {
        evidence: page(9, "I1. With terminal degree: 1,145", "I1"),
      },
    ),
    f(
      "faculty.ratio_basis_note",
      "How the ratio is counted",
      reported(
        "Full-time equivalent, excluding faculty teaching only graduate students",
      ),
      { evidence: page(9, "I2. Ratio basis note", "I2") },
    ),
    f(
      "academics.special_study_honors_program",
      "Honors program",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: honors program — Yes", "I"),
      },
    ),
    f(
      "academics.special_study_undergraduate_research",
      "Undergraduate research",
      reported("Yes", true),
      {
        evidence: page(
          9,
          "I. Special study: undergraduate research — Yes",
          "I",
        ),
      },
    ),
    f(
      "academics.special_study_study_abroad",
      "Study abroad",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: study abroad — Yes", "I"),
      },
    ),
    f(
      "academics.special_study_double_major",
      "Double major",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: double major — Yes", "I"),
      },
    ),
    f(
      "academics.special_study_independent_study",
      "Independent study",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: independent study — Yes", "I"),
      },
    ),
    f(
      "academics.special_study_internships",
      "Internships",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: internships — Yes", "I"),
      },
    ),
    f(
      "academics.special_study_teacher_certification",
      "Teacher certification",
      reported("No", false),
      {
        evidence: page(9, "I. Special study: teacher certification — No", "I"),
      },
    ),
    f(
      "academics.special_study_combined_degree",
      "Combined bachelor's/graduate degree",
      reported("Yes", true),
      {
        evidence: page(9, "I. Special study: combined degree — Yes", "I"),
      },
    ),
    f(
      "academics.required_coursework_english",
      "English required",
      reported("Yes", true),
    ),
    f(
      "academics.required_coursework_mathematics",
      "Mathematics required",
      reported("No", false),
    ),
    f(
      "academics.required_coursework_sciences",
      "Sciences required",
      reported("Yes", true),
    ),
    f(
      "academics.required_coursework_foreign_languages",
      "Foreign languages required",
      reported("Yes", true),
    ),
    f(
      "academics.required_coursework_philosophy_religion",
      "Philosophy or religion required",
      reported("No", false),
    ),
    f(
      "academics.academic_calendar",
      "Academic calendar",
      reported("Semester"),
      {
        evidence: page(2, "A. Academic year calendar: semester", "A"),
      },
    ),
    ...[
      ["section_2_9", "Classes of 2–9 students", "412"],
      ["section_10_19", "Classes of 10–19", "689"],
      ["section_20_29", "Classes of 20–29", "281"],
      ["section_30_39", "Classes of 30–39", "104"],
      ["section_40_49", "Classes of 40–49", "58"],
      ["section_50_99", "Classes of 50–99", "71"],
      ["section_100_plus", "Classes of 100 or more", "34"],
      ["subsection_2_9", "Subsections of 2–9", "96"],
      ["subsection_10_19", "Subsections of 10–19", "318"],
      ["subsection_20_29", "Subsections of 20–29", "77"],
    ].map(([id, label, value]) =>
      f(`class_size.${id}`, label, reported(value), {
        evidence: page(10, `I3. ${label}: ${value}`, "I3"),
      }),
    ),

    // ---- Campus life (partial packet: several rows did not come through)
    f(
      "enrollment.undergraduate_total",
      "Undergraduate enrollment",
      reported("6,600"),
      {
        evidence: page(2, "B1. Total undergraduates: 6,600", "B1"),
      },
    ),
    f("enrollment.graduate_total", "Graduate enrollment", reported("8,150"), {
      evidence: page(2, "B1. Total graduate: 8,150", "B1"),
    }),
    f(
      "student_life.college_owned_housing_percent_undergraduates",
      "Undergraduates in college housing",
      reported("84%", 84),
      { evidence: page(11, "F1. In college-owned housing: 84%", "F1") },
    ),
    f(
      "enrollment.out_of_state_percent_undergraduates",
      "Undergraduates from out of state",
      reported("92%", 92),
      {
        caveats: ["not-additive"],
        evidence: page(
          2,
          "B2. Out-of-state (excluding international): 92%",
          "B2",
        ),
      },
    ),
    f(
      "enrollment.nonresident_all_undergraduates",
      "International undergraduates",
      reported("792"),
      {
        evidence: page(2, "B1. Nonresident undergraduates: 792", "B1"),
      },
    ),
    f(
      "student_life.fraternities_offered",
      "Fraternities",
      reported("Yes", true),
    ),
    f(
      "student_life.fraternity_percent_men",
      "Men in fraternities",
      reported("11%", 11),
    ),
    f("student_life.sororities_offered", "Sororities", reported("Yes", true)),
    f(
      "student_life.sorority_percent_women",
      "Women in sororities",
      reported("13%", 13),
    ),
    f(
      "enrollment.undergraduates_age_25_and_over_percent",
      "Undergraduates aged 25+",
      { kind: "no_verified_value" },
    ),
    f("enrollment.average_undergraduate_age", "Average undergraduate age", {
      kind: "no_verified_value",
    }),
    f("identity.gender_model", "Gender model", reported("Coeducational")),
    f(
      "identity.institutional_control",
      "Control",
      reported("Private, non-profit"),
    ),
    f(
      "student_life.army_rotc_offered",
      "Army ROTC",
      reported("Cross-enrollment", "cross"),
    ),
    f(
      "student_life.army_rotc_cooperating_institution",
      "Army ROTC cooperating institution",
      reported("University of Connecticut"),
    ),
    f(
      "student_life.navy_rotc_offered",
      "Navy ROTC",
      reported("On campus", "on_campus"),
    ),
    f("student_life.air_force_rotc_offered", "Air Force ROTC", {
      kind: "not_reported",
    }),

    // ---- Outcomes
    f(
      "outcomes.first_year_retention_reported_percent",
      "First-year retention",
      reported("99%", 99),
      {
        caveats: ["retention-copied"],
        evidence: page(12, "B22. First-year retention rate: 99%", "B22"),
      },
    ),
    f(
      "outcomes.primary_all_students_six_year_graduation_rate_ratio",
      "Six-year graduation rate",
      reported("97%", 97),
      { evidence: page(12, "B11. Six-year graduation rate: 97%", "B11") },
    ),
    f(
      "outcomes.primary_pell_grant_six_year_graduation_rate_ratio",
      "Six-year graduation rate, Pell recipients",
      reported("95%", 95),
      {
        caveats: ["pell-not-prediction"],
        evidence: page(12, "B11. Pell six-year rate: 95%", "B11"),
      },
    ),
    f("outcomes.primary_cohort_count", "Entering cohort", reported("1,554"), {
      evidence: page(12, "B4. Adjusted cohort: 1,554", "B4"),
    }),
    f(
      "outcomes.completers_within_four_years",
      "Completed within four years",
      reported("1,367"),
      {
        evidence: page(12, "B7. Completers within four years: 1,367", "B7"),
      },
    ),
    f(
      "outcomes.completers_within_five_years",
      "Completed within five years",
      reported("1,478"),
      {
        evidence: page(12, "B8. Completers within five years: 1,478", "B8"),
      },
    ),
    f(
      "outcomes.completers_within_six_years",
      "Completed within six years",
      reported("1,507"),
      {
        evidence: page(12, "B9. Completers within six years: 1,507", "B9"),
      },
    ),

    // ---- Applying
    f(
      "admissions.notification_mode",
      "Notification mode",
      reported("Fixed date"),
      {
        evidence: page(3, "C16. Notification: by a fixed date", "C16"),
      },
    ),
    f("admissions.rolling_notification_begins", "Rolling notification begins", {
      kind: "not_applicable",
    }),
    f(
      "admissions.regular_notification_date",
      "Regular decision notification",
      reported("April 1"),
      {
        evidence: page(3, "C16. Regular decision notification: April 1", "C16"),
      },
    ),
    f(
      "admissions.spring_admission_offered",
      "Spring admission",
      reported("No", false),
    ),
    f(
      "admissions.deferred_enrollment_offered",
      "Deferred enrolment",
      reported("Yes", true),
    ),
    f(
      "admissions.deferred_enrollment_maximum_period",
      "Maximum deferral",
      reported("One year"),
    ),
    f("admissions.housing_deposit_amount", "Housing deposit", {
      kind: "not_reported",
    }),
    f("admissions.housing_deposit_deadline", "Housing deposit deadline", {
      kind: "not_reported",
    }),
    f("admissions.housing_deposit_refundable", "Housing deposit refundable", {
      kind: "not_reported",
    }),
  ];
}

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

const yale: SchoolFacts = {
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

// ------------------------------------------------- Northeastern: stale edition

const northeastern: SchoolFacts = {
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

// ------------------------------------------- City College: no readable CDS

const cityCollege: SchoolFacts = {
  identity: {
    unitid: 190567,
    name: "The City College of New York",
    city: "New York",
    state: "NY",
    control: "public",
    undergraduates: 13100,
    websiteUrl: "https://www.ccny.cuny.edu",
    domain: "ccny.cuny.edu",
  },
  edition: null,
  coverage: {
    "getting-in": {
      verified: 0,
      configured: 28,
      notInTemplate: 0,
      packet: "missing",
    },
    money: { verified: 0, configured: 67, notInTemplate: 0, packet: "missing" },
    academics: {
      verified: 0,
      configured: 24,
      notInTemplate: 0,
      packet: "missing",
    },
    "campus-life": {
      verified: 0,
      configured: 19,
      notInTemplate: 0,
      packet: "missing",
    },
    outcomes: {
      verified: 0,
      configured: 10,
      notInTemplate: 0,
      packet: "missing",
    },
    /* Our own requirements data is independent of the CDS, so Applying is
     * still populated even with no readable document at all. */
    applying: {
      verified: 4,
      configured: 12,
      notInTemplate: 0,
      packet: "accepted",
    },
  },
  facts: {},
  derived: {},
  caveats: caveatRegistry,
  absent: absentTopics(),
  rounds: [
    {
      code: "RD",
      offered: "yes",
      restrictive: false,
      deadline: {
        id: "ccny-rd",
        label: "Regular decision deadline",
        official: {
          state: reported("February 1, 2027"),
          source: "cuny.edu",
          sourceUrl: "https://www.cuny.edu/admissions/deadlines",
          verifiedAt: "Aug 14, 2026",
        },
        cds: null,
        disagrees: false,
        caveatRefs: [],
      },
      notification: reported("Rolling from March"),
    },
  ],
  applyingLanes: [
    {
      id: "fee",
      label: "Application fee",
      official: {
        state: reported("$65"),
        source: "cuny.edu",
        sourceUrl: "https://www.cuny.edu/admissions/fees",
        verifiedAt: "Aug 14, 2026",
      },
      cds: null,
      disagrees: false,
      caveatRefs: [],
    },
  ],
  degreeShares: [],
};

const BY_UNITID: Record<number, SchoolFacts> = {
  130794: yale,
  167358: northeastern,
  190567: cityCollege,
};

/**
 * Stands in for the packet read. Returns `null` for a school we hold nothing
 * about at all — which the page renders as an empty state, never as an error.
 */
export function schoolFactsFixture(unitid: number): SchoolFacts | null {
  return BY_UNITID[unitid] ?? null;
}

export const FIXTURE_UNITIDS = Object.keys(BY_UNITID).map(Number);
