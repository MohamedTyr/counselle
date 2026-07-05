"""Activities and honors workspace service functions."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Activity,
    ActivityCreate,
    ActivityPatch,
    Actor,
    ChangeEvent,
    ChangeOp,
    Honor,
    HonorCreate,
    HonorPatch,
    ObjectType,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import publish_events

_ACTIVITY_CAP = 10
_HONOR_CAP = 5

type WorkspaceTable = Literal["activities", "honors"]
type WorkspaceObject = Literal["activity", "honor"]

_LIST_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT *
        FROM counselle.activities
        WHERE user_id = $1 AND archived_at IS NULL
        ORDER BY sort_order, created_at
        """,
    "honors": """
        SELECT *
        FROM counselle.honors
        WHERE user_id = $1 AND archived_at IS NULL
        ORDER BY sort_order, created_at
        """,
}

_COUNT_ACTIVE_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT count(*)
        FROM counselle.activities
        WHERE user_id = $1 AND archived_at IS NULL
        """,
    "honors": """
        SELECT count(*)
        FROM counselle.honors
        WHERE user_id = $1 AND archived_at IS NULL
        """,
}

_NEXT_SORT_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT coalesce(max(sort_order), -1) + 1
        FROM counselle.activities
        WHERE user_id = $1
        """,
    "honors": """
        SELECT coalesce(max(sort_order), -1) + 1
        FROM counselle.honors
        WHERE user_id = $1
        """,
}

_ARCHIVE_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        UPDATE counselle.activities
        SET archived_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
    "honors": """
        UPDATE counselle.honors
        SET archived_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
}

_RESTORE_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        UPDATE counselle.activities
        SET archived_at = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
        RETURNING *
        """,
    "honors": """
        UPDATE counselle.honors
        SET archived_at = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
        RETURNING *
        """,
}

_ACTIVE_IDS_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT id
        FROM counselle.activities
        WHERE user_id = $1 AND archived_at IS NULL
        """,
    "honors": """
        SELECT id
        FROM counselle.honors
        WHERE user_id = $1 AND archived_at IS NULL
        """,
}

_REORDER_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        UPDATE counselle.activities
        SET sort_order = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
    "honors": """
        UPDATE counselle.honors
        SET sort_order = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
}

_REQUIRE_ACTIVE_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT id
        FROM counselle.activities
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
    "honors": """
        SELECT id
        FROM counselle.honors
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
}

_REQUIRE_ARCHIVED_SQL: dict[WorkspaceTable, str] = {
    "activities": """
        SELECT id
        FROM counselle.activities
        WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
        """,
    "honors": """
        SELECT id
        FROM counselle.honors
        WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
        """,
}

_UPDATE_ACTIVITY_SQL = """
UPDATE counselle.activities
SET activity_type = CASE WHEN $3 THEN $4 ELSE activity_type END,
    position_label = CASE WHEN $5 THEN $6 ELSE position_label END,
    organization = CASE WHEN $7 THEN $8 ELSE organization END,
    description = CASE WHEN $9 THEN $10 ELSE description END,
    grades = CASE WHEN $11 THEN $12 ELSE grades END,
    timing = CASE WHEN $13 THEN $14 ELSE timing END,
    hours_per_week = CASE WHEN $15 THEN $16 ELSE hours_per_week END,
    weeks_per_year = CASE WHEN $17 THEN $18 ELSE weeks_per_year END,
    continue_in_college = CASE WHEN $19 THEN $20 ELSE continue_in_college END,
    story = CASE WHEN $21 THEN $22 ELSE story END,
    updated_at = now()
WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
RETURNING *
"""

_UPDATE_HONOR_SQL = """
UPDATE counselle.honors
SET title = CASE WHEN $3 THEN $4 ELSE title END,
    grades = CASE WHEN $5 THEN $6 ELSE grades END,
    levels = CASE WHEN $7 THEN $8 ELSE levels END,
    updated_at = now()
WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
RETURNING *
"""


async def list_activities(app_pool: asyncpg.Pool, *, user_id: UUID) -> list[Activity]:
    rows = await _list_rows(app_pool, "activities", user_id)
    return [Activity.model_validate(dict(row)) for row in rows]


async def create_activity(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: ActivityCreate,
) -> Activity:
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_capacity(conn, "activities", user_id, _ACTIVITY_CAP)
        sort_order = await _next_sort_order(conn, "activities", user_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.activities
              (user_id, sort_order, activity_type, position_label, organization,
               description, grades, timing, hours_per_week, weeks_per_year,
               continue_in_college, story)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
            """,
            user_id,
            sort_order,
            data.activity_type,
            data.position,
            data.organization,
            data.description,
            data.grades,
            data.timing,
            data.hours_per_week,
            data.weeks_per_year,
            data.continue_in_college,
            data.story,
        )
        activity = Activity.model_validate(dict(row))
        event = await _record_change(conn, user_id, actor, "activity", activity.id, "created")
    publish_events(event_bus, user_id, [event])
    return activity


