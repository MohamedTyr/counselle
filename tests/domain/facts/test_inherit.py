"""Application-deadline inheritance from the facts store (plan §4 B1/B3) —
honesty-critical, so hard-tested: a mismatched cycle, a missing cycle, a
stale observation, or a dateless fact (rolling) must never produce a date."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import get_args

from app.workspace.models import Round
from domain.facts.inherit import (
    AID_FACT_KEY,
    ROUND_FACT_KEY,
    DeadlineFact,
    InheritedDate,
    inherited_date,
)

NOW = datetime(2026, 9, 20, tzinfo=UTC)


def _fact(
    *,
    value_date: date | None = date(2026, 11, 1),
    reported_period: str | None = "2026-27",
    observed_at: datetime | None = None,
) -> DeadlineFact:
    return DeadlineFact(
        value_date=value_date,
        reported_period=reported_period,
        observed_at=observed_at if observed_at is not None else NOW,
    )


def test_matching_fact_inherits_with_its_observed_date() -> None:
    fact = _fact(observed_at=datetime(2026, 9, 1, tzinfo=UTC))

    result = inherited_date(fact, cycle_year=2027, stale_days=120, now=NOW)

    assert result == InheritedDate(date=date(2026, 11, 1), checked_at=date(2026, 9, 1))


def test_no_fact_returns_none() -> None:
    assert inherited_date(None, cycle_year=2027, stale_days=120, now=NOW) is None


def test_cycle_mismatch_returns_none() -> None:
    fact = _fact(reported_period="2025-26")

    assert inherited_date(fact, cycle_year=2027, stale_days=120, now=NOW) is None


def test_missing_cycle_year_returns_none() -> None:
    fact = _fact()

    assert inherited_date(fact, cycle_year=None, stale_days=120, now=NOW) is None


def test_stale_fact_returns_none() -> None:
    fact = _fact(observed_at=datetime(2026, 1, 1, tzinfo=UTC))

    assert inherited_date(fact, cycle_year=2027, stale_days=120, now=NOW) is None


def test_rolling_fact_with_no_dated_value_returns_none() -> None:
    fact = _fact(value_date=None)

    assert inherited_date(fact, cycle_year=2027, stale_days=120, now=NOW) is None


def test_fact_with_no_observed_at_returns_none() -> None:
    fact = DeadlineFact(
        value_date=date(2026, 11, 1), reported_period="2026-27", observed_at=None
    )

    assert inherited_date(fact, cycle_year=2027, stale_days=120, now=NOW) is None


def test_round_fact_key_covers_every_round_with_a_dated_deadline() -> None:
    rounds = set(get_args(Round))
    assert set(ROUND_FACT_KEY) == rounds - {"Rolling", "Priority"}
    assert ROUND_FACT_KEY["REA"] == ROUND_FACT_KEY["EA"] == "deadlines.early_action"


def test_aid_fact_key_is_the_financial_aid_deadline() -> None:
    assert AID_FACT_KEY == "deadlines.financial_aid"
