"""Application workspace service functions."""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Actor,
    ApplicationAddResult,
    ApplicationCreate,
    ApplicationDetail,
    ApplicationPatch,
    ApplicationView,
    ChangeEvent,
    ChangeOp,
    EssaySummary,
    ObjectType,
    Rollup,
    SchoolSearchResult,
    SeededWorkspaceIds,
    Task,
    WorkspaceNotFoundError,
    WorkspaceSeedingTemplate,
    WorkspaceValidationError,
)
from app.workspace.seeding import seed_application_workspace
from app.workspace.service_utils import SchoolIdentity, publish_events, school_identities
from counselle_db.catalog import Catalog
from counselle_db.service import search_school_names

_LIST_SQL = """
WITH task_counts AS (
  SELECT application_id,
         count(*) FILTER (WHERE status = 'done') AS completed,
         count(*) AS total
  FROM counselle.tasks
  WHERE user_id = $1 AND archived_at IS NULL AND application_id IS NOT NULL
  GROUP BY application_id
),
essay_counts AS (
  SELECT application_id,
         count(*) FILTER (WHERE status IN ('Ready', 'Submitted')) AS completed,
         count(*) AS total
  FROM counselle.essays
  WHERE user_id = $1 AND archived_at IS NULL AND application_id IS NOT NULL
  GROUP BY application_id
)
SELECT a.*,
       coalesce(tc.completed, 0)::int AS task_completed,
       coalesce(tc.total, 0)::int AS task_total,
       coalesce(ec.completed, 0)::int AS essay_completed,
       coalesce(ec.total, 0)::int AS essay_total
FROM counselle.applications a
LEFT JOIN task_counts tc ON tc.application_id = a.id
LEFT JOIN essay_counts ec ON ec.application_id = a.id
WHERE a.user_id = $1 AND a.archived_at IS NULL
ORDER BY a.created_at DESC
"""

_VIEW_BY_ID_SQL = """
WITH task_counts AS (
  SELECT application_id,
         count(*) FILTER (WHERE status = 'done') AS completed,
         count(*) AS total
  FROM counselle.tasks
  WHERE user_id = $1 AND archived_at IS NULL AND application_id IS NOT NULL
  GROUP BY application_id
),
essay_counts AS (
  SELECT application_id,
         count(*) FILTER (WHERE status IN ('Ready', 'Submitted')) AS completed,
         count(*) AS total
  FROM counselle.essays
  WHERE user_id = $1 AND archived_at IS NULL AND application_id IS NOT NULL
  GROUP BY application_id
)
SELECT a.*,
       coalesce(tc.completed, 0)::int AS task_completed,
       coalesce(tc.total, 0)::int AS task_total,
       coalesce(ec.completed, 0)::int AS essay_completed,
       coalesce(ec.total, 0)::int AS essay_total
FROM counselle.applications a
LEFT JOIN task_counts tc ON tc.application_id = a.id
LEFT JOIN essay_counts ec ON ec.application_id = a.id
WHERE a.user_id = $1 AND a.archived_at IS NULL AND a.id = $2
"""


async def search_schools(
    catalog: Catalog,
    app_pool: asyncpg.Pool,
    *,
    user_id: UUID,
    query: str,
    limit: int = 8,
) -> list[SchoolSearchResult]:
    schools = await search_school_names(catalog, query, limit=limit)
    unitids = [school.unitid for school in schools]
    active = await _active_unitids(app_pool, user_id, unitids)
    return [
        SchoolSearchResult(
            unitid=school.unitid,
            name=school.name,
            city=school.city,
            state=school.state,
            website_url=_website_url(catalog, school.unitid),
            on_list=school.unitid in active,
        )
        for school in schools
    ]


async def list_applications(
    app_pool: asyncpg.Pool, catalog: Catalog, *, user_id: UUID
) -> list[ApplicationView]:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(_LIST_SQL, user_id)
    return await _views_from_rows(catalog, rows)