async def update_activity(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    activity_id: UUID,
    data: ActivityPatch,
) -> Activity:
    values = data.model_dump(exclude_unset=True)
    row, event = await _update_row(
        app_pool, user_id, actor, "activities", "activity", activity_id, values
    )
    publish_events(event_bus, user_id, [event])
    return Activity.model_validate(dict(row))


async def archive_activity(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    activity_id: UUID,
) -> None:
    event = await _archive_row(app_pool, user_id, actor, "activities", "activity", activity_id)
    publish_events(event_bus, user_id, [event])


async def restore_activity(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    activity_id: UUID,
) -> Activity:
    row, event = await _restore_row(
        app_pool, user_id, actor, "activities", "activity", activity_id, _ACTIVITY_CAP
    )
    publish_events(event_bus, user_id, [event])
    return Activity.model_validate(dict(row))


async def reorder_activities(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    ids: list[UUID],
) -> list[Activity]:
    rows, events = await _reorder_rows(app_pool, user_id, actor, "activities", "activity", ids)
    publish_events(event_bus, user_id, events)
    return [Activity.model_validate(dict(row)) for row in rows]


async def list_honors(app_pool: asyncpg.Pool, *, user_id: UUID) -> list[Honor]:
    rows = await _list_rows(app_pool, "honors", user_id)
    return [Honor.model_validate(dict(row)) for row in rows]


