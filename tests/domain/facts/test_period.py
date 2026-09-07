"""The three site-wide reporting-period markers and the deadline cycle-year
roll (plan §4.4) — table-driven because each marker's absence case (no year
present) is the one that matters: it must produce `None`, never a guess.
"""

import pytest

from domain.facts.period import (
    SectionPeriod,
    deadline_reported_period,
    parse_bare_month_day,
    parse_financial_aid_title,
    parse_graduates_title,
    resolve_deadline_date,
)

FINANCIAL_AID_CASES = [
    ("Profile of 2025-26 Financial Aid", SectionPeriod("2025-26", 2025)),
    ("Profile of  Financial Aid", None),  # Santa Monica College — no year printed
    ("Freshman Admission Requirements", None),
]


@pytest.mark.parametrize("title,expected", FINANCIAL_AID_CASES)
def test_parse_financial_aid_title(title: str, expected: SectionPeriod | None) -> None:
    assert parse_financial_aid_title(title) == expected


GRADUATES_CASES = [
    ("Retention and Graduation Rates of 2024 Graduates", SectionPeriod("2024", 2024)),
    ("Class Size", None),
]


@pytest.mark.parametrize("title,expected", GRADUATES_CASES)
def test_parse_graduates_title(title: str, expected: SectionPeriod | None) -> None:
    assert parse_graduates_title(title) == expected


BARE_MONTH_DAY_CASES = [
    ("November 1", (11, 1)),
    ("January 2", (1, 2)),
    ("Rolling", None),
    ("", None),
]


@pytest.mark.parametrize("raw,expected", BARE_MONTH_DAY_CASES)
def test_parse_bare_month_day(raw: str, expected: tuple[int, int] | None) -> None:
    assert parse_bare_month_day(raw) == expected


# The cycle year is YEAR(admission.admissionDeadlineDate); an August-December
# deadline rolls back one year from it, January-July does not.
DEADLINE_ROLL_CASES = [
    ((11, 1), 2027, (2026, 11, 1)),  # November — previous year
    ((12, 31), 2027, (2026, 12, 31)),  # December — previous year
    ((8, 1), 2027, (2026, 8, 1)),  # August boundary — previous year
    ((1, 15), 2027, (2027, 1, 15)),  # January — same year
    ((7, 31), 2027, (2027, 7, 31)),  # July boundary — same year
]


@pytest.mark.parametrize("month_day,cycle_year,expected", DEADLINE_ROLL_CASES)
def test_resolve_deadline_date_rolls_across_the_cycle_year(
    month_day: tuple[int, int], cycle_year: int, expected: tuple[int, int, int]
) -> None:
    month, day = month_day
    resolved = resolve_deadline_date(month, day, cycle_year)
    assert (resolved.year, resolved.month, resolved.day) == expected


def test_deadline_reported_period_is_the_cross_tab_anchor_year_span() -> None:
    assert deadline_reported_period(2027) == "2026-27"
    assert deadline_reported_period(2020) == "2019-20"
