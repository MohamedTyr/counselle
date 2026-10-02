"""Honesty tests for the calendar's all-schools deadlines.

`inherited_date`'s own branches are covered in `tests/domain/facts/test_inherit.py`;
these prove the calendar honours it, the "not offered" rule, and the catalog.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, cast

from app.facts.calendar import build_school_deadline_calendar
from counselle_db.catalog import Catalog

_NOW = datetime(2026, 10, 1, tzinfo=UTC)
_OBSERVED = datetime(2026, 9, 20, tzinfo=UTC)
_PERIOD = "2026-27"


class _FakeCatalog:
    def __init__(self, names: dict[int, str]) -> None:
        self._names = names

    @property
    def school_count(self) -> int:
        return 2746

    def school_name(self, unitid: int) -> str | None:
        return self._names.get(unitid)

    def school_domain(self, unitid: int) -> str | None:
        return f"school{unitid}.edu" if unitid in self._names else None


_CATALOG = cast(Catalog, _FakeCatalog({1: "Alpha College", 2: "Beta University", 3: "Gamma"}))


def _row(
    unitid: int,
    key: str,
    *,
    on: date | None = None,
    flag: bool | None = None,
    period: str | None = _PERIOD,
) -> dict[str, Any]:
    return {
        "school_id": unitid,
        "fact_key": key,
        "value_date": on,
        "value_bool": flag,
        "reported_period": period,
        "observed_at": _OBSERVED,
    }


def _build(rows: list[dict[str, Any]], catalog: Catalog = _CATALOG) -> Any:
    return build_school_deadline_calendar(rows, catalog, cycle_year=2027, stale_days=120, now=_NOW)


def test_a_row_inherited_date_rejects_is_dropped() -> None:
    result = _build(
        [
            _row(1, "deadlines.regular", on=date(2027, 1, 1), period="2025-26"),
            _row(2, "deadlines.regular", on=date(2027, 1, 1)),
        ]
    )
    assert [item.unitid for item in result.items] == [2]


def test_a_round_reported_not_offered_is_dropped() -> None:
    ed = date(2026, 11, 1)
    result = _build(
        [
            _row(1, "deadlines.early_decision", on=ed),
            _row(1, "admissions.early_decision_offered", flag=False),
            _row(2, "deadlines.early_decision", on=ed),
            _row(2, "admissions.early_decision_offered", flag=True),
            _row(3, "deadlines.early_decision", on=ed),
        ]
    )
    assert [item.unitid for item in result.items] == [2, 3]


def test_a_school_the_catalog_cannot_name_is_dropped() -> None:
    result = _build([_row(99, "deadlines.regular", on=date(2027, 1, 1))])
    assert result.items == []


def test_every_round_key_maps_to_its_round() -> None:
    keys = {
        "deadlines.early_decision": "ED",
        "deadlines.early_decision_2": "ED2",
        "deadlines.early_action": "EA",
        "deadlines.early_action_2": "EA2",
        "deadlines.regular": "RD",
    }
    result = _build([_row(1, key, on=date(2026, 11, 1)) for key in keys])
    assert sorted(item.round for item in result.items) == sorted(keys.values())
    assert result.items[0].website_url == "https://school1.edu"
    assert result.items[0].checked_at == _OBSERVED.date()


def test_schools_with_dates_counts_distinct_schools() -> None:
    result = _build(
        [
            _row(1, "deadlines.early_decision", on=date(2026, 11, 1)),
            _row(1, "deadlines.regular", on=date(2027, 1, 1)),
            _row(2, "deadlines.regular", on=date(2027, 1, 1)),
        ]
    )
    assert result.schools_with_dates == 2
    assert result.schools_total == 2746
    assert result.reported_period == _PERIOD


def test_items_sort_by_date_then_school_name() -> None:
    result = _build(
        [
            _row(2, "deadlines.regular", on=date(2027, 1, 1)),
            _row(1, "deadlines.regular", on=date(2027, 1, 1)),
            _row(3, "deadlines.early_action", on=date(2026, 11, 1)),
        ]
    )
    assert [(item.date, item.school_name) for item in result.items] == [
        (date(2026, 11, 1), "Gamma"),
        (date(2027, 1, 1), "Alpha College"),
        (date(2027, 1, 1), "Beta University"),
    ]
