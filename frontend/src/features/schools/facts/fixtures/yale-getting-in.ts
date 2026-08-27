import type { Fact } from "@/features/schools/facts/school-facts-types";
import {
  f,
  page,
  proof,
  reported,
} from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const gettingInFacts: Fact[] = [
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
    reported("740", 740),
    {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT EBRW 25th percentile 740", "C9"),
    },
  ),
  f(
    "class_profile.sat_ebrw_p50",
    "SAT reading and writing, 50th",
    reported("770", 770),
    {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT EBRW 50th percentile 770", "C9"),
    },
  ),
  f(
    "class_profile.sat_ebrw_p75",
    "SAT reading and writing, 75th",
    reported("780", 780),
    {
      caveats: ["sat-submitters"],
      evidence: page(4, "SAT EBRW 75th percentile 780", "C9"),
    },
  ),
  f("class_profile.sat_math_p25", "SAT math, 25th", reported("760", 760), {
    caveats: ["sat-submitters"],
    evidence: page(4, "SAT Math 25th percentile 760", "C9"),
  }),
  f("class_profile.sat_math_p50", "SAT math, 50th", reported("780", 780), {
    caveats: ["sat-submitters"],
    evidence: page(4, "SAT Math 50th percentile 780", "C9"),
  }),
  f("class_profile.sat_math_p75", "SAT math, 75th", reported("790", 790), {
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
  f(
    "admissions.applicants_total",
    "Total applicants",
    reported("49,000", 49_000),
    {
      evidence: page(
        3,
        "C1. Total first-time, first-year applicants: 49,000",
        "C1",
      ),
    },
  ),
  f("admissions.admitted_total", "Total admitted", reported("2,275", 2_275), {
    evidence: page(3, "C1. Total admitted: 2,275", "C1"),
  }),
  f("admissions.enrolled_total", "Total enrolled", reported("1,647", 1_647), {
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
];
