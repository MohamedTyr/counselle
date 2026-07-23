"""Essay prompt draft workspace service functions.

A prompt draft is student-typed prompt text tracked against a school before
the student commits to writing — see plans/school-essay-prompts-draft.md.
Converting a draft to an essay soft-archives the draft with a
``converted_to_essay_id`` tombstone (ADR 0027: deletes are soft archives).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    Actor,
    ChangeEvent,
    ChangeOp,
    Essay,
    EssayPromptDraft,
    EssayPromptDraftConvert,
    EssayPromptDraftCreate,
    EssayPromptDraftSummary,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import SchoolIdentity, publish_events, school_identities
from counselle_db.catalog import Catalog

_LIST_SQL = """
SELECT d.*, a.school_unitid
FROM counselle.essay_prompt_drafts d
JOIN counselle.applications a ON a.id = d.application_id AND a.user_id = d.user_id
WHERE d.user_id = $1 AND d.archived_at IS NULL
ORDER BY d.created_at
"""

_GET_SQL = """
SELECT d.*, a.school_unitid
FROM counselle.essay_prompt_drafts d
JOIN counselle.applications a ON a.id = d.application_id AND a.user_id = d.user_id
WHERE d.user_id = $1 AND d.archived_at IS NULL AND d.id = $2
"""


async def list_essay_prompt_drafts(
    app_pool: asyncpg.Pool, catalog: Catalog, *, user_id: UUID
) -> list[EssayPromptDraftSummary]:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(_LIST_SQL, user_id)
    return await _summaries_from_rows(catalog, rows)


async def get_essay_prompt_draft(
    app_pool: asyncpg.Pool, catalog: Catalog, *, user_id: UUID, draft_id: UUID
) -> EssayPromptDraftSummary:
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(_GET_SQL, user_id, draft_id)
    if row is None:
        raise WorkspaceNotFoundError()
    return (await _summaries_from_rows(catalog, [row]))[0]


async def create_essay_prompt_draft(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: EssayPromptDraftCreate,
) -> EssayPromptDraftSummary:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _validate_application(conn, user_id, data.application_id)
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.essay_prompt_drafts (user_id, application_id, prompt, word_limit)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            """,
            user_id,
            data.application_id,
            data.prompt,
            data.word_limit,
        )
        draft = EssayPromptDraft.model_validate(dict(row))
        events.append(await _record_draft_change(conn, user_id, actor, draft, "created"))
    publish_events(event_bus, user_id, events)
    return await get_essay_prompt_draft(app_pool, catalog, user_id=user_id, draft_id=draft.id)


