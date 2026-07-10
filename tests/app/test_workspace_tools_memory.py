"""Live DB tests for the Phase 4 agent memory tools (remember/update_memory/forget).

Mirrors the fixture pattern in ``test_workspace_tools_essays.py``. Focused on
the genuinely new tool-layer logic (earn-their-place rule, AGENTS.md): the
Hermes-style capacity error, exact-duplicate rejection naming the existing
note, and ``forget``'s per-item batch results. Stale-ref envelopes and batch
size bounds reuse the same shapes already pinned by the task/essay tool
suites and are not re-tested in depth here.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.agent_tools_memory import (
    make_forget_tool,
    make_remember_tool,
    make_update_memory_tool,
)
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.memory_context import memory_rendered_char_count
from app.workspace.models import MEMORY_TOTAL_MAX_CHARS
from app.workspace.service_memory import list_memories
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

pytestmark = pytest.mark.live_db


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def catalog() -> AsyncIterator[Catalog]:
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def make_user(
    app_pool: asyncpg.Pool,
) -> AsyncIterator[Callable[[], Awaitable[UUID]]]:
    created: list[UUID] = []

    async def _make_user() -> UUID:
        user_id = uuid4()
        async with app_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.users
                  (id, email, hashed_password, is_active, is_superuser, is_verified)
                VALUES ($1, $2, $3, true, false, false)
                """,
                user_id,
                f"{user_id}@workspace-tools-memory.test",
                "not-a-real-password-hash",
            )
        created.append(user_id)
        return user_id

    try:
        yield _make_user
    finally:
        async with app_pool.acquire() as conn:
            for user_id in created:
                await conn.execute("DELETE FROM counselle.users WHERE id = $1", user_id)


def _ctx(app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID) -> ToolCtx:
    return ToolCtx(
        app_pool=app_pool,
        catalog=catalog,
        workspace_events=WorkspaceEventBus(),
        user_id=user_id,
        tool_overflow=None,
    )


# --------------------------------------------------------------------------
# remember
# --------------------------------------------------------------------------


async def test_remember_creates_notes_and_returns_usage_meter(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_remember_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(notes=["prefers blunt feedback"])

    assert result["status"] == "ok"
    assert len(result["notes"]) == 1
    assert result["notes"][0]["content"] == "prefers blunt feedback"
    assert "chars" in result["usage"]


async def test_remember_rejects_exact_duplicate_naming_the_existing_note(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_remember_tool(_ctx(app_pool, catalog, user_id))
    await tool.function(notes=["prefers blunt feedback"])

    result = await tool.function(notes=["prefers blunt feedback"])

    assert result["status"] == "error"
    assert "prefers blunt feedback" in result["error"]
    assert result["retryable"] is True


async def test_remember_over_budget_returns_capacity_error_teaching_consolidation(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_remember_tool(_ctx(app_pool, catalog, user_id))

    index = 0
    while True:
        note = f"{index:04d}-" + "x" * 195  # 200 chars, unique per index
        active = await list_memories(app_pool, user_id=user_id)
        projected = memory_rendered_char_count([*(m.content for m in active), note])
        if projected > MEMORY_TOTAL_MAX_CHARS:
            break
        result = await tool.function(notes=[note])
        assert result["status"] == "ok"
        index += 1

    overflow_note = f"{index:04d}-" + "x" * 195
    result = await tool.function(notes=[overflow_note])

    assert result["status"] == "error"
    assert result["retryable"] is True
    assert "consolidate" in result["recovery"].lower() or "merge" in result["recovery"].lower()


# --------------------------------------------------------------------------
# update_memory
# --------------------------------------------------------------------------


async def test_update_memory_resolves_prefix_and_rewrites_content(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    ctx = _ctx(app_pool, catalog, await make_user())
    remember_tool = make_remember_tool(ctx)
    created = await remember_tool.function(notes=["decided: no pre-med angle"])
    note_prefix = created["notes"][0]["id"]

    update_tool = make_update_memory_tool(ctx)
    result = await update_tool.function(
        memory_ref=note_prefix, content="decided firmly: pure research track"
    )

    assert result["status"] == "ok"
    assert result["note"]["content"] == "decided firmly: pure research track"


# --------------------------------------------------------------------------
# forget — per-item batch results
# --------------------------------------------------------------------------


async def test_forget_reports_forgotten_and_skipped_per_item(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    ctx = _ctx(app_pool, catalog, await make_user())
    remember_tool = make_remember_tool(ctx)
    created = await remember_tool.function(notes=["note one", "note two"])
    keep_id, forget_id = (created["notes"][0]["id"], created["notes"][1]["id"])

    forget_tool = make_forget_tool(ctx)
    result = await forget_tool.function(memory_refs=[forget_id, "deadbeef"])

    assert result["status"] == "warning"
    assert result["forgotten"] == [{"id": forget_id, "content": "note two"}]
    assert result["skipped"] == [{"id": "deadbeef", "reason": "not found or already forgotten"}]

    remaining = await list_memories(app_pool, user_id=ctx.user_id)
    assert [str(m.id)[:8] for m in remaining] == [keep_id]
