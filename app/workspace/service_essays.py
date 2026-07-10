"""Essay workspace service functions."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Actor,
    ChangeEvent,
    ChangeOp,
    Essay,
    EssayCreate,
    EssayPatch,
    EssaySummary,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import SchoolIdentity, publish_events, school_identities
from counselle_db.catalog import Catalog

# e.* pulls in the essay's own `deadline` column; the COALESCE below is
# listed after e.* so it overwrites that key with the effective value when
# the row is turned into a dict (last duplicate key wins).
_ESSAY_LIST_SQL = """
SELECT e.*, a.school_unitid,
       COALESCE(e.deadline, a.deadline) AS deadline,
       jsonb_array_length(e.comments) AS comment_count,
       jsonb_array_length(e.suggestions) AS suggestion_count
FROM counselle.essays e
LEFT JOIN counselle.applications a
  ON a.id = e.application_id AND a.user_id = e.user_id
WHERE e.user_id = $1 AND e.archived_at IS NULL
ORDER BY e.updated_at DESC
"""

_ESSAY_GET_SQL = """
SELECT e.*, a.school_unitid,
       COALESCE(e.deadline, a.deadline) AS deadline,
       jsonb_array_length(e.comments) AS comment_count,
       jsonb_array_length(e.suggestions) AS suggestion_count
FROM counselle.essays e
LEFT JOIN counselle.applications a
  ON a.id = e.application_id AND a.user_id = e.user_id
WHERE e.user_id = $1 AND e.archived_at IS NULL AND e.id = $2
"""


async def list_essays(
    app_pool: asyncpg.Pool, catalog: Catalog, *, user_id: UUID
) -> list[EssaySummary]:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(_ESSAY_LIST_SQL, user_id)
    return await _summaries_from_rows(catalog, rows)


async def get_essay(
    app_pool: asyncpg.Pool, catalog: Catalog, *, user_id: UUID, essay_id: UUID
) -> Essay:
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(_ESSAY_GET_SQL, user_id, essay_id)
    if row is None:
        raise WorkspaceNotFoundError()
    return (await _essays_from_rows(catalog, [row]))[0]


async def create_essay(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: EssayCreate,
) -> Essay:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _validate_application(conn, user_id, data.application_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.essays
              (user_id, application_id, title, essay_type, status, prompt,
               content, word_count, word_limit)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            """,
            user_id,
            data.application_id,
            data.title,
            data.essay_type,
            data.status,
            data.prompt,
            data.content,
            _word_count(data.content),
            data.word_limit,
        )
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "created"))
    publish_events(event_bus, user_id, events)
    return await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)


async def update_essay(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    essay_id: UUID,
    data: EssayPatch,
) -> Essay:
    values = data.model_dump(exclude_unset=True)
    expected_updated_at = values.pop("expected_updated_at", None)
    if "content" in values:
        values["word_count"] = _word_count(values["content"])
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        current = await _require_essay(conn, user_id, essay_id)
        _check_not_stale(current["updated_at"], expected_updated_at)
        if "application_id" in values:
            await _validate_application(conn, user_id, values["application_id"])
        row = await _update_essay_row(conn, user_id, essay_id, values) if values else current
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "updated"))
    publish_events(event_bus, user_id, events)
    return await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)


async def duplicate_essay(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    essay_id: UUID,
) -> Essay:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_essay(conn, user_id, essay_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.essays
              (user_id, application_id, title, essay_type, status, prompt,
               content, word_count, word_limit, comments, suggestions)
            SELECT user_id, application_id, 'Copy of ' || title, essay_type,
                   status, prompt, content, word_count, word_limit,
                   comments, suggestions
            FROM counselle.essays
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING *
            """,
            essay_id,
            user_id,
        )
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "created"))
    publish_events(event_bus, user_id, events)
    return await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)


async def archive_essay(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    essay_id: UUID,
) -> None:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.essays
            SET archived_at = now(), updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING *
            """,
            essay_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "archived"))
    publish_events(event_bus, user_id, events)