async def archive_essay_prompt_draft(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    draft_id: UUID,
) -> EssayPromptDraft:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.essay_prompt_drafts
            SET archived_at = now(), updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING *
            """,
            draft_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        draft = EssayPromptDraft.model_validate(dict(row))
        events.append(await _record_draft_change(conn, user_id, actor, draft, "archived"))
    publish_events(event_bus, user_id, events)
    return draft


async def restore_essay_prompt_draft(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    draft_id: UUID,
) -> EssayPromptDraftSummary:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        current = await conn.fetchrow(
            """
            SELECT * FROM counselle.essay_prompt_drafts
            WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
            FOR UPDATE
            """,
            draft_id,
            user_id,
        )
        if current is None:
            raise WorkspaceNotFoundError()
        if current["converted_to_essay_id"] is not None:
            raise WorkspaceValidationError(
                "this prompt was already converted to an essay and cannot be restored as a prompt"
            )
        await _validate_application(conn, user_id, current["application_id"])
        row = await conn.fetchrow(
            """
            UPDATE counselle.essay_prompt_drafts
            SET archived_at = NULL, updated_at = now(), archived_via_application = NULL
            WHERE id = $1 AND user_id = $2
            RETURNING *
            """,
            draft_id,
            user_id,
        )
        draft = EssayPromptDraft.model_validate(dict(row))
        events.append(await _record_draft_change(conn, user_id, actor, draft, "restored"))
    publish_events(event_bus, user_id, events)
    return await get_essay_prompt_draft(app_pool, catalog, user_id=user_id, draft_id=draft.id)


async def convert_essay_prompt_draft(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    draft_id: UUID,
    data: EssayPromptDraftConvert,
) -> Essay:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        application_row = await conn.fetchrow(
            """
            SELECT id, school_unitid
            FROM counselle.applications
            WHERE id = (
              SELECT application_id FROM counselle.essay_prompt_drafts
              WHERE id = $1 AND user_id = $2
            ) AND user_id = $2 AND archived_at IS NULL
            FOR UPDATE
            """,
            draft_id,
            user_id,
        )
        if application_row is None:
            raise WorkspaceNotFoundError()
        draft_row = await conn.fetchrow(
            """
            SELECT * FROM counselle.essay_prompt_drafts
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
              AND application_id = $3
            FOR UPDATE
            """,
            draft_id,
            user_id,
            application_row["id"],
        )
        if draft_row is None:
            raise WorkspaceNotFoundError()
        essay_row = await conn.fetchrow(
            """
            INSERT INTO counselle.essays
              (user_id, application_id, title, essay_type, status, prompt, word_limit)
            VALUES ($1, $2, $3, $4, 'Not started', $5, $6)
            RETURNING *
            """,
            user_id,
            draft_row["application_id"],
            data.title,
            data.essay_type,
            draft_row["prompt"],
            draft_row["word_limit"],
        )
        essay = Essay.model_validate(dict(essay_row))
        events.append(await _record_essay_created_change(conn, user_id, actor, essay))
        archived_row = await conn.fetchrow(
            """
            UPDATE counselle.essay_prompt_drafts
            SET archived_at = now(), updated_at = now(), converted_to_essay_id = $3
            WHERE id = $1 AND user_id = $2
            RETURNING *
            """,
            draft_id,
            user_id,
            essay.id,
        )
        archived_draft = EssayPromptDraft.model_validate(dict(archived_row))
        events.append(
            await _record_draft_change(conn, user_id, actor, archived_draft, "archived")
        )
    publish_events(event_bus, user_id, events)
    identities = await school_identities(catalog, [application_row["school_unitid"]])
    school = identities.get(application_row["school_unitid"])
    return _merge_essay_school(essay, school)


async def _summaries_from_rows(
    catalog: Catalog, rows: list[asyncpg.Record]
) -> list[EssayPromptDraftSummary]:
    identities = await school_identities(catalog, [row["school_unitid"] for row in rows])
    return [_summary_from_row(row, identities.get(row["school_unitid"])) for row in rows]


def _summary_from_row(
    row: asyncpg.Record, school: SchoolIdentity | None
) -> EssayPromptDraftSummary:
    data = dict(row)
    data["school_name"] = school.name if school else None
    data["school_city"] = school.city if school else None
    data["school_state"] = school.state if school else None
    data["school_website_url"] = school.website_url if school else None
    data.pop("school_unitid", None)
    return EssayPromptDraftSummary.model_validate(data)


def _merge_essay_school(essay: Essay, school: SchoolIdentity | None) -> Essay:
    return essay.model_copy(
        update={
            "school_name": school.name if school else None,
            "school_city": school.city if school else None,
            "school_state": school.state if school else None,
            "school_website_url": school.website_url if school else None,
        }
    )


async def _validate_application(
    conn: asyncpg.Connection, user_id: UUID, application_id: object
) -> None:
    row = await conn.fetchrow(
        """
        SELECT id
        FROM counselle.applications
        WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
        FOR UPDATE
        """,
        application_id,
        user_id,
    )
    if row is None:
        raise WorkspaceNotFoundError()


async def _record_draft_change(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    draft: EssayPromptDraft,
    op: ChangeOp,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="essay_prompt_draft",
        object_id=draft.id,
        op=op,
        application_id=draft.application_id,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="essay_prompt_draft",
        object_id=draft.id,
        op=op,
        application_id=draft.application_id,
    )


async def _record_essay_created_change(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    essay: Essay,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="essay",
        object_id=essay.id,
        op="created",
        application_id=essay.application_id,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="essay",
        object_id=essay.id,
        op="created",
        application_id=essay.application_id,
    )
