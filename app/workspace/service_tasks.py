"""Task workspace service functions."""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Actor,
    ChangeEvent,
    ChangeOp,
    Task,
    TaskCreate,
    TaskPatch,
    TaskStatus,
    WorkspaceNotFoundError,
)
from app.workspace.service_utils import publish_events


async def list_tasks(app_pool: asyncpg.Pool, *, user_id: UUID) -> list[Task]:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT *
            FROM counselle.tasks
            WHERE user_id = $1 AND archived_at IS NULL
            ORDER BY created_at
            """,
            user_id,
        )
    return [Task.model_validate(dict(row)) for row in rows]


async def create_task(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: TaskCreate,
) -> Task:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _validate_links(conn, user_id, data.application_id, data.essay_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.tasks
              (user_id, application_id, essay_id, title, notes, status, category,
               priority, assignee, needs_input, due_at, planned_for, reminder_at,
               completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    CASE WHEN $6 = 'done' THEN now() ELSE NULL END)
            RETURNING *
            """,
            user_id,
            data.application_id,
            data.essay_id,
            data.title,
            data.notes,
            data.status,
            data.category,
            data.priority,
            data.assignee,
            data.needs_input,
            data.due_at,
            data.planned_for,
            data.reminder_at,
        )
        task = Task.model_validate(dict(row))
        events.append(
            await _record_task_change(conn, user_id, actor, task, "created")
        )
    publish_events(event_bus, user_id, events)
    return task


async def update_task(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    task_id: UUID,
    data: TaskPatch,
) -> Task:
    values = data.model_dump(exclude_unset=True)
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        current = await _require_task(conn, user_id, task_id)
        await _validate_patch_links(conn, user_id, values)
        if values:
            row = await _update_task_row(conn, user_id, task_id, values)
        else:
            row = current
        task = Task.model_validate(dict(row))
        events.append(
            await _record_task_change(conn, user_id, actor, task, "updated")
        )
    publish_events(event_bus, user_id, events)
    return task


async def archive_task(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    task_id: UUID,
) -> None:
    await _archive_one(app_pool, event_bus, user_id=user_id, actor=actor, task_id=task_id)


