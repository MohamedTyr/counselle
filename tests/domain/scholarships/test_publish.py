"""Publish rules (plan §4 behaviours 1, 2, 30)."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from domain.scholarships.publish import (
    STALE_AFTER_DAYS,
    deadline_passed,
    is_stale,
    publish_problems,
)
from domain.scholarships.types import Deadline, ScholarshipDraft

TODAY = dt.date(2026, 10, 1)


def complete(**overrides: Any) -> ScholarshipDraft:
    data: dict[str, Any] = {
        "name": "Future Leaders Award",
        "sponsor": "Acme Foundation",
        "apply_url": "https://acme.org/apply",
        "source_url": "https://acme.org/scholarship",
        "award": {"kind": "fixed", "amount": 5000},
        "deadline": {"kind": "fixed", "date": "2027-03-01"},
        "eligibility": [{"kind": "state", "any_of": ["TX"]}],
        "last_checked_on": TODAY.isoformat(),
    }
    data.update(overrides)
    return ScholarshipDraft.model_validate(data)


def test_complete_record_has_no_problems() -> None:
    assert publish_problems(complete(), TODAY) == []


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"name": ""}, "basics"),
        ({"sponsor": "  "}, "basics"),
        ({"apply_url": ""}, "apply_url"),
        ({"award": {"kind": "fixed"}}, "award"),
        ({"award": {"kind": "fixed", "amount": 0}}, "award"),
        ({"award": {"kind": "range", "min": 1000}}, "award"),
        ({"award": {"kind": "range", "min": 0, "max": 0}}, "award"),
        ({"award": {"kind": "range", "min": 5000, "max": 1000}}, "award"),
        ({"eligibility": [{"kind": "major", "any_of": []}]}, "rules_complete"),
        ({"eligibility": [{"kind": "citizenship", "any_of": []}]}, "rules_complete"),
        ({"deadline": {"kind": "fixed"}}, "deadline"),
        ({"source_url": ""}, "source_url"),
        ({"last_checked_on": None}, "fresh"),
        (
            {"last_checked_on": (TODAY - dt.timedelta(days=STALE_AFTER_DAYS + 1)).isoformat()},
            "fresh",
        ),
    ],
)
def test_each_check_fails_alone(overrides: dict[str, Any], expected: str) -> None:
    assert publish_problems(complete(**overrides), TODAY) == [expected]


@pytest.mark.parametrize(
    "award",
    [
        {"kind": "range", "min": 0, "max": 2000},
        {"kind": "range", "min": 2000, "max": 2000},
        {"kind": "varies"},
        {"kind": "full_tuition"},
        {"kind": "full_ride"},
    ],
)
def test_awards_that_pass(award: dict[str, Any]) -> None:
    assert publish_problems(complete(award=award), TODAY) == []


def test_rolling_and_rule_without_choices_pass() -> None:
    draft = complete(
        deadline={"kind": "rolling"},
        eligibility=[{"kind": "first_gen"}, {"kind": "gpa_min", "value": 3.0}],
    )
    assert publish_problems(draft, TODAY) == []


def test_checked_exactly_at_threshold_is_fresh() -> None:
    edge = (TODAY - dt.timedelta(days=STALE_AFTER_DAYS)).isoformat()
    assert publish_problems(complete(last_checked_on=edge), TODAY) == []


def test_passed_fixed_deadline_is_not_a_problem() -> None:
    assert publish_problems(complete(deadline={"kind": "fixed", "date": "2026-03-01"}), TODAY) == []


def test_problems_come_in_checklist_order() -> None:
    draft = ScholarshipDraft()
    assert publish_problems(draft, TODAY) == [
        "basics",
        "apply_url",
        "award",
        "deadline",
        "source_url",
        "fresh",
    ]


def test_deadline_passed() -> None:
    assert deadline_passed(Deadline(kind="fixed", date=dt.date(2026, 9, 30)), TODAY)
    assert not deadline_passed(Deadline(kind="fixed", date=TODAY), TODAY)
    assert not deadline_passed(Deadline(kind="fixed"), TODAY)
    assert not deadline_passed(Deadline(kind="rolling", date=dt.date(2020, 1, 1)), TODAY)


def test_is_stale() -> None:
    assert is_stale(None, TODAY)
    assert is_stale(TODAY - dt.timedelta(days=STALE_AFTER_DAYS + 1), TODAY)
    assert not is_stale(TODAY - dt.timedelta(days=STALE_AFTER_DAYS), TODAY)
    assert not is_stale(TODAY, TODAY)
