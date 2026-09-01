import type { Fact } from "@/features/schools/facts/school-facts-types";
import { f, page, reported } from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const campusLifeFacts: Fact[] = [
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
  f("student_life.fraternities_offered", "Fraternities", reported("Yes", true)),
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
];
