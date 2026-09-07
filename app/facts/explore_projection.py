"""`school_explore_rows` projection (plan §3.1/§4.2, Unit E).

Two input sources, combined into one dict keyed by
`adapters.facts_store.EXPLORE_COLUMNS`:

- **IPEDS filter columns** (region/locale/control/institution_level/
  gender_model/religious_affiliation/hbcu/hsi/tribal/land_grant) — always
  derivable from `schools.basic_profile`, verified against the live
  `cds_library.schools` shape (`identity_and_mission`/`classification`/
  `location` sub-objects).
- **CollegeData-derived columns** — projected from the school's *current*
  `school_facts` rows (not just this pass's diff — plan §4.2: the explore
  row reflects the full current fact state) via a fixed `fact_key ->
  column` table.

This unit does **not** attempt the SAT/ACT-percentile, admit-rate, or
sports-by-gender columns appendix E-iv drafts — those live inside
`distribution`/`matrix`-kind `NormalizedValue.value` payloads whose bucket
shape is the mapper's (Unit D's) domain, not derivable from a fact_key ->
column table alone. Every such column stays `NULL` — a legitimate "not yet
projected" state, never invented. See Unit E's final report.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import asyncpg

from adapters.facts_store import EXPLORE_COLUMNS

__all__ = ["project_explore_row"]


def _as_int(record: asyncpg.Record) -> int | None:
    return int(record["value_num"]) if record["value_num"] is not None else None


def _as_float(record: asyncpg.Record) -> float | None:
    return float(record["value_num"]) if record["value_num"] is not None else None


def _as_bool(record: asyncpg.Record) -> bool | None:
    return record["value_bool"]  # type: ignore[no-any-return]


def _as_date(record: asyncpg.Record) -> Any:
    return record["value_date"]


def _as_display(record: asyncpg.Record) -> str | None:
    value = record["value"]
    display = value.get("value") if isinstance(value, dict) else None
    return record["value_text"] if record["value_text"] is not None else (
        display if isinstance(display, str) else None
    )


def _as_list(record: asyncpg.Record) -> list[str] | None:
    value = record["value"]
    items = value.get("value") if isinstance(value, dict) else None
    if isinstance(items, dict):
        items = items.get("items")
    return [str(item) for item in items] if isinstance(items, list) else None


# fact_key -> (explore column, extractor). Every column named here must be
# in `adapters.facts_store.EXPLORE_COLUMNS`.
_FACT_KEY_MAP: Mapping[str, tuple[str, Callable[[asyncpg.Record], Any]]] = {
    "students.undergraduate_total": ("undergraduates", _as_int),
    "students.graduate_total": ("graduate_students", _as_int),
    "students.undergraduate_full_time": ("undergraduate_full_time", _as_int),
    "students.international_pct": ("international_pct", _as_float),
    "class_profile.average_gpa": ("gpa_avg", _as_float),
    "class_profile.sat_math_p25": ("sat_math_p25", _as_int),
    "class_profile.sat_math_p75": ("sat_math_p75", _as_int),
    "class_profile.sat_ebrw_p25": ("sat_ebrw_p25", _as_int),
    "class_profile.sat_ebrw_p75": ("sat_ebrw_p75", _as_int),
    "class_profile.act_composite_p25": ("act_composite_p25", _as_int),
    "class_profile.act_composite_p75": ("act_composite_p75", _as_int),
    "class_profile.act_composite_avg": ("act_composite_avg", _as_float),
    "admissions.admit_rate": ("admit_rate", _as_float),
    "admissions.admit_rate_women": ("admit_rate_women", _as_float),
    "admissions.admit_rate_men": ("admit_rate_men", _as_float),
    "admissions.applicants_total": ("applicants_total", _as_int),
    "admissions.admitted_total": ("admitted_total", _as_int),
    "admissions.enrolled_total": ("enrolled_total", _as_int),
    "admissions.yield_rate": ("yield_rate", _as_float),
    "admissions.entrance_difficulty": ("entrance_difficulty", _as_display),
    "aid.avg_percent_need_met_all_undergraduates": ("need_met_pct", _as_float),
    "admissions.regular_deadline_is_rolling": ("is_rolling", _as_bool),
    "deadlines.regular": ("deadline_regular", _as_date),
    "applying.application_fee": ("application_fee", _as_int),
    "applying.application_fee_waiver": ("application_fee_waiver", _as_bool),
    "applying.accepts_common_app": ("accepts_common_app", _as_bool),
    "admissions.early_decision_offered": ("offers_early_decision", _as_bool),
    "admissions.early_action_offered": ("offers_early_action", _as_bool),
    "admissions.waitlist_used": ("waitlist_used", _as_bool),
    "costs.room_and_board": ("room_and_board", _as_int),
    "costs.books_and_supplies": ("books_and_supplies", _as_int),
    "costs.other_expenses": ("other_expenses", _as_int),
    "costs.attendance_in_state": ("cost_attendance_in_state", _as_int),
    "costs.attendance_out_of_state": ("cost_attendance_out_of_state", _as_int),
    "costs.tuition_fees_in_state": ("tuition_in_state", _as_int),
    "costs.tuition_fees_out_of_state": ("tuition_out_of_state", _as_int),
    "outcomes.average_indebtedness": ("avg_indebtedness", _as_int),
    "outcomes.graduates_with_loans_pct": ("graduates_with_loans_pct", _as_float),
    "outcomes.retention_first_year": ("retention_pct", _as_float),
    "outcomes.graduation_rate_4y": ("grad_rate_4y", _as_float),
    "outcomes.graduation_rate_5y": ("grad_rate_5y", _as_float),
    "outcomes.graduation_rate_6y": ("grad_rate_6y", _as_float),
    "faculty.full_time_count": ("faculty_full_time", _as_int),
    "faculty.part_time_count": ("faculty_part_time", _as_int),
    "faculty.terminal_degree_pct": ("faculty_terminal_pct", _as_float),
    "campus.students_in_housing_pct": ("housing_pct", _as_float),
    "campus.fraternity_participation_pct": ("greek_pct_men", _as_float),
    "campus.sorority_participation_pct": ("greek_pct_women", _as_float),
    "academics.calendar": ("calendar", _as_display),
    "academics.undergraduate_majors": ("majors", _as_list),
    "academics.special_programs": ("special_programs", _as_list),
}


def _control_from_classification(control: str | None, sector: str | None) -> str:
    if control == "Public":
        return "public"
    if sector and "for-profit" in sector.lower():
        return "private_for_profit"
    return "private"


def _ipeds_filter_columns(basic_profile: Mapping[str, Any]) -> dict[str, Any]:
    location = basic_profile.get("location") or {}
    classification = basic_profile.get("classification") or {}
    identity = basic_profile.get("identity_and_mission") or {}
    gender_model = "coed"
    if identity.get("men_only"):
        gender_model = "men"
    elif identity.get("women_only"):
        gender_model = "women"
    return {
        "region": location.get("region") or "Unknown",
        "locale": location.get("locale"),
        "control": _control_from_classification(
            classification.get("control"), classification.get("sector")
        ),
        "institution_level": classification.get("institution_level"),
        "gender_model": gender_model,
        "religious_affiliation": identity.get("religious_affiliation"),
        "hbcu": bool(identity.get("hbcu", False)),
        "hsi": identity.get("hsi"),
        "tribal": bool(identity.get("tribal", False)),
        "land_grant": bool(identity.get("land_grant", False)),
    }


def project_explore_row(
    basic_profile: Mapping[str, Any], current_facts: list[asyncpg.Record]
) -> dict[str, Any]:
    """Every `EXPLORE_COLUMNS` key, `None` for anything not derivable."""
    values: dict[str, Any] = dict.fromkeys(EXPLORE_COLUMNS)
    values.update(_ipeds_filter_columns(basic_profile))
    for record in current_facts:
        mapping = _FACT_KEY_MAP.get(record["fact_key"])
        if mapping is None:
            continue
        column, extractor = mapping
        values[column] = extractor(record)
    majors = values.get("majors")
    values["majors_count"] = len(majors) if isinstance(majors, list) else None
    # NO sat_total_p25/p75 (R14/D10): the 25th percentile of a combined SAT
    # score is not the sum of the two section 25th percentiles -- that
    # would be a fabricated value, not an observed or honestly-derived one.
    # A real combined-SAT band is a Phase 2 concern only if CollegeData
    # itself ever reports one as its own fact -- never synthesized here.
    return values
