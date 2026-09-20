"""Small shared helpers for workspace service modules."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ChangeEvent
from counselle_db.catalog import Catalog
from domain.facts.inherit import AID_FACT_KEY, ROUND_FACT_KEY, DeadlineFact


@dataclass(frozen=True)
class SchoolIdentity:
    unitid: int
    name: str
    city: str | None
    state: str | None
    website_url: str | None


_DEADLINE_FACT_KEYS = sorted({*ROUND_FACT_KEY.values(), AID_FACT_KEY})


def website_url(catalog: Catalog, unitid: int) -> str | None:
    domain = catalog.school_domain(unitid)
    return f"https://{domain}" if domain else None


async def school_identities(catalog: Catalog, unitids: list[int]) -> dict[int, SchoolIdentity]:
    unique_unitids = sorted(set(unitids))
    if not unique_unitids:
        return {}
    rows = await catalog.pool.fetch(
        """
        SELECT id AS unitid, name, city, state, official_domain
        FROM cds_library.school_profiles
        WHERE id = ANY($1::int[])
        """,
        unique_unitids,
    )
    return {
        row["unitid"]: SchoolIdentity(
            unitid=row["unitid"],
            name=row["name"],
            city=row["city"],
            state=row["state"],
            website_url=website_url(catalog, row["unitid"]),
        )
        for row in rows
    }


async def school_deadline_facts(
    catalog: Catalog, unitids: list[int]
) -> dict[tuple[int, str], DeadlineFact]:
    """The five deadline facts (four round deadlines + financial aid) for the
    given schools, batched in one query over the reader-role facts view."""
    unique_unitids = sorted(set(unitids))
    if not unique_unitids:
        return {}
    rows = await catalog.pool.fetch(
        """
        SELECT school_id, fact_key, value_date, reported_period, observed_at
        FROM cds_library.current_school_facts
        WHERE school_id = ANY($1::int[]) AND fact_key = ANY($2::text[])
        """,
        unique_unitids,
        _DEADLINE_FACT_KEYS,
    )
    return {
        (row["school_id"], row["fact_key"]): DeadlineFact(
            value_date=row["value_date"],
            reported_period=row["reported_period"],
            observed_at=row["observed_at"],
        )
        for row in rows
    }


def publish_events(event_bus: WorkspaceEventBus, user_id: UUID, events: list[ChangeEvent]) -> None:
    for event in events:
        event_bus.publish(user_id, event)
