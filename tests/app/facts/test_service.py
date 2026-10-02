"""Honesty-critical unit tests for the facts-page presenter (plan §5.1/§5.2).

These target the pure composition helpers directly (no DB) -- the five-
state distinction, a reported 0/false rendering at full weight, band
composition, deadline "Not offered" vs "Not reported", and the section-line
selection rules are exactly the CLAUDE.md honesty carve-out this module
exists for.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.facts.service import (
    _build_deadlines,
    _build_fact,
    _control,
    _kind_and_value,
    _partial_cause,
    _resolve_state,
    _section_line,
    _try_band,
    absence_display,
)
from counselle_db.catalog import SectionFact, SectionGroup
from counselle_db.models import FactValueRow
from domain.facts.state import section_state

_NOW = datetime(2026, 6, 1, tzinfo=UTC)


def _row(
    fact_key: str,
    *,
    value_num: float | None = None,
    value_text: str | None = None,
    value_bool: bool | None = None,
    value_date: date | None = None,
    value_type: str = "count",
    display: str = "1",
    value: object = None,
    reported_period: str | None = None,
    observed_at: datetime = _NOW,
) -> FactValueRow:
    return FactValueRow(
        fact_key=fact_key,
        tab="admission",
        section="getting-in",
        label=fact_key,
        value=value,
        display=display,
        unit=None,
        value_type=value_type,
        value_num=value_num,
        value_text=value_text,
        value_bool=value_bool,
        value_date=value_date,
        reported_period=reported_period,
        reported_period_year=None,
        observed_at=observed_at,
    )


def test_a_reported_zero_resolves_to_value_state_at_full_weight() -> None:
    row = _row("admissions.admit_rate", value_num=0.0, display="0%", value_type="percent")
    assert _resolve_state(row, "ok", True) == "value"
    kind, value = _kind_and_value(row)
    assert kind == "scalar"
    assert value == 0.0  # never dropped, never treated as absent


def test_a_reported_false_resolves_to_value_state_at_full_weight() -> None:
    row = _row(
        "admissions.early_decision_offered", value_bool=False, display="No", value_type="bool"
    )
    assert _resolve_state(row, "ok", True) == "value"
    _, value = _kind_and_value(row)
    assert value is False


def test_not_fetched_not_published_and_not_reported_are_distinct_words() -> None:
    assert absence_display(_resolve_state(None, "http_error", True), "http_error") == "Not checked"
    assert (
        absence_display(_resolve_state(None, "never_fetched", True), "never_fetched")
        == "Not checked yet"
    )
    assert absence_display(_resolve_state(None, "not_found", True), "not_found") == "Not on file"
    assert absence_display(_resolve_state(None, "ok", True), "ok") == "Not reported"


def test_not_collected_when_school_has_no_collegedata_row() -> None:
    assert _resolve_state(None, "never_fetched", False) == "not_collected"


def test_build_fact_never_renders_a_blank_display_for_an_absent_key() -> None:
    spec = SectionFact(key="admissions.admit_rate", label="Admit rate", tab="admission")
    fact = _build_fact(spec, None, "http_error", True)
    assert fact.state == "not_fetched"
    assert fact.display == "Not checked"
    assert fact.value is None


def test_deadline_row_reads_not_offered_never_not_reported_when_round_is_declined() -> None:
    group = SectionGroup(
        id="deadlines",
        label="Deadlines",
        foot=None,
        foot_ref=None,
        facts=(
            SectionFact(
                key="deadlines.early_decision", label="Early decision deadline", tab="admission"
            ),
        ),
    )
    facts_by_key = {
        "admissions.early_decision_offered": _row(
            "admissions.early_decision_offered", value_bool=False, display="No", value_type="bool"
        )
    }
    block = _build_deadlines(facts_by_key, {"admission": "ok"}, True, group)
    assert len(block.rows) == 1
    assert block.rows[0].display == "Not offered"
    assert block.rows[0].state == "value"
    assert block.rows[0].reported_period is None


def test_deadline_row_reads_not_offered_for_early_decision_2_when_ed_is_declined() -> None:
    group = SectionGroup(
        id="deadlines",
        label="Deadlines",
        foot=None,
        foot_ref=None,
        facts=(
            SectionFact(
                key="deadlines.early_decision_2",
                label="Early decision II deadline",
                tab="admission",
            ),
        ),
    )
    facts_by_key = {
        "admissions.early_decision_offered": _row(
            "admissions.early_decision_offered", value_bool=False, display="No", value_type="bool"
        )
    }
    block = _build_deadlines(facts_by_key, {"admission": "ok"}, True, group)
    assert len(block.rows) == 1
    assert block.rows[0].display == "Not offered"
    assert block.rows[0].state == "value"
    assert block.rows[0].reported_period is None


def test_deadline_row_reads_dates_when_a_school_offers_both_rounds() -> None:
    group = SectionGroup(
        id="deadlines",
        label="Deadlines",
        foot=None,
        foot_ref=None,
        facts=(
            SectionFact(
                key="deadlines.early_decision", label="Early decision deadline", tab="admission"
            ),
        ),
    )
    facts_by_key = {
        "admissions.early_decision_offered": _row(
            "admissions.early_decision_offered", value_bool=True, display="Yes", value_type="bool"
        ),
        "deadlines.early_decision": _row(
            "deadlines.early_decision",
            value_date=date(2026, 11, 1),
            display="November 1, 2026",
            value_type="date",
            reported_period="2026-27",
        ),
    }
    block = _build_deadlines(facts_by_key, {"admission": "ok"}, True, group)
    assert block.rows[0].display == "November 1, 2026"
    assert block.rows[0].date == "2026-11-01"
    assert "2026-27" in block.foot


def test_deadlines_foot_uses_the_oldest_observed_at_never_the_newest() -> None:
    group = SectionGroup(
        id="deadlines",
        label="Deadlines",
        foot=None,
        foot_ref=None,
        facts=(
            SectionFact(
                key="deadlines.regular", label="Regular decision deadline", tab="admission"
            ),
            SectionFact(
                key="deadlines.financial_aid", label="Financial aid deadline", tab="money-matters"
            ),
        ),
    )
    older = datetime(2026, 1, 1, tzinfo=UTC)
    newer = datetime(2026, 6, 1, tzinfo=UTC)
    facts_by_key = {
        "deadlines.regular": _row(
            "deadlines.regular", display="January 2, 2027", value_type="date", observed_at=newer
        ),
        "deadlines.financial_aid": _row(
            "deadlines.financial_aid", display="March 1, 2027", value_type="date", observed_at=older
        ),
    }
    block = _build_deadlines(facts_by_key, {"admission": "ok", "money-matters": "ok"}, True, group)
    # `older` (January) must win the foot's month even though `newer` (June)
    # is the more recently observed row -- the oldest observed_at is what
    # governs the freshness claim, never the newest.
    assert block.foot.startswith("Dates last confirmed January 2026")


def test_deadlines_foot_drops_the_confirmed_clause_when_no_row_has_a_date() -> None:
    group = SectionGroup(
        id="deadlines",
        label="Deadlines",
        foot=None,
        foot_ref=None,
        facts=(
            SectionFact(
                key="deadlines.regular", label="Regular decision deadline", tab="admission"
            ),
        ),
    )
    block = _build_deadlines({}, {"admission": "http_error"}, True, group)
    assert block.foot == "Confirm on the school's site before you apply."


def test_band_composition_merges_p25_and_p75_into_one_fact_with_no_duplicate_rows() -> None:
    group_facts = (
        SectionFact(
            key="class_profile.sat_math_p25", label="SAT Math 25th percentile", tab="admission"
        ),
        SectionFact(
            key="class_profile.sat_math_p75", label="SAT Math 75th percentile", tab="admission"
        ),
    )
    facts_by_key = {
        "class_profile.sat_math_p25": _row(
            "class_profile.sat_math_p25", value_num=650, display="650", value_type="count"
        ),
        "class_profile.sat_math_p75": _row(
            "class_profile.sat_math_p75", value_num=740, display="740", value_type="count"
        ),
    }
    result = _try_band(group_facts[0], group_facts, facts_by_key, {"admission": "ok"}, True)
    assert result is not None
    band, consumed = result
    assert consumed == {"class_profile.sat_math_p25", "class_profile.sat_math_p75"}
    assert band.kind == "band"
    assert band.value == {
        "p25": 650,
        "p75": 740,
        "min": 200,
        "max": 800,
        "submitted_percent": None,
    }


def test_section_line_names_the_partial_cause_not_a_generic_failure() -> None:
    assert _section_line(
        "partial", False, "Getting in", {"admission": "not_found", "overview": "ok"}, None
    ) == ("We don't hold part of this section for this school.")
    assert (
        _section_line(
            "partial", False, "Getting in", {"admission": "http_error", "overview": "ok"}, None
        )
        == "Part of this section couldn't be re-checked on the last run."
    )
    assert _partial_cause({"admission": "not_found", "overview": "http_error"}).startswith(
        "We don't hold part of this section for this school, and part"
    )


def test_a_not_fetched_section_with_a_surviving_value_gets_the_recheck_line() -> None:
    surviving = datetime(2026, 3, 1, tzinfo=UTC)
    line = _section_line("not_fetched", False, "Money", {"money-matters": "http_error"}, surviving)
    assert (
        line == "We couldn't re-check this page on the last run — these values are from March 2026."
    )


def test_never_fetched_section_reads_havent_checked_never_couldnt_read() -> None:
    assert _section_line(
        "not_fetched", True, "Money", {"money-matters": "never_fetched"}, None
    ) == ("We haven't checked this page yet.")
    assert _section_line("not_fetched", False, "Money", {"money-matters": "http_error"}, None) == (
        "We couldn't read this page on the last check."
    )


def test_a_not_published_page_reads_not_on_file_never_a_read_failure() -> None:
    """The Phase 2 exit test's Phoenix case: a page CollegeData genuinely
    does not publish (`money-matters` -> `not_found`) is `not_published`,
    never described as a page the crawler failed to read."""
    fetch_state, never_checked = section_state({"money-matters": "not_found"})
    assert fetch_state == "not_published"
    line = _section_line(fetch_state, never_checked, "Money", {"money-matters": "not_found"}, None)
    assert line == "We don't hold this school's Money information."
    assert "couldn't read" not in line


def test_not_for_profit_control_must_not_match_for_profit() -> None:
    """Honesty regression: a bare `"for-profit" in sector.lower()` substring
    test also matches inside "not-for-profit", which mislabels every
    nonprofit private school (1,545 live schools, including Yale) as
    for-profit. `_control` must read `classification.control` directly."""
    basic_profile = {
        "classification": {
            "control": "Private not-for-profit",
            "sector": "Private not-for-profit, 4-year or above",
        }
    }
    assert _control(basic_profile) == "private"


def test_control_maps_every_live_vocabulary_value_and_falls_back_to_unknown() -> None:
    assert _control({"classification": {"control": "Public"}}) == "public"
    assert _control({"classification": {"control": "Private for-profit"}}) == "private_for_profit"
    assert _control({"classification": {"control": "Private not-for-profit"}}) == "private"
    # Unrecognised/missing control is an honest unknown, never a guess.
    assert _control({"classification": {"control": "Something New"}}) is None
    assert _control({"classification": {}}) is None
    assert _control({}) is None


def test_kind_and_value_attaches_the_absence_word_to_distribution_buckets() -> None:
    """Finding 5 (Phase 2 review): the not-reported/omitted-bucket absence
    word is composed once, here -- `FactDistributionChart.tsx` renders it
    verbatim and must never hardcode it client-side."""
    row = _row(
        "class_profile.sat_math_distribution",
        value_type="distribution",
        display="1 of 2 buckets reported",
        value={
            "kind": "distribution",
            "value": {
                "scale": "SAT Math score",
                "buckets": [
                    {"label": "700-800", "pct": 40},
                    {"label": "500-599", "absence": "not_reported"},
                ],
                "omitted_buckets": ["Below 500"],
                "sums_to": 40,
            },
        },
    )
    kind, value = _kind_and_value(row)
    assert kind == "distribution"
    buckets = {b["label"]: b for b in value["buckets"]}
    assert buckets["700-800"].get("absence_display") is None
    assert buckets["500-599"]["absence_display"] == "Not reported"
    assert value["omitted_buckets"] == [{"label": "Below 500", "display": "Not reported"}]
