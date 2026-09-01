import type { SectionId } from "@/features/schools/facts/school-facts-types";

/*
 * The six questions.
 *
 * Domains are how we EXTRACT. They are the wrong spine for reading — nobody
 * has ever asked what is in the H2 grid. These six are what a student is
 * actually asking, and each one draws from several domains.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS FILE IS A PRESENTATION HINT, NOT A CATALOGUE.
 *
 * AGENTS.md forbids hardcoding domain ids, metric inventories, counts or
 * profile groups, because the manifest is dynamic. So this maps qualified
 * refs to GROUPING and ORDER only — it never asserts what exists. The
 * renderer iterates whatever the packet returns and drops unrecognised refs
 * into a final group called "Other published values".
 *
 * That fallback is the whole point. Without it a manifest bump would
 * silently hide metrics, which is the same failure mode as a blank cell one
 * layer up: the page would look complete while quietly having less in it.
 * ────────────────────────────────────────────────────────────────────────
 */

export type FactEntry =
  { kind: "fact"; ref: string } | { kind: "derived"; key: string };

/**
 * One test's three percentiles, plus the scale they sit on.
 *
 * `min`/`max` are properties of the TEST — the SAT section scale is 200–800
 * whoever reports it — not of the manifest, so they are legitimately literal
 * here. The percentile refs are presentation hints like every other ref in
 * this file: a band whose refs are absent renders as rows, never as an empty
 * track.
 */
export type BandSpec = {
  label: string;
  p25: string;
  p50: string;
  p75: string;
  min: number;
  max: number;
};

/*
 * How a group draws itself.
 *
 * `refs` is deliberately separate from `entries`: a chart, unlike a table,
 * has to KNOW which values it plots, and listing them explicitly is what
 * keeps an unrelated metric from being swept into a bar because it happened
 * to land in the same group. Everything in `entries` the chart did not
 * consume still renders as an ordinary row beneath it.
 */
export type GroupRender =
  | {
      chart: "bars";
      unit: "percent" | "count";
      refs: FactEntry[];
      maxRef?: FactEntry;
    }
  | { chart: "bars"; unit: "percent"; source: "degree-shares" }
  | { chart: "ordinal"; levels: readonly string[]; refs: FactEntry[] }
  | { chart: "bands"; bands: readonly BandSpec[] };

export type GroupConfig = {
  id: string;
  title: string;
  /** Qualifies every row in the group; rendered above the first one. */
  caveat: string | null;
  entries: FactEntry[];
  render?: GroupRender;
  /**
   * The one line of prose this tab still carries: a qualifier a CHART cannot
   * be read correctly without. Rendered under that chart and nowhere else.
   * Rows never take one — they are name and value.
   */
  foot?: string;
};

export type SectionConfig = {
  id: SectionId;
  title: string;
  /** Always open, first in the section. */
  headline: FactEntry[];
  headlineCaveat: string | null;
  groups: GroupConfig[];
};

const fact = (ref: string): FactEntry => ({ kind: "fact", ref });
const derived = (key: string): FactEntry => ({ kind: "derived", key });

export const OTHER_GROUP_TITLE = "Other published values";

