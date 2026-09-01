import type { Fact } from "@/features/schools/facts/school-facts-types";
import { f, page, reported } from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const academicsFacts: Fact[] = [
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
      evidence: page(9, "I. Special study: undergraduate research — Yes", "I"),
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
  f("academics.academic_calendar", "Academic calendar", reported("Semester"), {
    evidence: page(2, "A. Academic year calendar: semester", "A"),
  }),
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
    /* The count is the raw. A chart may only draw a number the packet
     * supplied as one — see the numeric gate in school-facts-blocks.ts. */
    f(`class_size.${id}`, label, reported(value, Number(value)), {
      evidence: page(10, `I3. ${label}: ${value}`, "I3"),
    }),
  ),
];
