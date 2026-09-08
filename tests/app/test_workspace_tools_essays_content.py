"""Live DB gate tests for the Phase 4 essay content agent tools (edit_essay, write_essay)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.agent_tools_essays import make_read_essay_tool
from app.workspace.agent_tools_essays_content import (
    EditItem,
    make_edit_essay_tool,
    make_write_essay_tool,
)
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import EssayCreate, EssayPatch
from app.workspace.service_essays import create_essay, get_essay, update_essay
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
                f"{user_id}@workspace-tools-essays-content.test",
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


def _content(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


async def test_edit_essay_applies_targeted_edit(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("The board hissed.")),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    edit_result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[EditItem(old_text="hissed", new_text="hissed back")],
    )

    assert edit_result["status"] == "ok"
    assert edit_result["summary"] == "Applied 1 edit."
    mutation = edit_result["public_receipt"]["mutation"]
    assert mutation["family"] == "essay_content"
    assert mutation["action"] == "edit"
    assert len(mutation["body"]["operations"]) == 1
    assert mutation["body"]["operations"][0]["operation"] == "replace"

    reread = await read_tool.function(essay_id=str(essay.id))
    assert reread["content_markdown"] == "The board hissed back."


async def test_edit_essay_stale_version_is_retryable_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("Original text.")),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    # Simulate a concurrent student autosave between read and edit.
    await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(content=_content("Student typed something else.")),
    )

    edit_result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[EditItem(old_text="Original", new_text="Changed")],
    )

    assert edit_result["status"] == "error"
    assert edit_result["retryable"] is True


async def test_edit_essay_ambiguous_match_applies_nothing(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("repeat repeat")),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    edit_result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[EditItem(old_text="repeat", new_text="once")],
    )

    assert edit_result["status"] == "error"
    assert edit_result["retryable"] is True

    reread = await read_tool.function(essay_id=str(essay.id))
    assert reread["content_markdown"] == "repeat repeat"


async def test_edit_essay_over_word_limit_warns_but_saves(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("one two three"), word_limit=2),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    edit_result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[EditItem(old_text="three", new_text="three four")],
    )

    assert edit_result["status"] == "ok"
    assert "warning" in edit_result


async def test_write_essay_replaces_content(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("Old draft.")),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    write_tool = make_write_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    write_result = await write_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        content_markdown="Brand new full draft.",
    )

    assert write_result["status"] == "ok"
    mutation = write_result["public_receipt"]["mutation"]
    assert mutation["family"] == "essay_content"
    assert mutation["action"] == "write"
    assert mutation["body"]["mode"] == "replaced"
    assert mutation["body"]["previous_word_count"] == 2
    reread = await read_tool.function(essay_id=str(essay.id))
    assert reread["content_markdown"] == "Brand new full draft."


async def test_write_essay_refuses_empty_content(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("Keep me.")),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    write_tool = make_write_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    write_result = await write_tool.function(
        essay_id=str(essay.id), expected_version=read_result["version"], content_markdown="   "
    )

    assert write_result["status"] == "error"
    assert write_result["retryable"] is False

    reread = await read_tool.function(essay_id=str(essay.id))
    assert reread["content_markdown"] == "Keep me."


def _suggest_ctx(app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID) -> ToolCtx:
    return ToolCtx(
        app_pool=app_pool,
        catalog=catalog,
        workspace_events=WorkspaceEventBus(),
        user_id=user_id,
        tool_overflow=None,
        write_mode="suggest",
        turn_message_id=str(uuid4()),
    )


async def test_edit_essay_in_suggest_mode_proposes_without_writing_content(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """The essay panel's sink: the same tool call, a reviewable outcome.

    The stored ``_plain`` twins are what the editor anchors against — a bold
    span is a mark there, not literal ``**`` — so they must carry the rendered
    text, not the markdown (plan Part 0 C3).
    """
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("I love pizza.")),
    )
    ctx = _suggest_ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[
            EditItem(
                old_text="I love pizza.",
                new_text="I love **pizza**.",
                rationale="leans on the one concrete noun",
            )
        ],
    )

    assert result["status"] == "ok"
    assert len(result["suggestion_ids"]) == 1

    stored = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)
    assert stored.content == _content("I love pizza.")
    (suggestion,) = stored.suggestions
    assert suggestion["id"] == result["suggestion_ids"][0]
    assert suggestion["new_text"] == "I love **pizza**."
    assert suggestion["new_text_plain"] == "I love pizza."
    assert suggestion["old_text_plain"] == "I love pizza."
    assert suggestion["rationale"] == "leans on the one concrete noun"
    assert suggestion["actor"] == "counselle"
    assert suggestion["turn_message_id"] == ctx.turn_message_id
    # Never persisted: a resolved suggestion is removed, so every stored row is
    # pending, and the kind follows from an empty new_text.
    assert "status" not in suggestion
    assert "kind" not in suggestion


async def test_suggest_mode_stores_nothing_when_one_edit_in_the_batch_fails(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("The board hissed.")),
    )
    ctx = _suggest_ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    edit_tool = make_edit_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    result = await edit_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        edits=[
            EditItem(old_text="board", new_text="panel"),
            EditItem(old_text="not in the essay", new_text="x"),
        ],
    )

    assert result["status"] == "error"
    assert result["error"].startswith("edits[1]:")

    stored = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)
    assert stored.suggestions == []
    assert stored.content == _content("The board hissed.")


async def test_write_essay_in_suggest_mode_proposes_a_whole_draft_replacement(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_content("Old draft.")),
    )
    ctx = _suggest_ctx(app_pool, catalog, user_id)
    read_tool = make_read_essay_tool(ctx)
    write_tool = make_write_essay_tool(ctx)

    read_result = await read_tool.function(essay_id=str(essay.id))
    result = await write_tool.function(
        essay_id=str(essay.id),
        expected_version=read_result["version"],
        content_markdown="Brand new full draft.",
    )

    assert result["status"] == "ok"
    stored = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)
    assert stored.content == _content("Old draft.")
    (suggestion,) = stored.suggestions
    assert suggestion["old_text"] == "Old draft."
    assert suggestion["new_text"] == "Brand new full draft."
