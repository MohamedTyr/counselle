"""Every profiled school's round deadlines for one admissions cycle.

The calendar's "All schools" layer. Each row passes through the same two rules
the rest of the app already applies to a deadline, so the calendar never shows
a date those rules would reject: `inherited_date` (in-cycle, dated, observed,
not stale) and the facts page's "not offered" rule.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date as Date
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.workspace.service_utils import website_url
from counselle_db.catalog import Catalog
from domain.facts.inherit import OFFERED_KEY_FOR_DEADLINE, DeadlineFact, inherited_date
from domain.facts.period import deadline_reported_period

__all__ = [
    "CALENDAR_ROUND_KEYS",
    "CalendarRound",
    "SchoolDeadlineCalendar",
    "SchoolDeadlineItem",
    "build_school_deadline_calendar",
    "school_deadline_calendar",
]

CalendarRound = Literal["ED", "ED2", "EA", "EA2", "RD"]

CALENDAR_ROUND_KEYS: dict[str, CalendarRound] = {
    "deadlines.early_decision": "ED",
    "deadlines.early_decision_2": "ED2",
    "deadlines.early_action": "EA",
    "deadlines.early_action_2": "EA2",
    "deadlines.regular": "RD",
}

_FACT_KEYS = sorted({*CALENDAR_ROUND_KEYS, *OFFERED_KEY_FOR_DEADLINE.values()})


class SchoolDeadlineItem(BaseModel):
    unitid: int
    school_name: str
    website_url: str | None
    round: CalendarRound
    date: Date
    checked_at: Date


class SchoolDeadlineCalendar(BaseModel):
    cycle_year: int
    reported_period: str
    schools_with_dates: int
    schools_total: int
    items: list[SchoolDeadlineItem]


async def school_deadline_calendar(
    catalog: Catalog, *, cycle_year: int, stale_days: int, now: datetime
) -> SchoolDeadlineCalendar:
    rows = await catalog.pool.fetch(
        """
        SELECT school_id, fact_key, value_date, value_bool, reported_period, observed_at
        FROM cds_library.current_school_facts
        WHERE fact_key = ANY($1::text[])
        """,
        _FACT_KEYS,
    )
    return build_school_deadline_calendar(
        rows, catalog, cycle_year=cycle_year, stale_days=stale_days, now=now
    )


def build_school_deadline_calendar(
    rows: Iterable[Mapping[str, Any]],
    catalog: Catalog,
    *,
    cycle_year: int,
    stale_days: int,
    now: datetime,
) -> SchoolDeadlineCalendar:
    rows = list(rows)
    offered: dict[tuple[int, str], bool | None] = {
        (row["school_id"], row["fact_key"]): row["value_bool"]
        for row in rows
        if row["fact_key"] not in CALENDAR_ROUND_KEYS
    }
    items: list[SchoolDeadlineItem] = []
    for row in rows:
        round_ = CALENDAR_ROUND_KEYS.get(row["fact_key"])
        if round_ is None:
            continue
        item = _item(row, round_, offered, catalog, cycle_year, stale_days, now)
        if item is not None:
            items.append(item)
    items.sort(key=lambda item: (item.date, item.school_name, item.round))
    return SchoolDeadlineCalendar(
        cycle_year=cycle_year,
        reported_period=deadline_reported_period(cycle_year),
        schools_with_dates=len({item.unitid for item in items}),
        schools_total=catalog.school_count,
        items=items,
    )


def _item(
    row: Mapping[str, Any],
    round_: CalendarRound,
    offered: Mapping[tuple[int, str], bool | None],
    catalog: Catalog,
    cycle_year: int,
    stale_days: int,
    now: datetime,
) -> SchoolDeadlineItem | None:
    unitid: int = row["school_id"]
    offered_key = OFFERED_KEY_FOR_DEADLINE.get(row["fact_key"])
    if offered_key is not None and offered.get((unitid, offered_key)) is False:
        return None
    fact = DeadlineFact(row["value_date"], row["reported_period"], row["observed_at"])
    inherited = inherited_date(fact, cycle_year=cycle_year, stale_days=stale_days, now=now)
    if inherited is None:
        return None
    name = catalog.school_name(unitid)
    if name is None:
        return None
    return SchoolDeadlineItem(
        unitid=unitid,
        school_name=name,
        website_url=website_url(catalog, unitid),
        round=round_,
        date=inherited.date,
        checked_at=inherited.checked_at,
    )
