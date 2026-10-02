"""Application-deadline inheritance from the facts store (plan §4 B1).

A student's `applications.deadline`/`aid_deadline` are overrides; a `None`
column means "inherit from Counselle's data for this round and cycle." This
module is the pure rule for that inheritance — it never touches the DB or
`app/`, per ADR 0017.

`ROUND_FACT_KEY` records one judgment: CollegeData files a single-choice
early-action program (Yale's SCEA/REA) under its plain "Early Action" row, so
a student who picked REA inherits the EA date. `Rolling` and `Priority` have
no fact to inherit — a rolling school has no deadline, which is correct.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime

from domain.facts.period import deadline_reported_period
from domain.facts.state import is_stale

__all__ = [
    "AID_FACT_KEY",
    "ROUND_FACT_KEY",
    "DeadlineFact",
    "OFFERED_KEY_FOR_DEADLINE",
    "InheritedDate",
    "inherited_date",
]

ROUND_FACT_KEY: dict[str, str] = {
    "EA": "deadlines.early_action",
    "REA": "deadlines.early_action",
    "ED": "deadlines.early_decision",
    "ED2": "deadlines.early_decision_2",
    "RD": "deadlines.regular",
}
AID_FACT_KEY = "deadlines.financial_aid"
# A round whose program flag is reported `False` has no deadline to show,
# whatever date the deadline row itself carries.
OFFERED_KEY_FOR_DEADLINE: dict[str, str] = {
    "deadlines.early_decision": "admissions.early_decision_offered",
    "deadlines.early_decision_2": "admissions.early_decision_offered",
    "deadlines.early_action": "admissions.early_action_offered",
    "deadlines.early_action_2": "admissions.early_action_offered",
}


@dataclass(frozen=True, slots=True)
class DeadlineFact:
    value_date: Date | None
    reported_period: str | None
    observed_at: datetime | None


@dataclass(frozen=True, slots=True)
class InheritedDate:
    date: Date
    checked_at: Date


def inherited_date(
    fact: DeadlineFact | None, *, cycle_year: int | None, stale_days: int, now: datetime
) -> InheritedDate | None:
    """The facts-store date for one round/cycle, or `None` when nothing is inheritable.

    `None` covers every miss on purpose: no fact row, no cycle to anchor to
    (legacy applications never inherit), a fact reported for a different
    cycle than the student's own, a fact with no dated value (e.g. a rolling
    regular deadline), a fact with no observation time to attribute the date
    to, or a fact old enough to be stale.
    """
    if fact is None or cycle_year is None or fact.value_date is None:
        return None
    if fact.reported_period != deadline_reported_period(cycle_year):
        return None
    if is_stale(fact.observed_at, stale_days, now=now):
        return None
    if fact.observed_at is None:
        return None
    return InheritedDate(date=fact.value_date, checked_at=fact.observed_at.date())
