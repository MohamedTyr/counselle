import type { Fact } from "@/features/schools/facts/school-facts-types";
import { f, page, reported } from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const outcomesFacts: Fact[] = [
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
  f(
    "outcomes.primary_cohort_count",
    "Entering cohort",
    reported("1,554", 1_554),
    {
      evidence: page(12, "B4. Adjusted cohort: 1,554", "B4"),
    },
  ),
  f(
    "outcomes.completers_within_four_years",
    "Completed within four years",
    reported("1,367", 1_367),
    {
      evidence: page(12, "B7. Completers within four years: 1,367", "B7"),
    },
  ),
  f(
    "outcomes.completers_within_five_years",
    "Completed within five years",
    reported("1,478", 1_478),
    {
      evidence: page(12, "B8. Completers within five years: 1,478", "B8"),
    },
  ),
  f(
    "outcomes.completers_within_six_years",
    "Completed within six years",
    reported("1,507", 1_507),
    {
      evidence: page(12, "B9. Completers within six years: 1,507", "B9"),
    },
  ),
];
