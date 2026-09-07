#!/usr/bin/env python3
"""Regenerate `config/assets/facts_sections.yaml` (plan §4.4/§7 Phase 1).

The authored content — section/group ids and titles, each fact's `label:`,
and the two `foot_ref:` declarations — lives in `_SECTIONS_SOURCE` below (a
human edits this constant, not the generated YAML file). This script's only
job is to fill in what it can derive mechanically: each fact's owning `tab:`
(from `config/assets/facts_keys.yaml`'s per-rule `tab:`) and each section's
`tabs:` (the sorted union of its facts' tabs) — never `label:`, `id:`,
`title:`, `foot:`/`foot_ref:`.

Run by hand after editing `_SECTIONS_SOURCE` or `facts_keys.yaml`:

    uv run python scripts/build_facts_sections_tabs.py

A Phase 1 exit test re-runs this script into a temp file and diffs it
byte-for-byte against the committed `config/assets/facts_sections.yaml` — so
this script is written from scratch every run (no round-tripping of the
previous YAML), which is what makes "run it twice, get the same bytes" hold
trivially.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO_ROOT = Path(__file__).resolve().parents[1]
FACTS_KEYS_PATH = REPO_ROOT / "config" / "assets" / "facts_keys.yaml"
OUTPUT_PATH = REPO_ROOT / "config" / "assets" / "facts_sections.yaml"

# fact_keys the mapper produces from bespoke Python logic in app/facts/mapper.py
# rather than from a facts_keys.yaml rule (the header pair for deadlines.regular,
# the structural `website` read, and the two overview-body-only facts) — see
# that module's docstrings for why each one is a special case.
_CODE_OWNED_TABS: dict[str, str] = {
    "identity.website": "overview",
    "deadlines.regular": "admission",
    "admissions.regular_deadline_is_rolling": "admission",
    "admissions.entrance_difficulty": "overview",
    "class_profile.average_gpa": "overview",
}

_ABBREVIATIONS: dict[str, str] = {
    "sat": "SAT",
    "act": "ACT",
    "gpa": "GPA",
    "ap": "AP",
    "ib": "IB",
    "css": "CSS",
    "fafsa": "FAFSA",
    "rotc": "ROTC",
    "url": "URL",
    "ebrw": "EBRW",
    "hs": "high school",
    "p25": "25th percentile",
    "p75": "75th percentile",
    "avg": "average",
    "pct": "percent",
    "6y": "within 6 years",
    "5y": "within 5 years",
    "4y": "within 4 years",
}


def humanize_label(fact_key: str) -> str:
    """A readable default label from a fact_key's own name, applied to
    every fact this file lists (a hand-tuned `label:` always wins — see
    `_LABEL_OVERRIDES` — this is the fallback for the long tail where the
    key name already reads fine)."""
    stem = fact_key.split(".", 1)[1]
    words = [_ABBREVIATIONS.get(word, word) for word in stem.split("_")]
    text = " ".join(words)
    return text[0].upper() + text[1:] if text else stem


# Hand-authored overrides for facts where the humanized default reads poorly
# (D3 copy-quality bar — headline/frequently-seen stats only; the long tail
# is fine humanized). Keyed by fact_key.
_LABEL_OVERRIDES: dict[str, str] = {
    "admissions.admit_rate": "Admit rate",
    "admissions.admit_rate_women": "Admit rate — women",
    "admissions.admit_rate_men": "Admit rate — men",
    "admissions.applicants_total": "Applicants",
    "admissions.applicants_total_women": "Applicants — women",
    "admissions.applicants_total_men": "Applicants — men",
    "admissions.admitted_total": "Admitted",
    "admissions.admitted_total_women": "Admitted — women",
    "admissions.admitted_total_men": "Admitted — men",
    "admissions.enrolled_total": "Enrolled",
    "admissions.enrolled_total_women": "Enrolled — women",
    "admissions.enrolled_total_men": "Enrolled — men",
    "admissions.yield_rate": "Yield",
    "admissions.yield_rate_women": "Yield — women",
    "admissions.yield_rate_men": "Yield — men",
    "admissions.entrance_difficulty": "Entrance difficulty",
    "class_profile.average_gpa": "Average GPA",
    "class_profile.sat_math_p25": "SAT Math 25th percentile",
    "class_profile.sat_math_p75": "SAT Math 75th percentile",
    "class_profile.sat_math_avg": "SAT Math average",
    "class_profile.sat_math_distribution": "SAT Math distribution",
    "class_profile.sat_ebrw_p25": "SAT EBRW 25th percentile",
    "class_profile.sat_ebrw_p75": "SAT EBRW 75th percentile",
    "class_profile.sat_ebrw_avg": "SAT EBRW average",
    "class_profile.sat_ebrw_distribution": "SAT EBRW distribution",
    "class_profile.act_composite_p25": "ACT Composite 25th percentile",
    "class_profile.act_composite_p75": "ACT Composite 75th percentile",
    "class_profile.act_composite_avg": "ACT Composite average",
    "class_profile.act_composite_distribution": "ACT Composite distribution",
    "class_profile.act_math_avg": "ACT Math average",
    "class_profile.act_math_distribution": "ACT Math distribution",
    "class_profile.act_english_avg": "ACT English average",
    "class_profile.act_english_distribution": "ACT English distribution",
    "class_profile.gpa_distribution": "GPA distribution",
    "costs.attendance_in_state": "Cost of attendance — in state",
    "costs.attendance_out_of_state": "Cost of attendance — out of state",
    "costs.tuition_fees_in_state": "Tuition and fees — in state",
    "costs.tuition_fees_out_of_state": "Tuition and fees — out of state",
    "costs.room_and_board": "Room and board",
    "costs.books_and_supplies": "Books and supplies",
    "costs.other_expenses": "Other expenses",
    "aid.avg_percent_need_met_freshman": "Average percent of need met — freshman",
    "aid.avg_percent_need_met_all_undergraduates": (
        "Average percent of need met — all undergraduates"
    ),
    "aid.avg_award_freshman": "Average award — freshman",
    "aid.avg_award_all_undergraduates": "Average award — all undergraduates",
    "outcomes.retention_first_year": "First-year students returning",
    "outcomes.graduation_rate_4y": "Graduating within 4 years",
    "outcomes.graduation_rate_5y": "Graduating within 5 years",
    "outcomes.graduation_rate_6y": "Graduating within 6 years",
    "deadlines.regular": "Regular decision deadline",
    "admissions.regular_deadline_is_rolling": "Rolling admission",
    "deadlines.early_decision": "Early decision deadline",
    "deadlines.early_action": "Early action deadline",
    "deadlines.financial_aid": "Financial aid deadline",
    "deadlines.reply_by": "Reply-by date",
    "identity.website": "School website",
    "identity.address": "Address",
    "identity.coeducational": "Coeducational",
    "identity.control_reported": "Public or private",
    "identity.gender_model_reported": "Student population",
}


def _label(fact_key: str) -> str:
    return _LABEL_OVERRIDES.get(fact_key, humanize_label(fact_key))


def _fact(fact_key: str) -> dict[str, Any]:
    return {"key": fact_key, "label": _label(fact_key)}


# ---------------------------------------------------------------------------
# Authored content — section/group ids, titles, and each group's fact_keys.
# `tab:`/`tabs:` are filled in by `build_sections()`, never here.
# ---------------------------------------------------------------------------

_SECTIONS_SOURCE: list[dict[str, Any]] = [
    {
        "id": "getting-in",
        "title": "Getting in",
        "groups": [
            {
                "id": "selectivity-rating",
                "title": "Selectivity",
                "foot_ref": "ENTRANCE_DIFFICULTY_NOTE",
                "facts": ["admissions.entrance_difficulty"],
            },
            {
                "id": "applicant-pool",
                "title": "Applicant pool",
                "facts": [
                    "admissions.applicants_total",
                    "admissions.admitted_total",
                    "admissions.enrolled_total",
                    "admissions.admit_rate",
                    "admissions.yield_rate",
                    "admissions.applicants_total_women",
                    "admissions.admitted_total_women",
                    "admissions.admit_rate_women",
                    "admissions.enrolled_total_women",
                    "admissions.yield_rate_women",
                    "admissions.applicants_total_men",
                    "admissions.admitted_total_men",
                    "admissions.admit_rate_men",
                    "admissions.enrolled_total_men",
                    "admissions.yield_rate_men",
                ],
            },
            {
                "id": "test-detail",
                "title": "Test scores in detail",
                "foot_ref": "BAND_CAPTION",
                "facts": [
                    "class_profile.sat_math_p25",
                    "class_profile.sat_math_p75",
                    "class_profile.sat_math_avg",
                    "class_profile.sat_math_distribution",
                    "class_profile.sat_ebrw_p25",
                    "class_profile.sat_ebrw_p75",
                    "class_profile.sat_ebrw_avg",
                    "class_profile.sat_ebrw_distribution",
                    "class_profile.act_composite_p25",
                    "class_profile.act_composite_p75",
                    "class_profile.act_composite_avg",
                    "class_profile.act_composite_distribution",
                    "class_profile.act_math_avg",
                    "class_profile.act_math_distribution",
                    "class_profile.act_english_avg",
                    "class_profile.act_english_distribution",
                ],
            },
            {
                "id": "gpa-and-rank",
                "title": "GPA and class rank",
                "facts": [
                    "class_profile.average_gpa",
                    "class_profile.gpa_distribution",
                    "class_profile.class_rank_top_tenth",
                    "class_profile.class_rank_top_quarter",
                    "class_profile.class_rank_top_half",
                    "class_profile.national_merit_count",
                    "class_profile.valedictorian_count",
                    "class_profile.class_president_count",
                    "class_profile.student_government_count",
                ],
            },
            {
                "id": "selection-factors",
                "title": "How they weigh your file",
                "facts": [
                    "admissions.selection_factor_rigor_of_secondary_school_record",
                    "admissions.selection_factor_academic_gpa",
                    "admissions.selection_factor_standardized_tests",
                    "admissions.selection_factor_class_rank",
                    "admissions.selection_factor_recommendations",
                    "admissions.selection_factor_essay",
                    "admissions.selection_factor_interview",
                    "admissions.selection_factor_level_of_applicant_s_interest",
                    "admissions.selection_factor_extracurricular_activities",
                    "admissions.selection_factor_volunteer_work",
                    "admissions.selection_factor_particular_talent_ability",
                    "admissions.selection_factor_character_personal_qualities",
                    "admissions.selection_factor_first_generation_to_attend_college",
                    "admissions.selection_factor_state_residency",
                    "admissions.selection_factor_geographic_residence",
                    "admissions.selection_factor_relation_with_alumnus",
                    "admissions.selection_factor_religious_affiliation_commitment",
                    "admissions.selection_factor_work_experience",
                ],
            },
            {
                "id": "admission-requirements",
                "title": "What they require",
                "facts": [
                    "admissions.interview_requirement",
                    "admissions.essay_requirement",
                    "admissions.recommendations_requirement",
                    "admissions.other_requirement",
                    "admissions.need_blind",
                    "admissions.test_policy_sat_or_act",
                    "admissions.test_policy_sat_only",
                    "admissions.test_policy_act_only",
                    "admissions.test_policy_act_writing_test_policy",
                    "admissions.test_policy_sat_subject_tests_only",
                    "admissions.test_policy_sat_and_sat_subject_tests_or_act",
                ],
            },
            {
                "id": "required-units",
                "title": "Required high-school units",
                "facts": [
                    "admissions.hs_graduation_requirement",
                    "admissions.hs_program_requirement",
                    "admissions.units_required_english",
                    "admissions.units_recommended_english",
                    "admissions.units_required_mathematics",
                    "admissions.units_recommended_mathematics",
                    "admissions.units_required_science",
                    "admissions.units_recommended_science",
                    "admissions.units_required_social_studies",
                    "admissions.units_recommended_social_studies",
                    "admissions.units_required_history",
                    "admissions.units_recommended_history",
                    "admissions.units_required_foreign_language",
                    "admissions.units_recommended_foreign_language",
                    "admissions.units_required_academic_electives",
                    "admissions.units_recommended_academic_electives",
                ],
            },
            {
                "id": "waitlist",
                "title": "Waitlist",
                "facts": [
                    "admissions.waitlist_used",
                    "admissions.waitlist_offered",
                    "admissions.waitlist_accepted",
                    "admissions.waitlist_admitted",
                ],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
    {
        "id": "money",
        "title": "Money",
        "groups": [
            {
                "id": "cost-itemized",
                "title": "Cost of attendance, itemized",
                "facts": [
                    "costs.attendance_in_state",
                    "costs.attendance_out_of_state",
                    "costs.tuition_fees_in_state",
                    "costs.tuition_fees_out_of_state",
                    "costs.room_and_board",
                    "costs.books_and_supplies",
                    "costs.other_expenses",
                ],
            },
            {
                "id": "aid-coverage",
                "title": "How far the aid goes",
                "facts": [
                    "aid.applicants_freshman",
                    "aid.need_found_freshman",
                    "aid.received_freshman",
                    "aid.need_fully_met_freshman",
                    "aid.avg_percent_need_met_freshman",
                    "aid.applicants_all_undergraduates",
                    "aid.need_found_all_undergraduates",
                    "aid.received_all_undergraduates",
                    "aid.need_fully_met_all_undergraduates",
                    "aid.avg_percent_need_met_all_undergraduates",
                ],
            },
            {
                "id": "need-based-aid",
                "title": "Need-based aid",
                "facts": [
                    "aid.avg_award_freshman",
                    "aid.need_gift_recipients_freshman",
                    "aid.need_gift_recipients_pct_freshman",
                    "aid.need_gift_avg_freshman",
                    "aid.need_selfhelp_recipients_freshman",
                    "aid.need_selfhelp_recipients_pct_freshman",
                    "aid.need_selfhelp_avg_freshman",
                    "aid.avg_award_all_undergraduates",
                    "aid.need_gift_recipients_all_undergraduates",
                    "aid.need_gift_recipients_pct_all_undergraduates",
                    "aid.need_gift_avg_all_undergraduates",
                    "aid.need_selfhelp_recipients_all_undergraduates",
                    "aid.need_selfhelp_recipients_pct_all_undergraduates",
                    "aid.need_selfhelp_avg_all_undergraduates",
                ],
            },
            {
                "id": "merit-aid",
                "title": "Merit aid",
                "facts": [
                    "aid.merit_to_need_recipients_freshman",
                    "aid.merit_to_need_recipients_pct_freshman",
                    "aid.merit_no_need_recipients_freshman",
                    "aid.merit_no_need_recipients_pct_freshman",
                    "aid.merit_no_need_avg_freshman",
                    "aid.merit_to_need_recipients_all_undergraduates",
                    "aid.merit_to_need_recipients_pct_all_undergraduates",
                    "aid.merit_no_need_recipients_all_undergraduates",
                    "aid.merit_no_need_recipients_pct_all_undergraduates",
                    "aid.merit_no_need_avg_all_undergraduates",
                    "aid.non_need_academic_areas",
                    "aid.non_need_academic_count",
                    "aid.non_need_creative_arts_areas",
                    "aid.non_need_creative_arts_count",
                    "aid.non_need_special_achievements_areas",
                    "aid.non_need_special_achievements_count",
                    "aid.non_need_special_characteristics_areas",
                    "aid.non_need_special_characteristics_count",
                ],
            },
            {
                "id": "aid-programs",
                "title": "Aid programs offered",
                "facts": [
                    "aid.federal_loan_programs",
                    "aid.state_loan_programs",
                    "aid.other_loan_programs",
                    "aid.need_based_programs",
                    "aid.non_need_programs",
                    "aid.work_study_programs",
                    "aid.on_campus_employment_avg",
                    "aid.need_analysis_methodology",
                ],
            },
            {
                "id": "forms-deadlines",
                "title": "Forms and deadlines",
                "facts": [
                    "money.fafsa_code",
                    "money.css_profile_fee",
                    "deadlines.aid_award_notification",
                    "money.financial_aid_url",
                    "money.net_price_calculator_url",
                    "money.financial_aid_email",
                ],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
    {
        "id": "academics",
        "title": "Academics",
        "groups": [
            {
                "id": "majors",
                "title": "What you can study",
                "facts": [
                    "academics.undergraduate_majors_count",
                    "academics.undergraduate_majors",
                    "academics.popular_disciplines",
                    "academics.combined_degree_programs",
                ],
            },
            {
                "id": "class-sizes",
                "title": "Class sizes",
                "facts": ["class_size.regular_distribution"],
            },
            {
                "id": "subsection-sizes",
                "title": "Subsections — labs, discussions, recitations",
                "facts": ["class_size.subsection_distribution"],
            },
            {
                "id": "faculty-detail",
                "title": "Faculty",
                "facts": [
                    "faculty.full_time_count",
                    "faculty.part_time_count",
                    "faculty.terminal_degree_pct",
                ],
            },
            {
                "id": "special-study",
                "title": "Special study options",
                "facts": [
                    "academics.special_programs",
                    "academics.study_abroad",
                    "academics.online_degrees",
                ],
            },
            {
                "id": "core-curriculum",
                "title": "Core curriculum",
                "facts": [
                    "academics.required_coursework_general_education",
                    "academics.required_coursework_computer",
                    "academics.required_coursework_foreign_language",
                    "academics.required_coursework_math_science",
                ],
            },
            {
                "id": "credit-and-support",
                "title": "Credit, resources and support",
                "facts": [
                    "academics.ap_policy",
                    "academics.ib_policy",
                    "academics.sophomore_standing",
                    "academics.library_on_campus",
                    "academics.library_holdings",
                    "academics.computer_ownership",
                    "academics.computers_available",
                    "academics.support_tutoring",
                    "academics.support_remedial_instruction",
                    "academics.support_learning_disabled",
                    "academics.support_physically_disabled",
                ],
            },
            {
                "id": "graduate-education",
                "title": "Graduate and professional programs",
                "facts": [
                    "academics.masters_degrees",
                    "academics.masters_programs_count",
                    "academics.masters_programs",
                    "academics.doctoral_degrees",
                    "academics.doctoral_programs_count",
                    "academics.doctoral_programs",
                ],
            },
            {
                "id": "general",
                "title": "Academic calendar",
                "facts": ["academics.calendar", "academics.summer_session"],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
    {
        "id": "campus-life",
        "title": "Campus life",
        "groups": [
            {
                "id": "student-body",
                "title": "Who's here",
                "facts": [
                    "students.undergraduate_total",
                    "students.undergraduate_full_time",
                    "students.undergraduate_women_count",
                    "students.undergraduate_women_pct",
                    "students.undergraduate_men_count",
                    "students.undergraduate_men_pct",
                    "students.graduate_total",
                    "students.ethnicity_distribution",
                    "students.international_pct",
                    "students.countries_represented",
                    "students.average_age",
                    "identity.coeducational",
                    "identity.gender_model_reported",
                    "identity.control_reported",
                ],
            },
            {
                "id": "housing",
                "title": "Housing",
                "facts": [
                    "campus.housing_offered",
                    "campus.freshman_housing_guarantee",
                    "campus.housing_requirement",
                    "campus.housing_types",
                    "campus.students_in_housing_pct",
                    "campus.students_off_campus_pct",
                    "campus.off_campus_housing_assistance",
                ],
            },
            {
                "id": "greek-life",
                "title": "Greek life",
                "facts": [
                    "campus.fraternity_participation_pct",
                    "campus.sorority_participation_pct",
                ],
            },
            {
                "id": "activities",
                "title": "Activities and organizations",
                "facts": ["campus.activities", "campus.rotc", "campus.intramural_sports"],
            },
            {
                "id": "sports",
                "title": "Sports",
                "facts": [
                    "campus.athletic_conferences",
                    "campus.mascot",
                    "campus.school_colors",
                    "campus.varsity_sports",
                    "campus.club_sports",
                ],
            },
            {
                "id": "location",
                "title": "Location and getting around",
                "facts": [
                    "campus.city_population",
                    "campus.nearest_metro",
                    "campus.campus_acres",
                    "campus.nearest_bus_station",
                    "campus.nearest_train_station",
                    "campus.campus_map_url",
                ],
            },
            {
                "id": "safety-and-support",
                "title": "Safety and personal support",
                "facts": [
                    "campus.security_emergency_phones",
                    "campus.security_patrols_24h",
                    "campus.security_late_night_transport",
                    "campus.security_electronic_entrances",
                    "campus.security_other",
                    "campus.health_service",
                    "campus.personal_counseling",
                    "campus.child_care",
                ],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
    {
        "id": "outcomes",
        "title": "Outcomes",
        "groups": [
            {
                "id": "time-to-degree",
                "title": "Time to degree",
                "facts": [
                    "outcomes.retention_first_year",
                    "outcomes.graduation_rate_4y",
                    "outcomes.graduation_rate_5y",
                    "outcomes.graduation_rate_6y",
                ],
            },
            {
                "id": "debt",
                "title": "Debt at graduation",
                "facts": ["outcomes.graduates_with_loans_pct", "outcomes.average_indebtedness"],
            },
            {
                "id": "after-graduation",
                "title": "After graduation",
                "facts": [
                    "outcomes.employed_within_6_months",
                    "outcomes.average_starting_salary",
                    "outcomes.advanced_study_pct",
                    "outcomes.disciplines_pursued",
                ],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
    {
        "id": "applying",
        "title": "Applying",
        "groups": [
            {
                "id": "deadlines",
                "title": "Deadlines",
                "facts": [
                    "deadlines.regular",
                    "admissions.regular_deadline_is_rolling",
                    "deadlines.early_decision",
                    "deadlines.early_action",
                    "deadlines.financial_aid",
                    "deadlines.test_due_sat_or_act",
                    "deadlines.test_due_sat_only",
                    "deadlines.test_due_act_only",
                    "deadlines.test_due_act_writing_test_policy",
                    "deadlines.test_due_sat_subject_tests_only",
                    "deadlines.test_due_sat_and_sat_subject_tests_or_act",
                ],
            },
            {
                "id": "decision-notification",
                "title": "Decision notification",
                "facts": [
                    "deadlines.regular_notification",
                    "deadlines.early_action_notification",
                    "deadlines.reply_by",
                ],
            },
            {
                "id": "rounds-offered",
                "title": "Rounds offered",
                "facts": ["admissions.early_decision_offered", "admissions.early_action_offered"],
            },
            {
                "id": "how-to-apply",
                "title": "How to apply",
                "facts": [
                    "applying.accepts_common_app",
                    "applying.electronic_application_url",
                    "applying.application_fee",
                    "applying.application_fee_waiver",
                    "applying.deferred_enrollment",
                    "applying.transfer_accepted",
                ],
            },
            {
                "id": "contact",
                "title": "Admissions office",
                "facts": [
                    "applying.admissions_address",
                    "applying.admissions_phone",
                    "applying.admissions_fax",
                    "applying.admissions_email",
                    "applying.admissions_phone_direct",
                    "applying.admissions_fax_direct",
                ],
            },
            {"id": "other", "title": "Other published values", "facts": []},
        ],
    },
]


def _load_facts_keys_rules() -> list[dict[str, Any]]:
    with FACTS_KEYS_PATH.open(encoding="utf-8") as handle:
        asset = yaml.safe_load(handle)
    rules = asset.get("rules")
    if not isinstance(rules, list):
        raise ValueError("facts_keys.yaml must declare a top-level 'rules' list")
    return rules


def _candidates(rule: dict[str, Any]) -> list[str]:
    out = []
    if "fact_key" in rule:
        out.append(rule["fact_key"])
    out.extend(rule.get("produces", []))
    for field in ("pct_key", "count_key"):
        if field in rule:
            out.append(rule[field])
    return out


def owning_tab_for(fact_key: str, rules: list[dict[str, Any]]) -> str:
    """The tab that owns `fact_key`, per `facts_keys.yaml`'s per-rule `tab:`
    (exact match on a rule's `fact_key`/`produces`/`pct_key`/`count_key`, or
    that value plus a `_dimension` suffix — the generic shape every
    multi-fact handler's dimension suffixing follows; or a `key_prefix`/
    `key_prefixes` straight prefix match, for handlers that build one key
    per table row from a per-row label the yaml can't enumerate — the
    ordinal/units/test-policy tables), falling back to the small
    `_CODE_OWNED_TABS` table for the handful of facts built entirely in
    `app/facts/mapper.py` with no `facts_keys.yaml` rule at all."""
    for rule in rules:
        if rule.get("handler") == "drop":
            continue
        for candidate in _candidates(rule):
            if fact_key == candidate or fact_key.startswith(f"{candidate}_"):
                return str(rule["tab"])
        prefixes = list(rule.get("key_prefixes", []))
        if "key_prefix" in rule:
            prefixes.append(rule["key_prefix"])
        if any(fact_key.startswith(prefix) for prefix in prefixes):
            return str(rule["tab"])
    if fact_key in _CODE_OWNED_TABS:
        return _CODE_OWNED_TABS[fact_key]
    raise ValueError(f"no owning tab found for {fact_key!r} in facts_keys.yaml")


def build_sections() -> dict[str, Any]:
    rules = _load_facts_keys_rules()
    sections_out = []
    for section in _SECTIONS_SOURCE:
        section_tabs: set[str] = set()
        groups_out = []
        for group in section["groups"]:
            facts_out = []
            for fact_key in group["facts"]:
                tab = owning_tab_for(fact_key, rules)
                section_tabs.add(tab)
                fact = _fact(fact_key)
                fact["tab"] = tab
                facts_out.append(fact)
            group_out = {"id": group["id"], "title": group["title"]}
            if "foot_ref" in group:
                group_out["foot_ref"] = group["foot_ref"]
            if "foot" in group:
                group_out["foot"] = group["foot"]
            group_out["facts"] = facts_out
            groups_out.append(group_out)
        sections_out.append(
            {
                "id": section["id"],
                "title": section["title"],
                "tabs": sorted(section_tabs),
                "groups": groups_out,
            }
        )
    return {"version": 1, "sections": sections_out}


_HEADER = """\
# facts_sections.yaml — reader-facing section/group layout (plan §4.4).
#
# GENERATED FILE — do not hand-edit `tab:`/`tabs:`. Authored content (section/
# group ids and titles, each fact's `label:`, `foot:`/`foot_ref:`) lives in
# `scripts/build_facts_sections_tabs.py`'s `_SECTIONS_SOURCE`; regenerate with:
#
#     uv run python scripts/build_facts_sections_tabs.py
#
# Every key listed here renders "Not reported" when absent (plan §5.1). A
# fact_key the mapper emits that is not listed anywhere lands in its
# section's own "other" group, rendered as "Other published values".
"""


def render() -> str:
    """The complete file content this generator produces — a pure function
    of `_SECTIONS_SOURCE` and `facts_keys.yaml`, so a test can render into a
    scratch path and diff without mutating the committed file."""
    data = build_sections()
    body = yaml.safe_dump(
        data, sort_keys=False, default_flow_style=False, allow_unicode=True, width=100
    )
    return _HEADER + body


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    out_path = Path(args[0]) if args else OUTPUT_PATH
    out_path.write_text(render(), encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
