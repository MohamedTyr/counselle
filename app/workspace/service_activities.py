"""Activities and honors workspace service functions."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Activity,
    ActivityCreate,
    ActivityDuplicateError,
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

# Public because the agent-tool layer presents the same hard Common App slot
# limits before calling this service. Keep enforcement and presentation aligned.
ACTIVITY_CAP = 10
HONOR_CAP = 5

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

# ``max(sort_order)`` and the active-slot count have no row to lock for an
# empty list. A transaction-scoped advisory lock gives each user's activity
# list a short critical section without creating lock rows.
_ACTIVITY_LOCK_SQL = """
    SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))
"""
# The trailing ``0`` above is a namespace tag reserved for this activities-list
# lock; a future second advisory-lock caller should pick a different constant
# to avoid key collisions with this one.

_ACTIVE_ACTIVITY_DUPLICATES_SQL = """
    SELECT id, position_label, organization
    FROM counselle.activities
    WHERE user_id = $1 AND archived_at IS NULL
"""

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
        SET archived_at = NULL, sort_order = $3, updated_at = now()
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
        SELECT *
        FROM counselle.activities
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
    "honors": """
        SELECT *
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
    return (
        await create_activities(
            app_pool,
            event_bus,
            user_id=user_id,
            actor=actor,
            data=[data],
        )
    )[0]


async def create_activities(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: list[ActivityCreate],
    reject_duplicate_pairs: bool = False,
) -> list[Activity]:
    """Create one activity batch atomically, appending it to the active order.

    ``reject_duplicate_pairs`` is reserved for the agent's reviewed batch
    workflow. The UI and ordinary ``create_activity`` calls remain permissive.
    Regardless of this flag, two entries within the same batch that share a
    position/organization pair are always rejected — only the active-row
    duplicate check is gated by ``reject_duplicate_pairs``.
    """
    if not data:
        return []
    async with app_pool.acquire() as conn, conn.transaction():
        await _lock_activities(conn, user_id)
        await _require_distinct_activity_pairs(
            conn, user_id, data, reject_active_duplicates=reject_duplicate_pairs
        )
        await _require_activity_capacity(conn, user_id, needed=len(data))
        sort_order = await _next_sort_order(conn, "activities", user_id)
        activities: list[Activity] = []
        events: list[ChangeEvent] = []
        for index, activity_data in enumerate(data):
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
                sort_order + index,
                activity_data.activity_type,
                activity_data.position,
                activity_data.organization,
                activity_data.description,
                activity_data.grades,
                activity_data.timing,
                activity_data.hours_per_week,
                activity_data.weeks_per_year,
                activity_data.continue_in_college,
                activity_data.story,
            )
            activity = Activity.model_validate(dict(row))
            activities.append(activity)
            events.append(
                await _record_change(conn, user_id, actor, "activity", activity.id, "created")
            )
    publish_events(event_bus, user_id, events)
    return activities


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
    if event is not None:
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
        app_pool, user_id, actor, "activities", "activity", activity_id, ACTIVITY_CAP
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
        await _require_capacity(conn, "honors", user_id, HONOR_CAP)
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
    if event is not None:
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
        app_pool, user_id, actor, "honors", "honor", honor_id, HONOR_CAP
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


async def _require_activity_capacity(
    conn: asyncpg.Connection, user_id: UUID, *, needed: int
) -> None:
    count = await conn.fetchval(_COUNT_ACTIVE_SQL["activities"], user_id)
    if count + needed > ACTIVITY_CAP:
        raise WorkspaceValidationError("active activities cap reached")


async def _next_sort_order(conn: asyncpg.Connection, table: WorkspaceTable, user_id: UUID) -> int:
    value = await conn.fetchval(_NEXT_SORT_SQL[table], user_id)
    return int(value)


async def _lock_activities(conn: asyncpg.Connection, user_id: UUID) -> None:
    """Serialize activity list writes for a user without affecting honors."""
    await conn.execute(_ACTIVITY_LOCK_SQL, str(user_id))


def _activity_pair(data: ActivityCreate) -> tuple[str, str]:
    return (data.position.strip().casefold(), data.organization.strip().casefold())


async def _require_distinct_activity_pairs(
    conn: asyncpg.Connection,
    user_id: UUID,
    data: list[ActivityCreate],
    *,
    reject_active_duplicates: bool,
) -> None:
    """Reject duplicate position/organization pairs.

    Batch-internal duplicates are always rejected — creating the same
    activity twice in one call is never a legitimate case. The active-row
    duplicate check is gated by ``reject_active_duplicates`` so a caller
    (``force=true`` in the agent tool) can bypass only that check, never the
    batch-internal one.
    """
    active_pairs: dict[tuple[str, str], UUID] = {}
    if reject_active_duplicates:
        rows = await conn.fetch(_ACTIVE_ACTIVITY_DUPLICATES_SQL, user_id)
        active_pairs = {
            (
                str(row["position_label"]).strip().casefold(),
                str(row["organization"]).strip().casefold(),
            ): row["id"]
            for row in rows
        }
    batch_pairs: dict[tuple[str, str], int] = {}
    for index, activity_data in enumerate(data):
        pair = _activity_pair(activity_data)
        if reject_active_duplicates and (active_activity_id := active_pairs.get(pair)):
            raise ActivityDuplicateError(
                duplicate_index=index, active_activity_id=active_activity_id
            )
        earlier_batch_index = batch_pairs.get(pair)
        if earlier_batch_index is not None:
            raise ActivityDuplicateError(
                duplicate_index=index, earlier_batch_index=earlier_batch_index
            )
        batch_pairs[pair] = index


async def _update_row(
    app_pool: asyncpg.Pool,
    user_id: UUID,
    actor: Actor,
    table: WorkspaceTable,
    object_type: WorkspaceObject,
    row_id: UUID,
    values: dict[str, object],
) -> tuple[asyncpg.Record, ChangeEvent | None]:
    async with app_pool.acquire() as conn, conn.transaction():
        current = await _require_active(conn, table, user_id, row_id)
        if not values:
            return current, None
        row = await _apply_update(conn, table, user_id, row_id, values)
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
        if table == "activities":
            await _lock_activities(conn, user_id)
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
        if table == "activities":
            await _lock_activities(conn, user_id)
        await _require_archived(conn, table, user_id, row_id)
        await _require_capacity(conn, table, user_id, cap)
        if table == "activities":
            sort_order = await _next_sort_order(conn, table, user_id)
            row = await conn.fetchrow(_RESTORE_SQL[table], row_id, user_id, sort_order)
        else:
            row = await conn.fetchrow(_RESTORE_SQL[table], row_id, user_id)
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
        if table == "activities":
            await _lock_activities(conn, user_id)
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
