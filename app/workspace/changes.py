"""Workspace change log and in-process event fanout."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import get_args
from uuid import UUID

import asyncpg

from app.workspace.models import Actor, ChangeEvent, ChangeEventData, ChangeOp, ObjectType

#: Object types the current model accepts. Historical `workspace_changes` rows
#: can carry a retired `object_type` (e.g. "essay_prompt_draft", dropped from
#: `ObjectType` ahead of the migration that deletes those rows) — derive the
#: valid set from the Literal itself so it never drifts out of sync.
_VALID_OBJECT_TYPES = frozenset(get_args(ObjectType))

_INSERT_SQL = """
INSERT INTO counselle.workspace_changes
  (user_id, actor, object_type, object_id, op, application_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id
"""

_REPLAY_SQL = """
SELECT id, actor, object_type, object_id, op, application_id
FROM counselle.workspace_changes
WHERE user_id = $1 AND id > $2
ORDER BY id
LIMIT $3
"""


def _event_from_row(row: asyncpg.Record) -> ChangeEvent | None:
    object_type = row["object_type"]
    if object_type not in _VALID_OBJECT_TYPES:
        # A row from a retired object type (see `_VALID_OBJECT_TYPES`).
        # `ChangeEventData.object_type` is a Literal, so building one here
        # would raise a ValidationError and abort the whole SSE replay batch
        # for any user who ever touched the retired feature. Skip it instead
        # — do not tighten this back into a hard construct.
        return None
    op = row["op"]
    return ChangeEvent(
        id=row["id"],
        type=f"{object_type}.{op}",
        data=ChangeEventData(
            object_type=object_type,
            object_id=row["object_id"],
            op=op,
            actor=row["actor"],
            application_id=row["application_id"],
        ),
    )


def make_change_event(
    *,
    change_id: int,
    actor: Actor,
    object_type: ObjectType,
    object_id: UUID,
    op: ChangeOp,
    application_id: UUID | None = None,
) -> ChangeEvent:
    """Build the thin invalidation event after a mutation commits."""
    return ChangeEvent(
        id=change_id,
        type=f"{object_type}.{op}",
        data=ChangeEventData(
            object_type=object_type,
            object_id=object_id,
            op=op,
            actor=actor,
            application_id=application_id,
        ),
    )


async def record_change(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    actor: Actor,
    object_type: ObjectType,
    object_id: UUID,
    op: ChangeOp,
    application_id: UUID | None = None,
) -> int:
    """Insert a change-log row inside the caller's transaction and return its id."""
    change_id = await conn.fetchval(
        _INSERT_SQL, user_id, actor, object_type, object_id, op, application_id
    )
    return int(change_id)


class WorkspaceEventBus:
    """Per-user in-process queues for post-commit workspace change events."""

    def __init__(self, *, queue_size: int = 256) -> None:
        self.queue_size = queue_size
        self._queues: dict[UUID, set[asyncio.Queue[ChangeEvent]]] = {}

    @asynccontextmanager
    async def subscribe(self, user_id: UUID) -> AsyncIterator[asyncio.Queue[ChangeEvent]]:
        queue: asyncio.Queue[ChangeEvent] = asyncio.Queue(maxsize=self.queue_size)
        self._queues.setdefault(user_id, set()).add(queue)
        try:
            yield queue
        finally:
            self.unsubscribe(user_id, queue)

    def unsubscribe(self, user_id: UUID, queue: asyncio.Queue[ChangeEvent]) -> None:
        queues = self._queues.get(user_id)
        if queues is None:
            return
        queues.discard(queue)
        if not queues:
            self._queues.pop(user_id, None)

    def publish(self, user_id: UUID, event: ChangeEvent) -> None:
        for queue in list(self._queues.get(user_id, ())):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)


async def replay_changes(
    pool: asyncpg.Pool, *, user_id: UUID, after_id: int, limit: int
) -> tuple[list[ChangeEvent], int, int]:
    """Return persisted changes after ``after_id`` for SSE reconnect catch-up.

    Returns ``(events, last_row_id, row_count)``. ``last_row_id`` and
    ``row_count`` describe the rows actually read from the database, not the
    events that survived filtering — rows with a retired `object_type` are
    dropped from ``events``, so a caller must page/terminate off the row
    count, or a page that is entirely filtered out looks like "no more rows"
    and truncates the replay.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(_REPLAY_SQL, user_id, after_id, limit)
    events = [event for row in rows if (event := _event_from_row(row)) is not None]
    last_row_id = rows[-1]["id"] if rows else after_id
    return events, last_row_id, len(rows)
