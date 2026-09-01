import type { Fact } from "@/features/schools/facts/school-facts-types";
import { f, page, reported } from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const moneyFacts: Fact[] = [
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
      evidence: page(7, "H2. i. Average percent of need met: 100%", "H2", "i"),
    },
  ),
  f(
    "financial_aid.h2_j_average_need_based_award",
    "Average need-based award",
    reported("$68,200"),
    {
      evidence: page(7, "H2. j. Average need-based award: $68,200", "H2", "j"),
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
      evidence: page(7, "H2. k. Average need-based grant: $66,900", "H2", "k"),
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
  f("financial_aid.h8_fafsa_deadline", "FAFSA deadline", reported("March 1"), {
    evidence: page(8, "H8. FAFSA deadline: March 1", "H8"),
  }),
  f(
    "financial_aid.net_price_calculator_url",
    "Net price calculator",
    reported("finaid.yale.edu/calculator"),
    { evidence: page(8, "H9. Net price calculator URL", "H9") },
  ),
];
