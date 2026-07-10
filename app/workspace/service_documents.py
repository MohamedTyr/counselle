"""Student document metadata and byte persistence services."""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    DOCUMENT_MAX_BYTES,
    Actor,
    ChangeOp,
    Document,
    DocumentContent,
    DocumentCreate,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import publish_events

_METADATA_COLUMNS = """
id, user_id, title, doc_type, filename, mime, size_bytes, text_status,
summary, created_at, archived_at
"""


async def list_documents(
    app_pool: asyncpg.Pool, *, user_id: UUID, include_archived: bool = False
) -> list[Document]:
    """List only this user's documents, newest first."""
    archived_clause = "" if include_archived else "AND archived_at IS NULL"
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT {_METADATA_COLUMNS}
            FROM counselle.documents
            WHERE user_id = $1 {archived_clause}
            ORDER BY created_at DESC
            """,  # nosec B608 -- clause is a fixed internal fragment, not user input
            user_id,
        )
    return [Document.model_validate(dict(row)) for row in rows]


async def create_document(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: DocumentCreate,
) -> Document:
    """Persist a prepared document; extraction and upload policy live above this layer."""
    _require_student_actor(actor)
    if len(data.content) > DOCUMENT_MAX_BYTES:
        raise WorkspaceValidationError("document exceeds the 15 MiB size limit")
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.documents
              (user_id, title, doc_type, filename, mime, size_bytes, content,
               extracted_text, text_status, summary)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, user_id, title, doc_type, filename, mime, size_bytes, text_status,
                      summary, created_at, archived_at
            """,
            user_id,
            data.title,
            data.doc_type,
            data.filename,
            data.mime,
            len(data.content),
            data.content,
            data.extracted_text,
            data.text_status,
            data.summary,
        )
        assert row is not None
        document = Document.model_validate(dict(row))
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type="document",
            object_id=document.id,
            op="created",
        )
    _publish_change(event_bus, user_id, actor, document.id, "created", change_id)
    return document


async def get_document(app_pool: asyncpg.Pool, *, user_id: UUID, document_id: UUID) -> Document:
    """Return active document metadata, hiding both missing and foreign rows."""
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT {_METADATA_COLUMNS}
            FROM counselle.documents
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            """,  # nosec B608 -- selected columns are a fixed module constant
            document_id,
            user_id,
        )
    if row is None:
        raise WorkspaceNotFoundError()
    return Document.model_validate(dict(row))


async def read_document(
    app_pool: asyncpg.Pool, *, user_id: UUID, document_id: UUID
) -> DocumentContent:
    """Return active document bytes only to its owner."""
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT {_METADATA_COLUMNS}, content, extracted_text
            FROM counselle.documents
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            """,  # nosec B608 -- selected columns are a fixed module constant
            document_id,
            user_id,
        )
    if row is None:
        raise WorkspaceNotFoundError()
    return DocumentContent.model_validate(dict(row))


async def archive_document(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    document_id: UUID,
) -> None:
    """Soft-delete an active document owned by ``user_id``."""
    _require_student_actor(actor)
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.documents
            SET archived_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING id
            """,
            document_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type="document",
            object_id=row["id"],
            op="archived",
        )
    _publish_change(event_bus, user_id, actor, row["id"], "archived", change_id)


async def restore_document(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    document_id: UUID,
) -> Document:
    """Restore an archived document owned by ``user_id``."""
    _require_student_actor(actor)
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            f"""
            UPDATE counselle.documents
            SET archived_at = NULL
            WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
            RETURNING {_METADATA_COLUMNS}
            """,  # nosec B608 -- selected columns are a fixed module constant
            document_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        document = Document.model_validate(dict(row))
        change_id = await record_change(
            conn,
            user_id=user_id,
            actor=actor,
            object_type="document",
            object_id=document.id,
            op="restored",
        )
    _publish_change(event_bus, user_id, actor, document.id, "restored", change_id)
    return document


def _publish_change(
    event_bus: WorkspaceEventBus,
    user_id: UUID,
    actor: Actor,
    document_id: UUID,
    op: ChangeOp,
    change_id: int,
) -> None:
    event = make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="document",
        object_id=document_id,
        op=op,
    )
    publish_events(event_bus, user_id, [event])


def _require_student_actor(actor: Actor) -> None:
    if actor != "student":
        raise WorkspaceValidationError("documents can only be modified by students")