async def add_application(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: ApplicationCreate,
    template: WorkspaceSeedingTemplate,
) -> ApplicationAddResult:
    if catalog.school_name(data.unitid) is None:
        raise WorkspaceValidationError("school is not in the catalog")
    events: list[ChangeEvent] = []
    try:
        async with app_pool.acquire() as conn, conn.transaction():
            app_row = await conn.fetchrow(
                """
                INSERT INTO counselle.applications
                  (user_id, school_unitid, list_type, round, deadline)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
                """,
                user_id,
                data.unitid,
                data.list_type,
                data.round,
                data.deadline,
            )
            app_id = app_row["id"]
            change_id = await record_change(
                conn,
                user_id=user_id,
                actor=actor,
                object_type="application",
                object_id=app_id,
                op="created",
            )
            events.append(
                make_change_event(
                    change_id=change_id,
                    actor=actor,
                    object_type="application",
                    object_id=app_id,
                    op="created",
                )
            )
            seeded = await seed_application_workspace(
                conn,
                user_id=user_id,
                application_id=app_id,
                deadline=data.deadline,
                template=template,
            )
            for task in seeded.tasks:
                change_id = await record_change(
                    conn,
                    user_id=user_id,
                    actor=actor,
                    object_type="task",
                    object_id=task.id,
                    op="created",
                    application_id=app_id,
                )
                events.append(
                    make_change_event(
                        change_id=change_id,
                        actor=actor,
                        object_type="task",
                        object_id=task.id,
                        op="created",
                        application_id=app_id,
                    )
                )
            for essay in seeded.essays:
                change_id = await record_change(
                    conn,
                    user_id=user_id,
                    actor=actor,
                    object_type="essay",
                    object_id=essay.id,
                    op="created",
                    application_id=app_id,
                )
                events.append(
                    make_change_event(
                        change_id=change_id,
                        actor=actor,
                        object_type="essay",
                        object_id=essay.id,
                        op="created",
                        application_id=app_id,
                    )
                )
    except asyncpg.UniqueViolationError as exc:
        raise WorkspaceValidationError("school is already active on this list") from exc

    publish_events(event_bus, user_id, events)
    application = await _application_view_by_id(app_pool, catalog, user_id, app_id)
    return ApplicationAddResult(
        application=application,
        seeded=SeededWorkspaceIds(
            task_ids=[task.id for task in seeded.tasks],
            essay_ids=[essay.id for essay in seeded.essays],
        ),
    )


async def update_application(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
    data: ApplicationPatch,
) -> ApplicationView:
    values = data.model_dump(exclude_unset=True)
    if not values:
        return await _application_view_by_id(app_pool, catalog, user_id, application_id)
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_active_application(conn, user_id, application_id)
        row = await conn.fetchrow(
            """
            UPDATE counselle.applications
            SET status = CASE WHEN $3 THEN $4 ELSE status END,
                list_type = CASE WHEN $5 THEN $6 ELSE list_type END,
                round = CASE WHEN $7 THEN $8 ELSE round END,
                deadline = CASE WHEN $9 THEN $10 ELSE deadline END,
                updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING id
            """,
            application_id,
            user_id,
            "status" in values,
            values.get("status"),
            "list_type" in values,
            values.get("list_type"),
            "round" in values,
            values.get("round"),
            "deadline" in values,
            values.get("deadline"),
        )
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type="application",
            object_id=row["id"],
            op="updated",
        )
        events.append(
            make_change_event(
                change_id=change_id,
                actor=actor,
                object_type="application",
                object_id=row["id"],
                op="updated",
            )
        )
    publish_events(event_bus, user_id, events)
    return await _application_view_by_id(app_pool, catalog, user_id, application_id)


async def archive_application(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
) -> None:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_active_application(conn, user_id, application_id)
        task_rows = await _archive_linked_tasks(conn, user_id, application_id)
        essay_rows = await _archive_linked_essays(conn, user_id, application_id)
        await conn.execute(
            """
            UPDATE counselle.applications
            SET archived_at = now(), updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            """,
            application_id,
            user_id,
        )
        events.extend(
            await _record_many(
                conn, user_id=user_id, actor=actor, rows=[{"id": application_id}],
                object_type="application", op="archived"
            )
        )
        events.extend(
            await _record_many(
                conn, user_id=user_id, actor=actor, rows=task_rows,
                object_type="task", op="archived", application_id=application_id
            )
        )
        events.extend(
            await _record_many(
                conn, user_id=user_id, actor=actor, rows=essay_rows,
                object_type="essay", op="archived", application_id=application_id
            )
        )
    publish_events(event_bus, user_id, events)


async def restore_application(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
) -> None:
    events: list[ChangeEvent] = []
    try:
        async with app_pool.acquire() as conn, conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id
                FROM counselle.applications
                WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
                """,
                application_id,
                user_id,
            )
            if row is None:
                raise WorkspaceNotFoundError()
            await conn.execute(
                """
                UPDATE counselle.applications
                SET archived_at = NULL, updated_at = now()
                WHERE id = $1 AND user_id = $2
                """,
                application_id,
                user_id,
            )
            essay_rows = await _restore_linked_essays(conn, user_id, application_id)
            task_rows = await _restore_linked_tasks(conn, user_id, application_id)
            events.extend(
                await _record_many(
                    conn,
                    user_id=user_id,
                    actor=actor,
                    rows=[dict(row)],
                    object_type="application",
                    op="restored",
                )
            )
            events.extend(
                await _record_many(
                    conn,
                    user_id=user_id,
                    actor=actor,
                    rows=task_rows,
                    object_type="task",
                    op="restored",
                    application_id=application_id,
                )
            )
            events.extend(
                await _record_many(
                    conn,
                    user_id=user_id,
                    actor=actor,
                    rows=essay_rows,
                    object_type="essay",
                    op="restored",
                    application_id=application_id,
                )
            )
    except asyncpg.UniqueViolationError as exc:
        raise WorkspaceValidationError("school is already active on this list") from exc
    publish_events(event_bus, user_id, events)


async def get_application_detail(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    *,
    user_id: UUID,
    application_id: UUID,
) -> ApplicationDetail:
    application = await _application_view_by_id(app_pool, catalog, user_id, application_id)
    async with app_pool.acquire() as conn:
        task_rows = await conn.fetch(
            """
            SELECT *
            FROM counselle.tasks
            WHERE user_id = $1 AND application_id = $2 AND archived_at IS NULL
            ORDER BY created_at
            """,
            user_id,
            application_id,
        )
        essay_rows = await conn.fetch(
            """
            SELECT *, ''::text AS preview,
                   jsonb_array_length(comments) AS comment_count,
                   jsonb_array_length(suggestions) AS suggestion_count
            FROM counselle.essays
            WHERE user_id = $1 AND application_id = $2 AND archived_at IS NULL
            ORDER BY created_at
            """,
            user_id,
            application_id,
        )
    return ApplicationDetail(
        application=application,
        tasks=[Task.model_validate(dict(row)) for row in task_rows],
        essays=[EssaySummary.model_validate(dict(row)) for row in essay_rows],
    )


async def _active_unitids(
    app_pool: asyncpg.Pool, user_id: UUID, unitids: list[int]
) -> set[int]:
    if not unitids:
        return set()
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT school_unitid
            FROM counselle.applications
            WHERE user_id = $1 AND archived_at IS NULL
              AND school_unitid = ANY($2::int[])
            """,
            user_id,
            unitids,
        )
    return {row["school_unitid"] for row in rows}