export const SCHOOL_FACT_SECTIONS: SectionConfig[] = [
  {
    id: "getting-in",
    title: "Getting in",
    headlineCaveat: null,
    headline: [
      /* open_admission_all_students is hoisted to the top by the renderer
       * when it is true: it resets the entire frame, and the rest of the
       * section should be read knowing the school is not selective. */
      fact("admissions.open_admission_all_students"),
      derived("admit_rate"),
      derived("admit_rate_in_state"),
      derived("admit_rate_out_of_state"),
      derived("admit_rate_international"),
      derived("early_decision_admit_rate"),
      fact("class_profile.sat_composite_middle_50"),
      fact("class_profile.act_composite_middle_50"),
      fact("class_profile.average_high_school_gpa"),
      fact("class_profile.class_rank_top_tenth_percent"),
    ],
    groups: [
      {
        id: "selection-factors",
        title: "How they weigh your file",
        caveat:
          "This is what the school says it weighs, not a measurement. Read the program-specific note first — it can override the general table for an oversubscribed major.",
        foot: "What the school says it weighs, not a measurement of what it did.",
        render: {
          chart: "ordinal",
          /* Low to high. A level the school prints that is not one of these
           * four is not guessed at a position — it renders as a row. */
          levels: [
            "Not considered",
            "Considered",
            "Important",
            "Very important",
          ],
          refs: [
            fact(
              "admissions.selection_factor_rigor_of_secondary_school_record",
            ),
            fact("admissions.selection_factor_academic_gpa"),
            fact("admissions.selection_factor_standardized_test_scores"),
            fact("admissions.selection_factor_application_essay"),
            fact("admissions.selection_factor_recommendations"),
            fact("admissions.selection_factor_extracurricular_activities"),
            fact("admissions.selection_factor_character_personal_qualities"),
            fact("admissions.selection_factor_first_generation"),
            fact("admissions.selection_factor_alumni_relation"),
            fact("admissions.selection_factor_level_of_applicant_interest"),
            fact(
              "admissions.selection_factor_religious_affiliation_commitment",
            ),
          ],
        },
        entries: [
          fact("admissions.program_specific_factor_differences"),
          fact("admissions.selection_factor_rigor_of_secondary_school_record"),
          fact("admissions.selection_factor_academic_gpa"),
          fact("admissions.selection_factor_standardized_test_scores"),
          fact("admissions.selection_factor_application_essay"),
          fact("admissions.selection_factor_recommendations"),
          fact("admissions.selection_factor_extracurricular_activities"),
          fact("admissions.selection_factor_character_personal_qualities"),
          fact("admissions.selection_factor_first_generation"),
          fact("admissions.selection_factor_alumni_relation"),
          fact("admissions.selection_factor_level_of_applicant_interest"),
          fact("admissions.selection_factor_religious_affiliation_commitment"),
        ],
      },
      {
        /* Directly under the composites in the headline it details, not
         * below the units table. A band chart separated from the two numbers
         * it expands is a shape the reader has to go looking for. */
        id: "test-detail",
        title: "Test scores in detail",
        caveat:
          "The submitter rate applies to every figure below, not just the composite. A percentile drawn from a self-selected half of the class describes that half.",
        foot: "A middle-50 band describes the students who submitted a score, not the whole class — read it next to the submitter rate below.",
        render: {
          chart: "bands",
          bands: [
            {
              label: "SAT reading and writing",
              p25: "class_profile.sat_ebrw_p25",
              p50: "class_profile.sat_ebrw_p50",
              p75: "class_profile.sat_ebrw_p75",
              min: 200,
              max: 800,
            },
            {
              label: "SAT math",
              p25: "class_profile.sat_math_p25",
              p50: "class_profile.sat_math_p50",
              p75: "class_profile.sat_math_p75",
              min: 200,
              max: 800,
            },
          ],
        },
        entries: [
          fact("class_profile.sat_ebrw_p25"),
          fact("class_profile.sat_ebrw_p50"),
          fact("class_profile.sat_ebrw_p75"),
          fact("class_profile.sat_math_p25"),
          fact("class_profile.sat_math_p50"),
          fact("class_profile.sat_math_p75"),
          fact("class_profile.sat_submitters_percent"),
          fact("class_profile.act_submitters_percent"),
        ],
      },
      {
        id: "required-units",
        title: "Required high-school units",
        caveat:
          "Schools often recommend more than they require. The recommendation is the real expectation.",
        /*
         * NO CHART, deliberately — this group is rows only.
         *
         * The two honest options were both weak. A bar per subject puts parts
         * and totals on one axis, which is the defect `cost-itemized` warns
         * about one section over. Two bars for the totals alone is honest but
         * says almost nothing: 20 against 24 is a 17% difference that the two
         * adjacent rows already make instantly readable, and drawing it costs
         * this group its half of a paired band — real vertical space traded
         * for a mark nobody needed. The caveat above carries the finding.
         */
        entries: [
          fact("admissions.total_academic_units_required"),
          fact("admissions.total_academic_units_recommended"),
          fact("admissions.english_units_required"),
          fact("admissions.mathematics_units_required"),
          fact("admissions.science_units_required"),
          fact("admissions.foreign_language_units_required"),
          fact("admissions.social_studies_units_required"),
        ],
      },
      {
        id: "class-rank",
        title: "Class rank",
        caveat:
          "Bands overlap — the top tenth is inside the top quarter. They cannot be added or subtracted, and a blank band can never be derived from the ones around it. Most US high schools no longer rank.",
        entries: [
          fact("class_profile.class_rank_top_tenth_percent"),
          fact("class_profile.class_rank_top_quarter_percent"),
          fact("class_profile.class_rank_top_half_percent"),
          fact("class_profile.class_rank_submitted_percent"),
        ],
      },
      {
        id: "waitlist",
        title: "Waitlist",
        caveat:
          "Waitlist numbers swing widely year to year. Read them as context, not as odds.",
        foot: "Three nested counts on one scale — everyone admitted from the waitlist first accepted a place on it.",
        /*
         * The same shape as `applicant-pool`, which it had been missing:
         * three nested counts — admitted ⊆ accepted ⊆ offered — so one
         * shared scale is the fact rather than a flattering arrangement of
         * it. Three bars on a baseline, never a funnel, for the reason
         * written under `applicant-pool` below.
         *
         * This is also where the zero rule earns its keep: a school that
         * admitted nobody from its waitlist reports a real 0, and the bar
         * keeps its 2px tick and its printed "0" rather than vanishing.
         */
        render: {
          chart: "bars",
          unit: "count",
          refs: [
            fact("admissions.waitlist_offered_count"),
            fact("admissions.waitlist_accepted_count"),
            fact("admissions.waitlist_admitted_count"),
          ],
          maxRef: fact("admissions.waitlist_offered_count"),
        },
        entries: [
          fact("admissions.has_waitlist_policy"),
          fact("admissions.waitlist_offered_count"),
          fact("admissions.waitlist_accepted_count"),
          fact("admissions.waitlist_admitted_count"),
          derived("waitlist_conversion"),
        ],
      },
      {
        id: "applicant-pool",
        title: "Applicant pool",
        caveat:
          "The international admit rate is the number that reclassifies a “safety” public into a reach for an aid-needing international applicant.",
        render: {
          chart: "bars",
          unit: "count",
          /* Genuinely nested subsets — enrolled ⊆ admitted ⊆ applicants — so
           * one shared scale is the fact, not a flattering arrangement of it.
           * Three bars on a baseline rather than a trapezoid: a funnel shape
           * implies a conversion story these counts do not tell. */
          refs: [
            fact("admissions.applicants_total"),
            fact("admissions.admitted_total"),
            fact("admissions.enrolled_total"),
          ],
          maxRef: fact("admissions.applicants_total"),
        },
        entries: [
          fact("admissions.applicants_total"),
          fact("admissions.admitted_total"),
          fact("admissions.enrolled_total"),
          fact("admissions.applicants_in_state"),
          fact("admissions.admitted_in_state"),
          fact("admissions.applicants_out_of_state"),
          fact("admissions.admitted_out_of_state"),
        ],
      },
    ],
  },
  {
    id: "money",
    title: "Money",
    headlineCaveat: null,
    headline: [
      derived("sticker_cost"),
      fact("cost.tuition_in_state"),
      fact("cost.tuition_out_of_state"),
      /* need_fully_met_share and the grant-recipient share are NOT here —
       * they are the aid-coverage chart immediately below, and a figure that
       * appears twice on one screen reads as two different findings. */
      fact("financial_aid.h2_j_average_need_based_award"),
      fact("financial_aid.h5_borrowers_any_program_average_principal"),
      /* Honesty flags live in the HEADLINE, never behind a disclosure:
       * printed tuition is stale in the wrong direction — below what an
       * applicant will actually pay. */
      fact("cost.final_costs_not_available"),
      fact("cost.final_costs_expected_date"),
      fact("financial_aid.recent_affordability_initiative_details"),
    ],
    groups: [
      {
        id: "aid-coverage",
        title: "How far the aid goes",
        caveat: null,
        /* Three independent percentages on one axis. The point is the drop
         * between them: many students get aid, far fewer get all of it. */
        foot: "Each share has its own denominator — the third counts aid recipients, not all students.",
        render: {
          chart: "bars",
          unit: "percent",
          refs: [
            fact("financial_aid.h2_e_need_based_grant_recipients_percent"),
            derived("need_fully_met_share"),
            fact("financial_aid.h2_i_average_percent_need_met"),
          ],
        },
        entries: [],
      },
      {
        id: "cost-itemized",
        title: "Cost of attendance, itemized",
        caveat:
          "The combined figure and the itemized rows are alternatives, not a total and its parts. A school that publishes one blanks the other.",
        entries: [
          fact("cost.comprehensive_tuition_food_housing_amount"),
          fact("cost.required_fees"),
          fact("cost.housing_amount"),
          fact("cost.food_amount"),
          fact("cost.books_and_supplies"),
        ],
      },
      {
        id: "cost-living",
        title: "If you live at home or off campus",
        caveat: null,
        entries: [
          fact("cost.living_at_home_amount"),
          fact("cost.off_campus_housing_amount"),
        ],
      },
      {
        id: "cost-escalation",
        title: "Does the price rise after year one?",
        caveat: null,
        entries: [
          fact("cost.tuition_guarantee_offered"),
          fact("cost.tuition_plan_notes"),
          fact("cost.per_credit_hour_charge"),
        ],
      },
      {
        id: "need-based-aid",
        title: "Need-based aid",
        caveat:
          "The printed “average percent of need met” below counts aid RECIPIENTS as its denominator, not all students, and excludes PLUS and private loans. The headline figure is the derived share of students with need whose need was fully met.",
        entries: [
          fact("financial_aid.h2_c_need_based_determined_count"),
          fact("financial_aid.h2_h_need_fully_met_count"),
          fact("financial_aid.h2_i_average_percent_need_met"),
          fact("financial_aid.h2_k_average_need_based_grant"),
          fact("financial_aid.h2_m_average_need_based_loan"),
        ],
      },
      {
        id: "merit-aid",
        title: "Merit aid",
        caveat: null,
        entries: [
          fact("financial_aid.h2a_n_non_need_award_recipients"),
          fact("financial_aid.h2a_q_average_non_need_award"),
          fact("financial_aid.h14_athletic_scholarship_total"),
        ],
      },
      {
        id: "international-aid",
        title: "International and nonresident aid",
        caveat:
          "“Nonresident” is a citizenship status, not a state-residency one. These figures are unrelated to out-of-state tuition.",
        entries: [
          fact("financial_aid.h6_nonresident_aid_available"),
          fact("financial_aid.h6_nonresident_aid_recipients"),
          fact("financial_aid.h6_nonresident_average_award"),
        ],
      },
      {
        id: "forms-deadlines",
        title: "Forms and deadlines",
        caveat: null,
        entries: [
          fact("financial_aid.need_analysis_methodology"),
          fact("financial_aid.aid_reporting_status"),
          fact("financial_aid.h8_css_profile_required"),
          fact("financial_aid.h8_fafsa_deadline"),
          fact("financial_aid.net_price_calculator_url"),
        ],
      },
    ],
  },
  {
    id: "academics",
    title: "Academics",
    headlineCaveat: null,
    headline: [
      fact("faculty.students_per_faculty"),
      derived("classes_under_20"),
      derived("classes_50_plus"),
      derived("faculty_full_time_percent"),
      derived("faculty_terminal_degree_percent"),
      fact("academics.special_study_honors_program"),
      fact("academics.special_study_undergraduate_research"),
    ],
    groups: [
      {
        id: "degree-shares",
        title: "What students graduate in",
        caveat: null,
        entries: [],
        render: { chart: "bars", unit: "percent", source: "degree-shares" },
      },
      {
        id: "class-sizes",
        title: "Class sizes",
        caveat:
          "Subsections — labs, discussion sections, recitations — are counted separately from lectures. They are where the small-group experience behind a large course actually shows up.",
        /* Counts, scaled to the LARGEST BIN — never to a total. A bin the
         * school did not report would otherwise silently shrink every other
         * bar, which is the "blank reads as zero" failure in geometry. */
        render: {
          chart: "bars",
          unit: "count",
          refs: [
            fact("class_size.section_2_9"),
            fact("class_size.section_10_19"),
            fact("class_size.section_20_29"),
            fact("class_size.section_30_39"),
            fact("class_size.section_40_49"),
            fact("class_size.section_50_99"),
            fact("class_size.section_100_plus"),
          ],
        },
        entries: [],
      },
      {
        id: "subsection-sizes",
        title: "Subsections — labs, discussions, recitations",
        caveat: null,
        /* Their own chart, never merged into the one above: a subsection is
         * not a smaller lecture, it is the small-group half of a large one. */
        render: {
          chart: "bars",
          unit: "count",
          refs: [
            fact("class_size.subsection_2_9"),
            fact("class_size.subsection_10_19"),
            fact("class_size.subsection_20_29"),
          ],
        },
        entries: [],
      },
      {
        id: "special-study",
        title: "Special study options",
        caveat: null,
        entries: [
          fact("academics.special_study_study_abroad"),
          fact("academics.special_study_double_major"),
          fact("academics.special_study_independent_study"),
          fact("academics.special_study_internships"),
          fact("academics.special_study_teacher_certification"),
          fact("academics.special_study_combined_degree"),
        ],
      },
      {
        id: "core-curriculum",
        title: "Core curriculum",
        caveat: null,
        entries: [
          fact("academics.required_coursework_english"),
          fact("academics.required_coursework_mathematics"),
          fact("academics.required_coursework_sciences"),
          fact("academics.required_coursework_foreign_languages"),
          fact("academics.required_coursework_philosophy_religion"),
        ],
      },
      {
        id: "faculty-detail",
        title: "Faculty",
        caveat: null,
        entries: [
          fact("faculty.total_instructional_faculty"),
          fact("faculty.full_time_faculty"),
          fact("faculty.faculty_with_terminal_degree"),
          fact("faculty.ratio_basis_note"),
        ],
      },
    ],
  },
  {
    id: "campus-life",
    title: "Campus life",
    headlineCaveat: null,
    headline: [
      fact("enrollment.undergraduate_total"),
      fact("enrollment.graduate_total"),
      fact("academics.academic_calendar"),
    ],
    groups: [
      {
        id: "composition",
        title: "Who's here",
        caveat: null,
        /* Three shares of the same undergraduate body, so one axis is
         * honest and the comparison between them is the point. */
        render: {
          chart: "bars",
          unit: "percent",
          refs: [
            fact("student_life.college_owned_housing_percent_undergraduates"),
            derived("international_percent"),
            fact("enrollment.out_of_state_percent_undergraduates"),
          ],
        },
        entries: [],
      },
      {
        id: "greek-life",
        title: "Greek life",
        caveat: null,
        entries: [
          fact("student_life.fraternities_offered"),
          fact("student_life.fraternity_percent_men"),
          fact("student_life.sororities_offered"),
          fact("student_life.sorority_percent_women"),
        ],
      },
      {
        id: "who-is-here",
        title: "Who's on campus",
        caveat: null,
        entries: [
          fact("enrollment.undergraduates_age_25_and_over_percent"),
          fact("enrollment.average_undergraduate_age"),
          fact("identity.gender_model"),
          fact("identity.institutional_control"),
        ],
      },
      {
        id: "rotc",
        title: "ROTC",
        caveat:
          "On-campus and cross-enrollment at a cooperating institution are different commitments, so both render.",
        entries: [
          fact("student_life.army_rotc_offered"),
          fact("student_life.army_rotc_cooperating_institution"),
          fact("student_life.navy_rotc_offered"),
          fact("student_life.air_force_rotc_offered"),
        ],
      },
    ],
  },
  {
    id: "outcomes",
    title: "Outcomes",
    headlineCaveat: null,
    headline: [
      fact("outcomes.first_year_retention_reported_percent"),
      derived("four_year_completion_rate"),
    ],
    groups: [
      {
        id: "time-to-degree",
        title: "Time to degree",
        caveat:
          "A high six-year rate with a low four-year rate means students routinely need a fifth year — which is a year of tuition.",
        foot: "Cumulative against the entering cohort — each bar counts everyone who had finished by that year, so it can only grow.",
        /*
         * Bars, not a line. These are three cumulative counts of one cohort
         * plotted against that cohort, and on a zero-anchored axis a school
         * that finishes most students on time draws a line pinned flat to
         * the top of an empty plot — all dead space, no finding. The same
         * three numbers as bars sit in the page's one visual language and
         * make the four-to-six-year gap a length you can see.
         */
        render: {
          chart: "bars",
          unit: "count",
          refs: [
            fact("outcomes.completers_within_four_years"),
            fact("outcomes.completers_within_five_years"),
            fact("outcomes.completers_within_six_years"),
          ],
          maxRef: fact("outcomes.primary_cohort_count"),
        },
        entries: [
          fact("outcomes.primary_cohort_count"),
          derived("four_to_six_year_gap"),
        ],
      },
      {
        id: "completion-gap",
        title: "Who finishes",
        caveat: null,
        /* Two numbers, but they sit rows apart in a table and the GAP is the
         * finding. One axis makes it a single read. */
        render: {
          chart: "bars",
          unit: "percent",
          refs: [
            fact(
              "outcomes.primary_all_students_six_year_graduation_rate_ratio",
            ),
            fact("outcomes.primary_pell_grant_six_year_graduation_rate_ratio"),
          ],
        },
        entries: [],
      },
    ],
  },
  {
    id: "applying",
    title: "Applying",
    headlineCaveat: null,
    /* Rendered by ApplyingSection through RoundsTable and ProvenanceLanes;
     * the headline entries live in the lane model, not here. */
    headline: [],
    groups: [
      {
        id: "decision-notification",
        title: "Decision notification",
        caveat: null,
        entries: [
          fact("admissions.notification_mode"),
          fact("admissions.rolling_notification_begins"),
          fact("admissions.regular_notification_date"),
        ],
      },
      {
        id: "other-terms",
        title: "Other terms",
        caveat:
          "Deferred enrolment is a student postponing their start after being admitted. It is not an admission deferral, where a school moves an early application into the regular round — an easy and expensive conflation.",
        entries: [
          fact("admissions.spring_admission_offered"),
          fact("admissions.deferred_enrollment_offered"),
          fact("admissions.deferred_enrollment_maximum_period"),
        ],
      },
      {
        id: "deposits",
        title: "Deposits",
        caveat: null,
        entries: [
          fact("admissions.housing_deposit_amount"),
          fact("admissions.housing_deposit_deadline"),
          fact("admissions.housing_deposit_refundable"),
        ],
      },
    ],
  },
];

export const NAV_SECTIONS = SCHOOL_FACT_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
}));

/**
 * Takes a bare string because one caller is the URL, which can carry
 * anything — a stale link, a typo, or nothing at all. A miss is not an error
 * worth showing; it lands on the first section, which is the same place a
 * reader with no link starts.
 */
export function sectionById(id: string | null | undefined): SectionConfig {
  const found = SCHOOL_FACT_SECTIONS.find((section) => section.id === id);
  return found ?? SCHOOL_FACT_SECTIONS[0];
}

/** Every qualified ref this config knows how to place, for the fallback. */
export function configuredRefs(section: SectionConfig): Set<string> {
  const refs = new Set<string>();
  const collect = (entries: readonly FactEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === "fact") refs.add(entry.ref);
    }
  };
  collect(section.headline);
  for (const group of section.groups) collect(group.entries);
  return refs;
}