async def restore_essay(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    essay_id: UUID,
) -> Essay:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.essays e
            SET archived_at = NULL, updated_at = now(),
                archived_via_application = NULL
            WHERE e.id = $1 AND e.user_id = $2 AND e.archived_at IS NOT NULL
              AND (
                e.application_id IS NULL OR EXISTS (
                  SELECT 1 FROM counselle.applications a
                  WHERE a.id = e.application_id AND a.user_id = e.user_id
                    AND a.archived_at IS NULL
                )
              )
            RETURNING e.*
            """,
            essay_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "restored"))
    publish_events(event_bus, user_id, events)
    return await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)


async def _summaries_from_rows(catalog: Catalog, rows: list[asyncpg.Record]) -> list[EssaySummary]:
    identities = await school_identities(
        catalog, [row["school_unitid"] for row in rows if row["school_unitid"] is not None]
    )
    return [_summary_from_row(row, identities.get(row["school_unitid"])) for row in rows]


async def _essays_from_rows(catalog: Catalog, rows: list[asyncpg.Record]) -> list[Essay]:
    identities = await school_identities(
        catalog, [row["school_unitid"] for row in rows if row["school_unitid"] is not None]
    )
    essays = []
    for row in rows:
        data = dict(row)
        _merge_school(data, identities.get(row["school_unitid"]))
        essays.append(Essay.model_validate(data))
    return essays


def _summary_from_row(row: asyncpg.Record, school: SchoolIdentity | None) -> EssaySummary:
    data = dict(row)
    data["preview"] = tiptap_preview(row["content"])
    _merge_school(data, school)
    return EssaySummary.model_validate(data)


def _merge_school(data: dict[str, Any], school: SchoolIdentity | None) -> None:
    data["school_name"] = school.name if school else None
    data["school_city"] = school.city if school else None
    data["school_state"] = school.state if school else None
    data.pop("school_unitid", None)


def tiptap_preview(content: Any, *, max_chars: int = 180) -> str:
    text = " ".join(_tiptap_text(content))
    normalized = re.sub(r"\s+", " ", text).strip()
    return normalized[:max_chars]


def _word_count(content: Any) -> int:
    """Derive word_count server-side from Tiptap content (never caller-supplied)."""
    text = " ".join(_tiptap_text(content))
    normalized = re.sub(r"\s+", " ", text).strip()
    return len(normalized.split()) if normalized else 0


def _check_not_stale(current_updated_at: Any, expected_updated_at: Any | None) -> None:
    """Optimistic-concurrency guard: reject a patch built against a stale read.

    ``expected_updated_at`` is optional — omitting it keeps last-write-wins
    semantics. When present, it must match the essay's current ``updated_at``
    or the caller was working from stale state (e.g. the student's editor
    autosaved between the agent's read and its write).
    """
    if expected_updated_at is not None and current_updated_at != expected_updated_at:
        raise WorkspaceValidationError(
            "essay was updated since expected_updated_at; refresh and retry"
        )


def _tiptap_text(node: Any) -> list[str]:
    if isinstance(node, dict):
        pieces = [node["text"]] if isinstance(node.get("text"), str) else []
        for child in node.get("content", []):
            pieces.extend(_tiptap_text(child))
        return pieces
    if isinstance(node, list):
        list_pieces: list[str] = []
        for child in node:
            list_pieces.extend(_tiptap_text(child))
        return list_pieces
    return []


async def _require_essay(conn: asyncpg.Connection, user_id: UUID, essay_id: UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        SELECT *
        FROM counselle.essays
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        """,
        essay_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _validate_application(
    conn: asyncpg.Connection, user_id: UUID, application_id: object
) -> None:
    if application_id is None:
        return
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


async def _update_essay_row(
    conn: asyncpg.Connection, user_id: UUID, essay_id: UUID, values: dict[str, object]
) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        UPDATE counselle.essays
        SET title = CASE WHEN $3 THEN $4 ELSE title END,
            application_id = CASE WHEN $5 THEN $6 ELSE application_id END,
            essay_type = CASE WHEN $7 THEN $8 ELSE essay_type END,
            status = CASE WHEN $9 THEN $10 ELSE status END,
            prompt = CASE WHEN $11 THEN $12 ELSE prompt END,
            content = CASE WHEN $13 THEN $14 ELSE content END,
            word_count = CASE WHEN $15 THEN $16 ELSE word_count END,
            word_limit = CASE WHEN $17 THEN $18 ELSE word_limit END,
            deadline = CASE WHEN $19 THEN $20 ELSE deadline END,
            updated_at = now()
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        RETURNING *
        """,
        essay_id,
        user_id,
        "title" in values,
        values.get("title"),
        "application_id" in values,
        values.get("application_id"),
        "essay_type" in values,
        values.get("essay_type"),
        "status" in values,
        values.get("status"),
        "prompt" in values,
        values.get("prompt"),
        "content" in values,
        values.get("content"),
        "word_count" in values,
        values.get("word_count"),
        "word_limit" in values,
        values.get("word_limit"),
        "deadline" in values,
        values.get("deadline"),
    )
    if row is None:
        raise WorkspaceNotFoundError()
    return row


async def _record_essay_change(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    essay: Essay,
    op: ChangeOp,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="essay",
        object_id=essay.id,
        op=op,
        application_id=essay.application_id,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="essay",
        object_id=essay.id,
        op=op,
        application_id=essay.application_id,
    )