def _website_url(catalog: Catalog, unitid: int) -> str | None:
    domain = catalog.school_domain(unitid)
    return f"https://{domain}" if domain else None


async def _views_from_rows(
    catalog: Catalog, rows: list[asyncpg.Record]
) -> list[ApplicationView]:
    identities = await school_identities(catalog, [row["school_unitid"] for row in rows])
    return [_view_from_row(row, identities.get(row["school_unitid"])) for row in rows]


def _view_from_row(row: asyncpg.Record, school: SchoolIdentity | None) -> ApplicationView:
    data = dict(row)
    data["school_name"] = school.name if school else f"School {row['school_unitid']}"
    data["school_city"] = school.city if school else None
    data["school_state"] = school.state if school else None
    data["website_url"] = school.website_url if school else None
    data["progress"] = Rollup(completed=row["task_completed"], total=row["task_total"])
    data["essays"] = Rollup(completed=row["essay_completed"], total=row["essay_total"])
    return ApplicationView.model_validate(data)


async def _application_view_by_id(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, application_id: UUID
) -> ApplicationView:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            _VIEW_BY_ID_SQL,
            user_id,
            application_id,
        )
    if not rows:
        raise WorkspaceNotFoundError()
    return (await _views_from_rows(catalog, rows))[0]


async def _require_active_application(
    conn: asyncpg.Connection, user_id: UUID, application_id: UUID
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


async def _archive_linked_tasks(
    conn: asyncpg.Connection, user_id: UUID, application_id: UUID
) -> list[dict[str, UUID]]:
    rows = await conn.fetch(
        """
        UPDATE counselle.tasks
        SET archived_at = now(), updated_at = now(),
            archived_via_application = $1
        WHERE user_id = $2 AND application_id = $1 AND archived_at IS NULL
        RETURNING id
        """,
        application_id,
        user_id,
    )
    return [dict(row) for row in rows]


async def _archive_linked_essays(
    conn: asyncpg.Connection, user_id: UUID, application_id: UUID
) -> list[dict[str, UUID]]:
    rows = await conn.fetch(
        """
        UPDATE counselle.essays
        SET archived_at = now(), updated_at = now(),
            archived_via_application = $1
        WHERE user_id = $2 AND application_id = $1 AND archived_at IS NULL
        RETURNING id
        """,
        application_id,
        user_id,
    )
    return [dict(row) for row in rows]


async def _restore_linked_tasks(
    conn: asyncpg.Connection, user_id: UUID, application_id: UUID
) -> list[dict[str, UUID]]:
    rows = await conn.fetch(
        """
        UPDATE counselle.tasks t
        SET archived_at = NULL, updated_at = now(),
            archived_via_application = NULL
        WHERE t.user_id = $1
          AND t.archived_via_application = $2
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
        RETURNING t.id
        """,
        user_id,
        application_id,
    )
    return [dict(row) for row in rows]


async def _restore_linked_essays(
    conn: asyncpg.Connection, user_id: UUID, application_id: UUID
) -> list[dict[str, UUID]]:
    rows = await conn.fetch(
        """
        UPDATE counselle.essays
        SET archived_at = NULL, updated_at = now(),
            archived_via_application = NULL
        WHERE user_id = $1 AND archived_via_application = $2
        RETURNING id
        """,
        user_id,
        application_id,
    )
    return [dict(row) for row in rows]


async def _record_many(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    actor: Actor,
    rows: list[dict[str, UUID]],
    object_type: ObjectType,
    op: ChangeOp,
    application_id: UUID | None = None,
) -> list[ChangeEvent]:
    events: list[ChangeEvent] = []
    for row in rows:
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type=object_type,
            object_id=row["id"],
            op=op,
            application_id=application_id,
        )
        events.append(
            make_change_event(
                change_id=change_id,
                actor=actor,
                object_type=object_type,
                object_id=row["id"],
                op=op,
                application_id=application_id,
            )
        )
    return events
