"""Student-profile persistence behind the workspace service boundary."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import ValidationError

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import Actor, Profile, ProfilePatch
from app.workspace.service_utils import publish_events


class PersistedProfileReadError(RuntimeError):
    """A fixed, safe failure for malformed Profile JSON already in storage.

    A Pydantic ``ValidationError`` includes the invalid persisted input in its
    representation.  Explore is a read-only surface whose normal unhandled
    error path logs an exception representation and traceback, so it must not
    let that original error escape this service boundary.
    """

    def __init__(self) -> None:
        super().__init__("Stored profile cannot be read.")


async def get_profile(app_pool: asyncpg.Pool, *, user_id: UUID) -> Profile:
    """Return the user's profile, creating its empty row on first access."""
    async with app_pool.acquire() as conn, conn.transaction():
        row = await _ensure_profile(conn, user_id)
    return Profile.model_validate(row["data"])


async def read_profile_or_empty(app_pool: asyncpg.Pool, *, user_id: UUID) -> Profile:
    """Read one owner's Profile without creating or locking a workspace row.

    Personalized read-only surfaces such as Explore must not inherit
    ``get_profile``'s lazy-creation behavior: a GET is not a workspace
    mutation.  Database failures deliberately propagate to the normal route
    error handler rather than being disguised as a missing Profile.
    """
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT data
            FROM counselle.profiles
            WHERE user_id = $1
            """,
            user_id,
        )
    if row is None:
        return Profile()
    try:
        return Profile.model_validate(row["data"])
    except ValidationError:
        # Do not retain the Pydantic failure as a rendered cause/context: it
        # can contain the corrupted Profile JSON, and the global 500 handler
        # legitimately logs tracebacks for operational diagnosis.
        raise PersistedProfileReadError() from None


async def update_profile(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: ProfilePatch,
) -> Profile:
    """Merge a typed section patch and publish a content-free invalidation event."""
    patch = data.model_dump(exclude_unset=True, mode="json")
    async with app_pool.acquire() as conn, conn.transaction():
        current = await _ensure_profile(conn, user_id)
        merged = _merge_patch(current["data"], patch)
        profile = Profile.model_validate(merged)
        normalized = profile.model_dump(mode="json", exclude_none=True)
        if not patch:
            return profile
        row = await conn.fetchrow(
            """
            UPDATE counselle.profiles
            SET data = $3, updated_at = now()
            WHERE id = $1 AND user_id = $2
            RETURNING id
            """,
            current["id"],
            user_id,
            normalized,
        )
        assert row is not None  # nosec B101 - UPSERT ... RETURNING always yields a row
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type="profile",
            object_id=row["id"],
            op="updated",
        )
    event = make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="profile",
        object_id=row["id"],
        op="updated",
    )
    publish_events(event_bus, user_id, [event])
    return profile


async def _ensure_profile(conn: asyncpg.Connection, user_id: UUID) -> asyncpg.Record:
    await conn.execute(
        """
        INSERT INTO counselle.profiles (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        """,
        user_id,
    )
    row = await conn.fetchrow(
        """
        SELECT id, data
        FROM counselle.profiles
        WHERE user_id = $1
        FOR UPDATE
        """,
        user_id,
    )
    assert row is not None  # nosec B101 - UPSERT ... RETURNING always yields a row
    return row


def _merge_patch(current: Mapping[str, Any], patch: Mapping[str, Any]) -> dict[str, Any]:
    """Apply RFC 7396-style merge semantics without retaining cleared fields."""
    merged = dict(current)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        elif isinstance(value, Mapping) and isinstance(merged.get(key), Mapping):
            merged[key] = _merge_patch(merged[key], value)
        else:
            merged[key] = value
    return merged