async def restore_task(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    task_id: UUID,
) -> Task:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_restorable_task(conn, user_id, task_id)
        row = await conn.fetchrow(
            """
            UPDATE counselle.tasks
            SET archived_at = NULL, updated_at = now(),
                archived_via_application = NULL
            WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
            RETURNING *
            """,
            task_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        task = Task.model_validate(dict(row))
        events.append(
            await _record_task_change(conn, user_id, actor, task, "restored")
        )
    publish_events(event_bus, user_id, events)
    return task


async def bulk_update_status(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    ids: list[UUID],
    status: TaskStatus,
) -> list[Task]:
    if not ids:
        return []
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        rows = await conn.fetch(
            """
            UPDATE counselle.tasks
            SET status = $3,
                completed_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END,
                updated_at = now()
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL
            RETURNING *
            """,
            user_id,
            ids,
            status,
        )
        tasks = [Task.model_validate(dict(row)) for row in rows]
        for task in tasks:
            events.append(
                await _record_task_change(conn, user_id, actor, task, "updated")
            )
    publish_events(event_bus, user_id, events)
    return tasks


async def bulk_archive(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    ids: list[UUID],
) -> list[UUID]:
    if not ids:
        return []
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        rows = await conn.fetch(
            """
            UPDATE counselle.tasks
            SET archived_at = now(), updated_at = now()
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL
            RETURNING *
            """,
            user_id,
            ids,
        )
        tasks = [Task.model_validate(dict(row)) for row in rows]
        for task in tasks:
            events.append(
                await _record_task_change(conn, user_id, actor, task, "archived")
            )
    publish_events(event_bus, user_id, events)
    return [task.id for task in tasks]


async def _archive_one(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    task_id: UUID,
) -> None:
    archived = await bulk_archive(
        app_pool, event_bus, user_id=user_id, actor=actor, ids=[task_id]
    )
    if not archived:
        raise WorkspaceNotFoundError()


async def _require_task(
    conn: asyncpg.Connection, user_id: UUID, task_id: UUID
) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        SELECT *
        FROM counselle.tasks
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
        task_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _validate_patch_links(
    conn: asyncpg.Connection, user_id: UUID, values: dict[str, object]
) -> None:
    app_id = values.get("application_id") if "application_id" in values else None
    essay_id = values.get("essay_id") if "essay_id" in values else None
    await _validate_links(conn, user_id, app_id, essay_id)


async def _validate_links(
    conn: asyncpg.Connection,
    user_id: UUID,
    application_id: object,
    essay_id: object,
) -> None:
    if application_id is not None:
        await _require_active_application(conn, user_id, application_id)
    if essay_id is not None:
        await _require_active_essay(conn, user_id, essay_id)


async def _require_active_application(
    conn: asyncpg.Connection, user_id: UUID, application_id: object
) -> None:
    row = await conn.fetchrow(
        """
        SELECT id
        FROM counselle.applications
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
        application_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()


async def _require_active_essay(
    conn: asyncpg.Connection, user_id: UUID, essay_id: object
) -> None:
    row = await conn.fetchrow(
        """
        SELECT id
        FROM counselle.essays
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
        essay_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()


async def _require_restorable_task(
    conn: asyncpg.Connection, user_id: UUID, task_id: UUID
) -> None:
    row = await conn.fetchrow(
        """
        SELECT t.id
        FROM counselle.tasks t
        WHERE t.id = $1
          AND t.user_id = $2
          AND t.archived_at IS NOT NULL
          AND (
            t.application_id IS NULL OR EXISTS (
              SELECT 1
              FROM counselle.applications a
              WHERE a.id = t.application_id
                AND a.user_id = t.user_id
                AND a.archived_at IS NULL
            )
          )
          AND (
            t.essay_id IS NULL OR EXISTS (
              SELECT 1
              FROM counselle.essays e
              WHERE e.id = t.essay_id
                AND e.user_id = t.user_id
                AND e.archived_at IS NULL
            )
          )
        """,
        task_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()


async def _update_task_row(
    conn: asyncpg.Connection, user_id: UUID, task_id: UUID, values: dict[str, object]
) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        UPDATE counselle.tasks
        SET title = CASE WHEN $3 THEN $4 ELSE title END,
            application_id = CASE WHEN $5 THEN $6 ELSE application_id END,
            essay_id = CASE WHEN $7 THEN $8 ELSE essay_id END,
            notes = CASE WHEN $9 THEN $10 ELSE notes END,
            status = CASE WHEN $11 THEN $12 ELSE status END,
            category = CASE WHEN $13 THEN $14 ELSE category END,
            priority = CASE WHEN $15 THEN $16 ELSE priority END,
            assignee = CASE WHEN $17 THEN $18 ELSE assignee END,
            needs_input = CASE WHEN $19 THEN $20 ELSE needs_input END,
            due_at = CASE WHEN $21 THEN $22 ELSE due_at END,
            planned_for = CASE WHEN $23 THEN $24 ELSE planned_for END,
            reminder_at = CASE WHEN $25 THEN $26 ELSE reminder_at END,
            completed_at = CASE
              WHEN $11 THEN CASE WHEN $12 = 'done' THEN now() ELSE NULL END
              ELSE completed_at
            END,
            updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
        task_id,
        user_id,
        "title" in values,
        values.get("title"),
        "application_id" in values,
        values.get("application_id"),
        "essay_id" in values,
        values.get("essay_id"),
        "notes" in values,
        values.get("notes"),
        "status" in values,
        values.get("status"),
        "category" in values,
        values.get("category"),
        "priority" in values,
        values.get("priority"),
        "assignee" in values,
        values.get("assignee"),
        "needs_input" in values,
        values.get("needs_input"),
        "due_at" in values,
        values.get("due_at"),
        "planned_for" in values,
        values.get("planned_for"),
        "reminder_at" in values,
        values.get("reminder_at"),
    )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _record_task_change(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    task: Task,
    op: ChangeOp,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="task",
        object_id=task.id,
        op=op,
        application_id=task.application_id,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="task",
        object_id=task.id,
        op=op,
        application_id=task.application_id,
    )
