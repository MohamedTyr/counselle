"""Unit tests for `app/facts/mapper_handlers.py::text_fallback_date`'s
`second_key` rung (plan §3 A1) — the ED I/ED II, EA I/EA II comma-pair
split, and its fallthrough cases.
"""

from __future__ import annotations

from datetime import date

from app.facts.mapper_handlers import text_fallback_date


def test_second_key_splits_a_comma_pair_of_bare_month_days() -> None:
    facts = text_fallback_date(
        "November 1, January 1",
        base_key="deadlines.early_decision",
        cycle_year=2027,
        second_key="deadlines.early_decision_2",
    )
    assert len(facts) == 2

    first, second = facts
    assert first.fact_key == "deadlines.early_decision"
    assert first.value is not None
    assert first.value.value_date == date(2026, 11, 1)
    assert first.value.display == "November 1"
    assert first.reported_period == "2026-27"

    assert second.fact_key == "deadlines.early_decision_2"
    assert second.value is not None
    assert second.value.value_date == date(2027, 1, 1)
    assert second.value.display == "January 1"
    assert second.reported_period == "2026-27"


def test_second_key_leaves_a_single_date_as_one_fact() -> None:
    facts = text_fallback_date(
        "November 1",
        base_key="deadlines.early_action",
        cycle_year=2027,
        second_key="deadlines.early_action_2",
    )
    assert len(facts) == 1
    assert facts[0].fact_key == "deadlines.early_action"
    assert facts[0].value is not None
    assert facts[0].value.value_date == date(2026, 11, 1)


def test_a_comma_pair_with_no_second_key_configured_stays_text() -> None:
    facts = text_fallback_date(
        "November 1, January 1",
        base_key="deadlines.early_decision",
        cycle_year=2027,
        second_key=None,
    )
    assert len(facts) == 1
    assert facts[0].fact_key == "deadlines.early_decision"
    assert facts[0].value is not None
    assert facts[0].value.kind == "text"
    assert facts[0].value.value_date is None


def test_rolling_stays_text_even_with_second_key_configured() -> None:
    facts = text_fallback_date(
        "Rolling",
        base_key="deadlines.regular",
        cycle_year=2027,
        second_key="deadlines.early_decision_2",
    )
    assert len(facts) == 1
    assert facts[0].value is not None
    assert facts[0].value.kind == "text"
    assert facts[0].value.value_date is None


def test_a_pair_where_the_second_half_is_not_a_bare_month_day_stays_text() -> None:
    facts = text_fallback_date(
        "November 1, or rolling thereafter",
        base_key="deadlines.early_decision",
        cycle_year=2027,
        second_key="deadlines.early_decision_2",
    )
    assert len(facts) == 1
    assert facts[0].fact_key == "deadlines.early_decision"
    assert facts[0].value is not None
    assert facts[0].value.kind == "text"
    assert facts[0].value.value_date is None
