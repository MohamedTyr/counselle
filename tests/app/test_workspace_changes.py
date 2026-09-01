"""Workspace change-log and event-bus behavior."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.changes import (
    WorkspaceEventBus,
    _event_from_row,
    make_change_event,
    record_change,
    replay_changes,
)
from config.settings import get_settings
from counselle_db.db import create_pool


class _FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, sql: str, *args: object) -> int:
        self.calls.append((sql, args))
        return 41


async def test_record_change_uses_parameterized_insert() -> None:
    conn = _FakeConn()
    user_id = uuid4()
    object_id = uuid4()
    application_id = uuid4()

    change_id = await record_change(
        conn,
        user_id=user_id,
        actor="counselle",
        object_type="task",
        object_id=object_id,
        op="updated",
        application_id=application_id,
    )

    sql, args = conn.calls[0]
    assert change_id == 41
    assert "$1" in sql and "$6" in sql
    assert args == (user_id, "counselle", "task", object_id, "updated", application_id)


def test_event_from_row_skips_retired_object_type_but_builds_valid_ones() -> None:
    object_id = uuid4()
    application_id = uuid4()
    retired_row = {
        "id": 1,
        "actor": "student",
        "object_type": "essay_prompt_draft",
        "object_id": object_id,
        "op": "created",
        "application_id": None,
    }
    valid_row = {
        "id": 2,
        "actor": "counselle",
        "object_type": "task",
        "object_id": object_id,
        "op": "updated",
        "application_id": application_id,
    }

    assert _event_from_row(retired_row) is None

    event = _event_from_row(valid_row)
    assert event is not None
    assert event.id == 2
    assert event.type == "task.updated"
    assert event.data.object_type == "task"
    assert event.data.object_id == object_id
    assert event.data.op == "updated"
    assert event.data.actor == "counselle"
    assert event.data.application_id == application_id


async def test_event_bus_delivers_to_matching_user_only() -> None:
    bus = WorkspaceEventBus(queue_size=2)
    user_id = uuid4()
    other_user_id = uuid4()
    event = make_change_event(
        change_id=1,
        actor="student",
        object_type="application",
        object_id=uuid4(),
        op="created",
    )

    async with bus.subscribe(user_id) as queue, bus.subscribe(other_user_id) as other_queue:
        bus.publish(user_id, event)

        assert await queue.get() == event
        assert other_queue.empty()


async def test_event_bus_drop_oldest_on_overflow() -> None:
    bus = WorkspaceEventBus(queue_size=2)
    user_id = uuid4()
    events = [
        make_change_event(
            change_id=i,
            actor="student",
            object_type="task",
            object_id=uuid4(),
            op="updated",
        )
        for i in range(1, 4)
    ]

    async with bus.subscribe(user_id) as queue:
        for event in events:
            bus.publish(user_id, event)

        assert [await queue.get(), await queue.get()] == events[1:]


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest.mark.live_db
async def test_record_change_and_replay_roundtrip(app_pool: asyncpg.Pool) -> None:
    user_id = uuid4()
    object_id = uuid4()
    async with app_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO counselle.users
              (id, email, hashed_password, is_active, is_superuser, is_verified)
            VALUES ($1, $2, $3, true, false, false)
            """,
            user_id,
            f"{user_id}@example.test",
            "not-a-real-password-hash",
        )
        try:
            async with conn.transaction():
                change_id = await record_change(
                    conn,
                    user_id=user_id,
                    actor="student",
                    object_type="activity",
                    object_id=object_id,
                    op="created",
                )

            events, last_row_id, row_count = await replay_changes(
                app_pool, user_id=user_id, after_id=change_id - 1, limit=10
            )

            assert len(events) == 1
            assert row_count == 1
            assert last_row_id == change_id
            assert events[0].id == change_id
            assert events[0].type == "activity.created"
            assert events[0].data.object_id == object_id
        finally:
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", user_id)