async def create_honor(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: HonorCreate,
) -> Honor:
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_capacity(conn, "honors", user_id, _HONOR_CAP)
        sort_order = await _next_sort_order(conn, "honors", user_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.honors
              (user_id, sort_order, title, grades, levels)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            """,
            user_id,
            sort_order,
            data.title,
            data.grades,
            data.levels,
        )
        honor = Honor.model_validate(dict(row))
        event = await _record_change(conn, user_id, actor, "honor", honor.id, "created")
    publish_events(event_bus, user_id, [event])
    return honor


async def update_honor(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    honor_id: UUID,
    data: HonorPatch,
) -> Honor:
    row, event = await _update_row(
        app_pool, user_id, actor, "honors", "honor", honor_id, data.model_dump(exclude_unset=True)
    )
    publish_events(event_bus, user_id, [event])
    return Honor.model_validate(dict(row))


async def archive_honor(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    honor_id: UUID,
) -> None:
    event = await _archive_row(app_pool, user_id, actor, "honors", "honor", honor_id)
    publish_events(event_bus, user_id, [event])


async def restore_honor(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    honor_id: UUID,
) -> Honor:
    row, event = await _restore_row(
        app_pool, user_id, actor, "honors", "honor", honor_id, _HONOR_CAP
    )
    publish_events(event_bus, user_id, [event])
    return Honor.model_validate(dict(row))


async def reorder_honors(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    ids: list[UUID],
) -> list[Honor]:
    rows, events = await _reorder_rows(app_pool, user_id, actor, "honors", "honor", ids)
    publish_events(event_bus, user_id, events)
    return [Honor.model_validate(dict(row)) for row in rows]


async def _list_rows(
    app_pool: asyncpg.Pool, table: WorkspaceTable, user_id: UUID
) -> list[asyncpg.Record]:
    async with app_pool.acquire() as conn:
        rows: list[asyncpg.Record] = await conn.fetch(_LIST_SQL[table], user_id)
        return rows


async def _require_capacity(
    conn: asyncpg.Connection, table: WorkspaceTable, user_id: UUID, cap: int
) -> None:
    count = await conn.fetchval(_COUNT_ACTIVE_SQL[table], user_id)
    if count >= cap:
        raise WorkspaceValidationError(f"active {table} cap reached")


async def _next_sort_order(
    conn: asyncpg.Connection, table: WorkspaceTable, user_id: UUID
) -> int:
    value = await conn.fetchval(_NEXT_SORT_SQL[table], user_id)
    return int(value)


async def _update_row(
    app_pool: asyncpg.Pool,
    user_id: UUID,
    actor: Actor,
    table: WorkspaceTable,
    object_type: WorkspaceObject,
    row_id: UUID,
    values: dict[str, object],
) -> tuple[asyncpg.Record, ChangeEvent]:
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_active(conn, table, user_id, row_id)
        row = await _apply_update(conn, table, user_id, row_id, values) if values else (
            await _require_active(conn, table, user_id, row_id)
        )
        event = await _record_change(conn, user_id, actor, object_type, row["id"], "updated")
    return row, event


async def _archive_row(
    app_pool: asyncpg.Pool,
    user_id: UUID,
    actor: Actor,
    table: WorkspaceTable,
    object_type: WorkspaceObject,
    row_id: UUID,
) -> ChangeEvent:
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            _ARCHIVE_SQL[table],
            row_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        event = await _record_change(conn, user_id, actor, object_type, row["id"], "archived")
    return event


async def _restore_row(
    app_pool: asyncpg.Pool,
    user_id: UUID,
    actor: Actor,
    table: WorkspaceTable,
    object_type: WorkspaceObject,
    row_id: UUID,
    cap: int,
) -> tuple[asyncpg.Record, ChangeEvent]:
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_archived(conn, table, user_id, row_id)
        await _require_capacity(conn, table, user_id, cap)
        row = await conn.fetchrow(
            _RESTORE_SQL[table],
            row_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        event = await _record_change(conn, user_id, actor, object_type, row["id"], "restored")
    return row, event


async def _reorder_rows(
    app_pool: asyncpg.Pool,
    user_id: UUID,
    actor: Actor,
    table: WorkspaceTable,
    object_type: WorkspaceObject,
    ids: list[UUID],
) -> tuple[list[asyncpg.Record], list[ChangeEvent]]:
    if len(set(ids)) != len(ids):
        raise WorkspaceValidationError("ordered ids must be unique")
    async with app_pool.acquire() as conn, conn.transaction():
        active = await conn.fetch(
            _ACTIVE_IDS_SQL[table],
            user_id,
        )
        active_ids = {row["id"] for row in active}
        if active_ids != set(ids):
            raise WorkspaceValidationError("ordered ids must match active rows")
        rows: list[asyncpg.Record] = []
        events: list[ChangeEvent] = []
        for index, row_id in enumerate(ids):
            row = await conn.fetchrow(
                _REORDER_SQL[table],
                row_id,
                user_id,
                index,
            )
            if row is None:
                raise WorkspaceNotFoundError()
            rows.append(row)
            events.append(
                await _record_change(conn, user_id, actor, object_type, row_id, "updated")
            )
    return rows, events


async def _require_active(
    conn: asyncpg.Connection, table: WorkspaceTable, user_id: UUID, row_id: UUID
) -> asyncpg.Record:
    row = await conn.fetchrow(
        _REQUIRE_ACTIVE_SQL[table],
        row_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _require_archived(
    conn: asyncpg.Connection, table: WorkspaceTable, user_id: UUID, row_id: UUID
) -> None:
    row = await conn.fetchrow(
        _REQUIRE_ARCHIVED_SQL[table],
        row_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()


async def _apply_update(
    conn: asyncpg.Connection,
    table: WorkspaceTable,
    user_id: UUID,
    row_id: UUID,
    values: dict[str, object],
) -> asyncpg.Record:
    if table == "activities":
        row = await conn.fetchrow(
            _UPDATE_ACTIVITY_SQL,
            row_id,
            user_id,
            "activity_type" in values,
            values.get("activity_type"),
            "position" in values,
            values.get("position"),
            "organization" in values,
            values.get("organization"),
            "description" in values,
            values.get("description"),
            "grades" in values,
            values.get("grades"),
            "timing" in values,
            values.get("timing"),
            "hours_per_week" in values,
            values.get("hours_per_week"),
            "weeks_per_year" in values,
            values.get("weeks_per_year"),
            "continue_in_college" in values,
            values.get("continue_in_college"),
            "story" in values,
            values.get("story"),
        )
    else:
        row = await conn.fetchrow(
            _UPDATE_HONOR_SQL,
            row_id,
            user_id,
            "title" in values,
            values.get("title"),
            "grades" in values,
            values.get("grades"),
            "levels" in values,
            values.get("levels"),
        )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _record_change(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    object_type: ObjectType,
    object_id: UUID,
    op: ChangeOp,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type=object_type,
        object_id=object_id,
        op=op,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type=object_type,
        object_id=object_id,
        op=op,
    )
