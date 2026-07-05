"""Workspace change log and in-process event fanout."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg

from app.workspace.models import Actor, ChangeEvent, ChangeEventData, ChangeOp, ObjectType

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


def _event_from_row(row: asyncpg.Record) -> ChangeEvent:
    object_type = row["object_type"]
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
) -> list[ChangeEvent]:
    """Return persisted changes after ``after_id`` for SSE reconnect catch-up."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_REPLAY_SQL, user_id, after_id, limit)
    return [_event_from_row(row) for row in rows]
