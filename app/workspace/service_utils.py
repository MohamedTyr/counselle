"""Small shared helpers for workspace service modules."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ChangeEvent
from counselle_db.catalog import Catalog


@dataclass(frozen=True)
class SchoolIdentity:
    unitid: int
    name: str
    city: str | None
    state: str | None
    website_url: str | None


def website_url(catalog: Catalog, unitid: int) -> str | None:
    domain = catalog.school_domain(unitid)
    return f"https://{domain}" if domain else None


async def school_identities(
    catalog: Catalog, unitids: list[int]
) -> dict[int, SchoolIdentity]:
    unique_unitids = sorted(set(unitids))
    if not unique_unitids:
        return {}
    rows = await catalog.pool.fetch(
        """
        SELECT unitid, name, NULL::text AS city, state
        FROM schools
        WHERE unitid = ANY($1::int[])
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


def publish_events(
    event_bus: WorkspaceEventBus, user_id: UUID, events: list[ChangeEvent]
) -> None:
    for event in events:
        event_bus.publish(user_id, event)
