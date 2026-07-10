"""Curated, user-scoped agent-memory persistence services."""

from __future__ import annotations

import unicodedata
from uuid import UUID

import asyncpg

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.memory_context import memory_rendered_char_count
from app.workspace.models import (
    MEMORY_BATCH_MAX_ITEMS,
    MEMORY_BATCH_MIN_ITEMS,
    MEMORY_CONTENT_MAX_LENGTH,
    MEMORY_TOTAL_MAX_CHARS,
    Actor,
    ChangeEvent,
    ChangeOp,
    Memory,
    MemoryCreate,
    MemoryPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import publish_events


async def list_memories(
    app_pool: asyncpg.Pool, *, user_id: UUID, include_archived: bool = False
) -> list[Memory]:
    """Return the user's memory rows, never another user's rows."""
    archived_clause = "" if include_archived else "AND archived_at IS NULL"
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT *
            FROM counselle.memories
            WHERE user_id = $1 {archived_clause}
            ORDER BY created_at
            """,  # nosec B608 -- clause is a fixed internal fragment, not user input
            user_id,
        )
    return [Memory.model_validate(dict(row)) for row in rows]


async def create_memory(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: MemoryCreate,
) -> Memory:
    """Persist one memory note, enforcing the user-wide capacity budget."""
    _require_counselle_actor(actor)
    memories = await create_memories(
        app_pool,
        event_bus,
        user_id=user_id,
        actor=actor,
        data=[data],
    )
    return memories[0]


async def create_memories(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    data: list[MemoryCreate],
) -> list[Memory]:
    """Persist a batch atomically so capacity and duplicate checks cannot drift."""
    _require_counselle_actor(actor)
    if not MEMORY_BATCH_MIN_ITEMS <= len(data) <= MEMORY_BATCH_MAX_ITEMS:
        raise WorkspaceValidationError(
            "remember accepts between "
            f"{MEMORY_BATCH_MIN_ITEMS} and {MEMORY_BATCH_MAX_ITEMS} memory notes"
        )
    contents = [_normalize_content(item.content) for item in data]
    if len(contents) != len(set(contents)):
        raise WorkspaceValidationError("memory notes must be unique")

    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        active = await _locked_active_memories(conn, user_id)
        active_contents = {memory.content for memory in active}
        if active_contents.intersection(contents):
            raise WorkspaceValidationError("memory note already exists")
        _require_capacity(active, contents)

        memories: list[Memory] = []
        for content in contents:
            row = await conn.fetchrow(
                """
                INSERT INTO counselle.memories (user_id, content)
                VALUES ($1, $2)
                RETURNING *
                """,
                user_id,
                content,
            )
            assert row is not None
            memory = Memory.model_validate(dict(row))
            memories.append(memory)
            events.append(await _record_change(conn, user_id, actor, memory.id, "created"))
    publish_events(event_bus, user_id, events)
    return memories


async def update_memory(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    memory_id: UUID,
    data: MemoryPatch,
) -> Memory:
    """Replace an active note, with ownership, duplicate, and budget checks."""
    _require_counselle_actor(actor)
    content = _normalize_content(data.content)
    async with app_pool.acquire() as conn, conn.transaction():
        active = await _locked_active_memories(conn, user_id)
        current = next((memory for memory in active if memory.id == memory_id), None)
        if current is None:
            raise WorkspaceNotFoundError()
        if content != current.content and any(memory.content == content for memory in active):
            raise WorkspaceValidationError("memory note already exists")
        _require_capacity([memory for memory in active if memory.id != memory_id], [content])
        row = await conn.fetchrow(
            """
            UPDATE counselle.memories
            SET content = $3, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING *
            """,
            memory_id,
            user_id,
            content,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        memory = Memory.model_validate(dict(row))
        event = await _record_change(conn, user_id, actor, memory.id, "updated")
    publish_events(event_bus, user_id, [event])
    return memory


async def archive_memory(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    memory_id: UUID,
) -> None:
    """Soft-delete one active note while retaining an auditable change row."""
    _require_student_actor(actor)
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.memories
            SET archived_at = now(), updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING id
            """,
            memory_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        event = await _record_change(conn, user_id, actor, row["id"], "archived")
    publish_events(event_bus, user_id, [event])


async def restore_memory(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    memory_id: UUID,
) -> Memory:
    """Restore an archived note only when it still fits the active memory budget."""
    _require_counselle_actor(actor)
    async with app_pool.acquire() as conn, conn.transaction():
        active = await _locked_active_memories(conn, user_id)
        row = await conn.fetchrow(
            """
            SELECT *
            FROM counselle.memories
            WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
            FOR UPDATE
            """,
            memory_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        archived = Memory.model_validate(dict(row))
        if any(memory.content == archived.content for memory in active):
            raise WorkspaceValidationError("memory note already exists")
        _require_capacity(active, [archived.content])
        restored_row = await conn.fetchrow(
            """
            UPDATE counselle.memories
            SET archived_at = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
            RETURNING *
            """,
            memory_id,
            user_id,
        )
        if restored_row is None:
            raise WorkspaceNotFoundError()
        memory = Memory.model_validate(dict(restored_row))
        event = await _record_change(conn, user_id, actor, memory.id, "restored")
    publish_events(event_bus, user_id, [event])
    return memory


async def _locked_active_memories(conn: asyncpg.Connection, user_id: UUID) -> list[Memory]:
    # Serializes writes for one user even when they have no existing memory rows.
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        user_id,
    )
    rows = await conn.fetch(
        """
        SELECT *
        FROM counselle.memories
        WHERE user_id = $1 AND archived_at IS NULL
        FOR UPDATE
        """,
        user_id,
    )
    return [Memory.model_validate(dict(row)) for row in rows]


def _normalize_content(content: str) -> str:
    normalized = " ".join(
        "".join(
            " " if char.isspace() else char
            for char in content
            if unicodedata.category(char) not in {"Cc", "Cf"} or char.isspace()
        ).split()
    )
    if not normalized:
        raise WorkspaceValidationError("memory content cannot be empty")
    if len(normalized) > MEMORY_CONTENT_MAX_LENGTH:
        raise WorkspaceValidationError("memory content is too long")
    return normalized


def _require_capacity(active: list[Memory], additions: list[str]) -> None:
    contents = [*(memory.content for memory in active), *additions]
    if memory_rendered_char_count(contents) > MEMORY_TOTAL_MAX_CHARS:
        raise WorkspaceValidationError("memory capacity exceeded; consolidate existing notes first")


def _require_counselle_actor(actor: Actor) -> None:
    if actor != "counselle":
        raise WorkspaceValidationError(
            "memories can only be created, updated, or restored by Counselle"
        )


def _require_student_actor(actor: Actor) -> None:
    if actor != "student":
        raise WorkspaceValidationError("memories can only be deleted by students")


async def _record_change(
    conn: asyncpg.Connection, user_id: UUID, actor: Actor, memory_id: UUID, op: ChangeOp
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="memory",
        object_id=memory_id,
        op=op,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="memory",
        object_id=memory_id,
        op=op,
    )
