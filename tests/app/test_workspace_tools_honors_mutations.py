"""Live DB checks for the honor mutation tool contracts."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, cast
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from pydantic_ai import Tool

from app.workspace.agent_tools_honors_mutations import (
    make_archive_honors_tool,
    make_create_honors_tool,
    make_reorder_honors_tool,
    make_restore_honor_tool,
    make_update_honor_tool,
)
from app.workspace.agent_tools_shared import HonorDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Honor, HonorCreate
from app.workspace.service_activities import archive_honor, create_honor
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
                f"{user_id}@workspace-tools-honors-mut.test",
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


def _ctx(app_pool: asyncpg.Pool, user_id: UUID) -> ToolCtx:
    return ToolCtx(
        app_pool=app_pool,
        catalog=cast(Catalog, None),
        workspace_events=WorkspaceEventBus(),
        user_id=user_id,
        tool_overflow=None,
    )


async def _call_tool(tool: Tool[Any], **kwargs: object) -> dict[str, Any]:
    """Invoke a no-context PydanticAI tool with its concrete test signature."""
    function = cast(Callable[..., Awaitable[dict[str, Any]]], tool.function)
    return await function(**kwargs)


async def _honor(app_pool: asyncpg.Pool, user_id: UUID, title: str) -> Honor:
    return await create_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=HonorCreate(title=title),
    )


async def test_create_and_update_warn_without_blocking_over_limit_title(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    ctx = _ctx(app_pool, user_id)

    created = await _call_tool(
        make_create_honors_tool(ctx),
        honors=[HonorDraft(title="x" * 101)],
    )

    assert created["status"] == "ok"
    assert "title 101/100" in created["warning"]
    honor_id = created["honors"][0]["id"]
    created_mutation = created["public_receipt"]["mutation"]
    assert created_mutation["family"] == "honor"
    assert created_mutation["action"] == "create"

    updated = await _call_tool(make_update_honor_tool(ctx), honor_id=honor_id, title="y" * 101)

    assert updated["status"] == "ok"
    assert "title 101/100" in updated["warning"]
    updated_mutation = updated["public_receipt"]["mutation"]
    title_change = updated_mutation["body"]["changes"][0]
    assert title_change["field_key"] == "title"
    assert title_change["after"]["text"]["text"] == "y" * 101


async def test_create_duplicate_requires_force_and_force_preserves_batch_contract(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await _honor(app_pool, user_id, "National Merit Finalist")
    tool = make_create_honors_tool(_ctx(app_pool, user_id))
    draft = HonorDraft(title="national merit finalist")

    rejected = await _call_tool(tool, honors=[draft])
    forced = await _call_tool(tool, honors=[draft], force=True)

    assert rejected["status"] == "error"
    assert "duplicates active honor id" in rejected["error"]
    assert forced["status"] == "ok"


async def test_create_force_bypasses_active_duplicate_but_never_batch_duplicate(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await _honor(app_pool, user_id, "National Merit Finalist")
    tool = make_create_honors_tool(_ctx(app_pool, user_id))
    draft = HonorDraft(title="national merit finalist")

    forced_against_active = await _call_tool(tool, honors=[draft], force=True)
    assert forced_against_active["status"] == "ok"

    forced_same_batch = await _call_tool(tool, honors=[draft, draft], force=True)
    assert forced_same_batch["status"] == "error"
    assert "earlier in this batch" in forced_same_batch["error"]

    async with app_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM counselle.honors WHERE user_id = $1", user_id
        )
    assert count == 2


async def test_create_batch_duplicate_is_all_or_nothing(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    draft = HonorDraft(title="Eagle Scout")

    result = await _call_tool(
        make_create_honors_tool(_ctx(app_pool, user_id)), honors=[draft, draft]
    )

    assert result["status"] == "error"
    assert "earlier in this batch" in result["error"]
    async with app_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM counselle.honors WHERE user_id = $1", user_id
        )
    assert count == 0


async def test_update_reports_actual_rank_after_reorder(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _honor(app_pool, user_id, "First")
    second = await _honor(app_pool, user_id, "Second")
    third = await _honor(app_pool, user_id, "Third")
    ctx = _ctx(app_pool, user_id)

    await _call_tool(
        make_reorder_honors_tool(ctx),
        ids=[str(third.id), str(first.id), str(second.id)],
    )
    updated = await _call_tool(make_update_honor_tool(ctx), honor_id=str(first.id), title="Updated")

    assert updated["status"] == "ok"
    assert updated["honor"]["rank"] == 2


async def test_create_at_cap_teaches_the_student_how_to_make_room(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    for index in range(5):
        await _honor(app_pool, user_id, f"Honor {index}")

    result = await _call_tool(
        make_create_honors_tool(_ctx(app_pool, user_id)),
        honors=[HonorDraft(title="Overflow")],
    )

    assert result["status"] == "error"
    assert result["error"] == (
        "The Common App allows 5 honors; this student already has 5 active."
    )
    assert result["recovery"] == (
        "Archive another honor first, or fold this into an existing entry."
    )


async def test_create_honors_batch_is_atomic_on_cap_violation(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    """``create_honors_batch`` (agent mutation receipts plan §7.2) is one
    locked transaction — a batch that would exceed the cap rolls back in
    full. This replaces the old per-draft ``create_honor`` loop's accepted
    partial-commit gap: that implementation could leave earlier drafts in a
    batch committed when a later one hit the cap; the new one cannot.
    """
    user_id = await make_user()
    for index in range(3):
        await _honor(app_pool, user_id, f"Existing {index}")

    result = await _call_tool(
        make_create_honors_tool(_ctx(app_pool, user_id)),
        honors=[
            HonorDraft(title="Batch One"),
            HonorDraft(title="Batch Two"),
            HonorDraft(title="Batch Three"),
        ],
    )

    assert result["status"] == "error"
    async with app_pool.acquire() as conn:
        titles = {
            row["title"]
            for row in await conn.fetch(
                "SELECT title FROM counselle.honors WHERE user_id = $1 AND archived_at IS NULL",
                user_id,
            )
        }
    assert titles == {"Existing 0", "Existing 1", "Existing 2"}, (
        "no honor from the rejected batch may be committed"
    )


async def test_restore_keeps_its_original_sort_order_and_cap_error_uses_honors_plural(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    # Unlike activities (Phase 3 hardening appends restores at the end of the
    # active order), honors restore mirrors the original, pre-hardening
    # pattern: it only clears archived_at and keeps the row's prior
    # sort_order, so it can reappear ahead of rows created while it was gone.
    user_id = await make_user()
    first = await _honor(app_pool, user_id, "First")
    second = await _honor(app_pool, user_id, "Second")
    await _call_tool(
        make_reorder_honors_tool(_ctx(app_pool, user_id)), ids=[str(second.id), str(first.id)]
    )
    await archive_honor(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", honor_id=first.id
    )
    await _honor(app_pool, user_id, "Third")
    tool = make_restore_honor_tool(_ctx(app_pool, user_id))

    restored = await _call_tool(tool, honor_id=str(first.id))

    assert restored["status"] == "ok"
    assert restored["honor"]["rank"] == 2
    restored_mutation = restored["public_receipt"]["mutation"]
    assert restored_mutation["action"] == "restore"
    assert restored_mutation["body"]["subjects"][0]["title"]["text"] == "First"

    for index in range(2):
        await _honor(app_pool, user_id, f"Extra {index}")
    await archive_honor(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", honor_id=first.id
    )
    await _honor(app_pool, user_id, "Fifth")

    capped = await _call_tool(tool, honor_id=str(first.id))

    assert capped["status"] == "error"
    assert "5 honors" in capped["error"]


async def test_reorder_returns_ranked_rows_and_rejects_duplicate_ids(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _honor(app_pool, user_id, "First")
    second = await _honor(app_pool, user_id, "Second")
    tool = make_reorder_honors_tool(_ctx(app_pool, user_id))

    reordered = await _call_tool(tool, ids=[str(second.id), str(first.id)])
    rejected = await _call_tool(tool, ids=[str(first.id), str(first.id)])

    assert [row["id"] for row in reordered["honors"]] == [str(second.id), str(first.id)]
    assert [row["rank"] for row in reordered["honors"]] == [1, 2]
    assert rejected["status"] == "error"
    assert "view_activities" in rejected["recovery"]
    reorder_mutation = reordered["public_receipt"]["mutation"]
    assert reorder_mutation["action"] == "reorder"
    assert [s["title"]["text"] for s in reorder_mutation["body"]["new_order"]] == [
        "Second",
        "First",
    ]
    assert reorder_mutation["body"]["old_ranks"] == [2, 1]
    assert reorder_mutation["body"]["moved_index"] == 0
    assert reorder_mutation["body"]["moved_from_rank"] == 2


async def test_reorder_rejects_an_incomplete_active_id_set(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _honor(app_pool, user_id, "First")
    await _honor(app_pool, user_id, "Second")

    result = await _call_tool(
        make_reorder_honors_tool(_ctx(app_pool, user_id)), ids=[str(first.id)]
    )

    assert result["status"] == "error"
    assert result["retryable"] is True
    assert result["recovery"].startswith("ids must be exactly the current active honors")


async def test_archive_mixed_valid_and_stale_ids_reports_both(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    honor = await _honor(app_pool, user_id, "Valid")
    stale_id = str(uuid4())

    result = await _call_tool(
        make_archive_honors_tool(_ctx(app_pool, user_id)),
        honor_ids=[str(honor.id), stale_id],
    )

    assert result["status"] == "warning"
    assert result["archived"] == [str(honor.id)]
    assert result["skipped"] == [{"id": stale_id, "reason": "no active honor with this id"}]
    mutation = result["public_receipt"]["mutation"]
    assert mutation["outcome"] == "partial"
    assert [item["disposition"] for item in mutation["body"]["items"]] == ["changed", "skipped"]


async def test_update_no_fields_is_a_retryable_error(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    honor = await _honor(app_pool, user_id, "Only")

    result = await _call_tool(
        make_update_honor_tool(_ctx(app_pool, user_id)), honor_id=str(honor.id)
    )

    assert result["status"] == "error"
    assert result["retryable"] is True


async def test_update_stale_id_returns_stale_honor_error(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()

    result = await _call_tool(
        make_update_honor_tool(_ctx(app_pool, user_id)), honor_id=str(uuid4()), title="New"
    )

    assert result["status"] == "error"
    assert "No active honor" in result["error"]
