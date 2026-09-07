"""Reporting-period parsing (plan §4.4): the three year-bearing markers, and
the deadline cycle-year anchor/roll rule.

Exactly three markers carry a `reported_period` anywhere on CollegeData:
the anchored regular admission deadline, an optional "Profile of YYYY-YY
Financial Aid" section title (which propagates to every descendant fact
unless the fact carries its own), and "... of YYYY Graduates". Nothing else
sets one — `identity.description` prose is excluded, and a section title
with no year present (`"Profile of  Financial Aid"`, Santa Monica College)
yields **no suffix at all**, never a fabricated one. That is the load-bearing
property of every function here: absence in, `None` out, never a guess.

The deadline anchor/roll itself is cross-tab (it needs the admission tab's
own anchored date, or last pass's stored fact, neither of which this pure
module can read) — `app/facts/mapper.py` owns sourcing `cycle_year`; this
module owns only the arithmetic once `cycle_year` is known.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

__all__ = [
    "SectionPeriod",
    "deadline_reported_period",
    "parse_bare_month_day",
    "parse_graduates_title",
    "parse_financial_aid_title",
    "resolve_deadline_date",
]


@dataclass(frozen=True, slots=True)
class SectionPeriod:
    """A parsed `reported_period` + its start year, ready to stamp onto a `FactRow`."""

    reported_period: str
    reported_period_year: int


_FINANCIAL_AID_TITLE_RE = re.compile(
    r"Profile of\s+(?P<start>\d{4})-(?P<end>\d{2,4})\s+Financial Aid", re.IGNORECASE
)


def parse_financial_aid_title(title: str) -> SectionPeriod | None:
    """`"Profile of 2025-26 Financial Aid"` -> `("2025-26", 2025)`.

    `"Profile of  Financial Aid"` (no year present, Santa Monica College) has
    no digits to match and correctly yields `None` — never a fabricated year.
    """
    match = _FINANCIAL_AID_TITLE_RE.search(title)
    if not match:
        return None
    start = int(match["start"])
    end_suffix = match["end"][-2:]
    return SectionPeriod(reported_period=f"{start}-{end_suffix}", reported_period_year=start)


_GRADUATES_TITLE_RE = re.compile(r"of\s+(?P<year>\d{4})\s+Graduates", re.IGNORECASE)


def parse_graduates_title(title: str) -> SectionPeriod | None:
    """`"... of 2024 Graduates"` -> `("2024", 2024)`."""
    match = _GRADUATES_TITLE_RE.search(title)
    if not match:
        return None
    year = int(match["year"])
    return SectionPeriod(reported_period=str(year), reported_period_year=year)


_MONTH_BY_NAME = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_MONTH_DAY_RE = re.compile(r"^(?P<month>[A-Za-z]+)\s+(?P<day>\d{1,2})$")


def parse_bare_month_day(raw: str) -> tuple[int, int] | None:
    """`"November 1"` -> `(11, 1)`. Returns `None` for anything else (e.g. `"Rolling"`)."""
    match = _MONTH_DAY_RE.match(raw.strip())
    if not match:
        return None
    month = _MONTH_BY_NAME.get(match["month"].lower())
    if month is None:
        return None
    return month, int(match["day"])


def resolve_deadline_date(month: int, day: int, cycle_year: int) -> date:
    """Roll a bare month-day deadline onto the admission cycle's anchor year.

    August-December resolves to `cycle_year - 1`; January-July resolves to
    `cycle_year` itself (§4.4's year-roll rule) — e.g. a `cycle_year` of 2027
    (from `admissionDeadlineDate = "2027-01-02"`) rolls a November deadline
    to 2026 and a March deadline to 2027.
    """
    year = cycle_year - 1 if month >= 8 else cycle_year
    return date(year, month, day)


def deadline_reported_period(cycle_year: int) -> str:
    """The `reported_period` every anchored deadline fact carries, e.g. `2027 -> "2026-27"`."""
    return f"{cycle_year - 1}-{cycle_year % 100:02d}"
