"""Live DB checks for the activity mutation tool contracts."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, cast
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from pydantic_ai import Tool

from app.workspace.agent_tools_activities_mutations import (
    make_archive_activities_tool,
    make_create_activities_tool,
    make_reorder_activities_tool,
    make_restore_activity_tool,
    make_update_activity_tool,
)
from app.workspace.agent_tools_shared import ActivityDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Activity, ActivityCreate
from app.workspace.service_activities import archive_activity, create_activity
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
                f"{user_id}@workspace-tools-activities-mut.test",
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


async def _activity(
    app_pool: asyncpg.Pool, user_id: UUID, position: str, *, organization: str = "Club"
) -> Activity:
    return await create_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ActivityCreate(activity_type="Robotics", position=position, organization=organization),
    )


async def test_create_and_update_warn_without_blocking_over_limit_description(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    ctx = _ctx(app_pool, user_id)

    created = await _call_tool(
        make_create_activities_tool(ctx),
        activities=[ActivityDraft(type="Robotics", position="Captain", description="x" * 151)],
    )

    assert created["status"] == "ok"
    assert "description 151/150" in created["warning"]
    activity_id = created["activities"][0]["id"]
    created_mutation = created["public_receipt"]["mutation"]
    assert created_mutation["family"] == "activity"
    assert created_mutation["action"] == "create"
    assert created_mutation["outcome"] == "success"

    updated = await _call_tool(
        make_update_activity_tool(ctx), activity_id=activity_id, description="y" * 151
    )

    assert updated["status"] == "ok"
    assert "description 151/150" in updated["warning"]
    updated_mutation = updated["public_receipt"]["mutation"]
    assert updated_mutation["action"] == "update"
    # description is changed_only (§8.2) — never the prose content itself.
    change = updated_mutation["body"]["changes"][0]
    assert change["field_key"] == "description"
    assert change["operation"] == "state_only"


async def test_create_duplicate_requires_force_and_force_preserves_batch_contract(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await _activity(app_pool, user_id, "Captain", organization="Robotics Club")
    tool = make_create_activities_tool(_ctx(app_pool, user_id))
    draft = ActivityDraft(type="Robotics", position="captain", organization="robotics club")

    rejected = await _call_tool(tool, activities=[draft])
    forced = await _call_tool(tool, activities=[draft], force=True)

    assert rejected["status"] == "error"
    assert forced["status"] == "ok"


async def test_create_force_bypasses_active_duplicate_but_never_batch_duplicate(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await _activity(app_pool, user_id, "Captain", organization="Robotics Club")
    tool = make_create_activities_tool(_ctx(app_pool, user_id))
    draft = ActivityDraft(type="Robotics", position="captain", organization="robotics club")

    # force=true bypasses the active-row duplicate check (documented behavior).
    forced_against_active = await _call_tool(tool, activities=[draft], force=True)
    assert forced_against_active["status"] == "ok"

    # force=true never lets the same batch create the identical activity twice.
    forced_same_batch = await _call_tool(tool, activities=[draft, draft], force=True)
    assert forced_same_batch["status"] == "error"
    assert "earlier in this batch" in forced_same_batch["error"]


async def test_update_reports_actual_rank_after_reorder(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _activity(app_pool, user_id, "First")
    second = await _activity(app_pool, user_id, "Second")
    third = await _activity(app_pool, user_id, "Third")
    ctx = _ctx(app_pool, user_id)

    await _call_tool(
        make_reorder_activities_tool(ctx),
        ids=[str(third.id), str(first.id), str(second.id)],
    )
    updated = await _call_tool(
        make_update_activity_tool(ctx), activity_id=str(first.id), description="Updated"
    )

    assert updated["status"] == "ok"
    assert updated["activity"]["rank"] == 2


async def test_create_duplicate_batch_is_atomic_and_concurrent_duplicate_is_rejected(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    draft = ActivityDraft(type="Robotics", position="Captain", organization="Robotics Club")

    batch_result = await _call_tool(
        make_create_activities_tool(_ctx(app_pool, user_id)), activities=[draft, draft]
    )
    async with app_pool.acquire() as conn:
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM counselle.activities WHERE user_id = $1", user_id
            )
            == 0
        )
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM counselle.workspace_changes WHERE user_id = $1", user_id
            )
            == 0
        )
    assert batch_result["status"] == "error"
    assert "earlier in this batch" in batch_result["error"]

    concurrent_results = await asyncio.gather(
        _call_tool(make_create_activities_tool(_ctx(app_pool, user_id)), activities=[draft]),
        _call_tool(make_create_activities_tool(_ctx(app_pool, user_id)), activities=[draft]),
    )
    async with app_pool.acquire() as conn:
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM counselle.activities WHERE user_id = $1", user_id
            )
            == 1
        )
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM counselle.workspace_changes WHERE user_id = $1", user_id
            )
            == 1
        )
    assert sorted(result["status"] for result in concurrent_results) == ["error", "ok"]
    rejected = next(result for result in concurrent_results if result["status"] == "error")
    assert "duplicates active activity id" in rejected["error"]


async def test_restore_appends_at_actual_rank_and_cap_error_uses_activities_plural(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _activity(app_pool, user_id, "First")
    second = await _activity(app_pool, user_id, "Second")
    await _call_tool(
        make_reorder_activities_tool(_ctx(app_pool, user_id)), ids=[str(second.id), str(first.id)]
    )
    await archive_activity(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", activity_id=first.id
    )
    await _activity(app_pool, user_id, "Third")
    tool = make_restore_activity_tool(_ctx(app_pool, user_id))

    restored = await _call_tool(tool, activity_id=str(first.id))

    assert restored["status"] == "ok"
    assert restored["activity"]["rank"] == 3
    restored_mutation = restored["public_receipt"]["mutation"]
    assert restored_mutation["action"] == "restore"
    assert restored_mutation["body"]["state"] == "restored"
    assert restored_mutation["body"]["subjects"][0]["title"]["text"] == "First"
    async with app_pool.acquire() as conn:
        sort_orders = await conn.fetch(
            """
            SELECT sort_order
            FROM counselle.activities
            WHERE user_id = $1 AND archived_at IS NULL
            ORDER BY sort_order
            """,
            user_id,
        )
    assert [row["sort_order"] for row in sort_orders] == [0, 2, 3]

    for index in range(7):
        await _activity(app_pool, user_id, f"Extra {index}")
    await archive_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        activity_id=first.id,
    )
    await _activity(app_pool, user_id, "Tenth")

    capped = await _call_tool(tool, activity_id=str(first.id))

    assert capped["status"] == "error"
    assert "10 activities" in capped["error"]


async def test_reorder_returns_ranked_rows_and_rejects_duplicate_ids(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _activity(app_pool, user_id, "First")
    second = await _activity(app_pool, user_id, "Second")
    tool = make_reorder_activities_tool(_ctx(app_pool, user_id))

    reordered = await _call_tool(tool, ids=[str(second.id), str(first.id)])
    rejected = await _call_tool(tool, ids=[str(first.id), str(first.id)])

    assert [row["id"] for row in reordered["activities"]] == [str(second.id), str(first.id)]
    assert [row["rank"] for row in reordered["activities"]] == [1, 2]
    assert rejected["status"] == "error"
    assert "view_activities" in rejected["recovery"]
    reorder_mutation = reordered["public_receipt"]["mutation"]
    assert reorder_mutation["action"] == "reorder"
    assert [s["title"]["text"] for s in reorder_mutation["body"]["new_order"]] == [
        "Second",
        "First",
    ]
    # Authoritative old ranks, captured from the same locked reorder
    # transaction (agent mutation receipts plan §7.3) — "Second" was rank 2
    # before this call and is now rank 1, so it's the reported move.
    assert reorder_mutation["body"]["old_ranks"] == [2, 1]
    assert reorder_mutation["body"]["moved_index"] == 0
    assert reorder_mutation["body"]["moved_from_rank"] == 2


async def test_create_at_cap_teaches_the_student_how_to_make_room(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    for index in range(10):
        await _activity(app_pool, user_id, f"Activity {index}")

    result = await _call_tool(
        make_create_activities_tool(_ctx(app_pool, user_id)),
        activities=[ActivityDraft(type="Robotics", position="Overflow")],
    )

    assert result["status"] == "error"
    assert result["error"] == (
        "The Common App allows 10 activities; this student already has 10 active."
    )
    assert result["recovery"] == (
        "Archive another activity first, or fold this into an existing entry."
    )


async def test_reorder_rejects_an_incomplete_active_id_set(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await _activity(app_pool, user_id, "First")
    await _activity(app_pool, user_id, "Second")

    result = await _call_tool(
        make_reorder_activities_tool(_ctx(app_pool, user_id)), ids=[str(first.id)]
    )

    assert result["status"] == "error"
    assert result["retryable"] is True
    assert result["recovery"].startswith("ids must be exactly the current active activities")


async def test_archive_mixed_valid_and_stale_ids_reports_both(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    activity = await _activity(app_pool, user_id, "Valid")
    stale_id = str(uuid4())

    result = await _call_tool(
        make_archive_activities_tool(_ctx(app_pool, user_id)),
        activity_ids=[str(activity.id), stale_id],
    )

    assert result["status"] == "warning"
    assert result["archived"] == [str(activity.id)]
    assert result["skipped"] == [{"id": stale_id, "reason": "no active activity with this id"}]
    mutation = result["public_receipt"]["mutation"]
    assert mutation["outcome"] == "partial"
    assert [item["disposition"] for item in mutation["body"]["items"]] == ["changed", "skipped"]
