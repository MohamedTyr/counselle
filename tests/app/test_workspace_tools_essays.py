"""Live DB gate tests for the Phase 2 agent essay read tools (view_essays, read_essay).

Mirrors the fixture pattern in ``test_workspace_tools.py`` — each live test
module owns its own ``app_pool``/``catalog``/``make_user`` fixtures.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.agent_tools_essays import make_read_essay_tool, make_view_essays_tool
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ApplicationCreate, EssayCreate
from app.workspace.service_applications import add_application
from app.workspace.service_essays import archive_essay, create_essay
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
                f"{user_id}@workspace-tools-essays.test",
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


def _unitid(catalog: Catalog, offset: int = 0) -> int:
    return sorted(catalog.school_names)[offset]


def _ctx(app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID) -> ToolCtx:
    return ToolCtx(
        app_pool=app_pool,
        catalog=catalog,
        workspace_events=WorkspaceEventBus(),
        user_id=user_id,
        tool_overflow=None,
    )


def _essay_content(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


async def test_view_essays_empty_library(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_view_essays_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function()

    assert result["status"] == "ok"
    assert result["essays"] == []
    assert "empty" in result["summary"].lower()


async def test_view_essays_lists_and_sorts_by_deadline(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    app = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), cycle_year=2027, list_type="Target", round="RD"),
    )
    undated = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Undated essay", application_id=app.application.id),
    )
    dated = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Dated essay", application_id=app.application.id),
    )

    tool = make_view_essays_tool(_ctx(app_pool, catalog, user_id))
    result = await tool.function()

    assert result["status"] == "ok"
    ids = {row["id"] for row in result["essays"]}
    assert ids == {str(undated.id), str(dated.id)}
    dated_row = next(r for r in result["essays"] if r["id"] == str(dated.id))
    assert dated_row["school"]
    assert dated_row["words"] == "0"


async def test_view_essays_archived_status_shows_archived_essays(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="To archive"),
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=essay.id
    )

    tool = make_view_essays_tool(_ctx(app_pool, catalog, user_id))
    active_result = await tool.function()
    assert active_result["essays"] == []

    archived_result = await tool.function(status="archived")
    assert len(archived_result["essays"]) == 1
    assert archived_result["essays"][0]["state"] == "archived"


async def test_view_essays_archived_status_with_application_filter_matches_correctly(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """Regression: combining status="archived" with application_id used to
    unconditionally return zero rows instead of filtering."""
    user_id = await make_user()
    app = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), cycle_year=2027, list_type="Target", round="RD"),
    )
    linked = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Linked essay", application_id=app.application.id),
    )
    unlinked = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Unlinked essay"),
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=linked.id
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=unlinked.id
    )

    tool = make_view_essays_tool(_ctx(app_pool, catalog, user_id))
    result = await tool.function(status="archived", application_id=str(app.application.id))

    ids = {row["id"] for row in result["essays"]}
    assert ids == {str(linked.id)}


async def test_read_essay_returns_markdown_content_and_version(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft essay", content=_essay_content("Hello world.")),
    )

    tool = make_read_essay_tool(_ctx(app_pool, catalog, user_id))
    result = await tool.function(essay_id=str(essay.id))

    assert result["status"] == "ok"
    assert result["content_markdown"] == "Hello world."
    assert result["version"] == essay.updated_at.isoformat()
    assert result["essay"]["title"] == "Draft essay"


async def test_read_essay_empty_essay_has_empty_content_and_draft_footer(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Empty essay"),
    )

    tool = make_read_essay_tool(_ctx(app_pool, catalog, user_id))
    result = await tool.function(essay_id=str(essay.id))

    assert result["content_markdown"] == ""
    assert "empty" in result["footer"].lower()


async def test_read_essay_unknown_id_returns_stale_essay_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_read_essay_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essay_id=str(uuid4()))

    assert result["status"] == "error"
    assert result["retryable"] is False


async def test_read_essay_invalid_uuid_hits_stale_error_not_crash(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_read_essay_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essay_id="not-a-uuid")

    assert result["status"] == "error"
