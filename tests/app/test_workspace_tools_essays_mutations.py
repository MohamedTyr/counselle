"""Live DB gate tests for the Phase 3 essay general-mutation agent tools."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.agent_tools_essays_mutations import (
    make_archive_essays_tool,
    make_create_essays_tool,
    make_duplicate_essay_tool,
    make_restore_essay_tool,
    make_update_essay_tool,
)
from app.workspace.agent_tools_shared import EssayDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ApplicationCreate, EssayCreate, WorkspaceNotFoundError
from app.workspace.service_applications import add_application, archive_application
from app.workspace.service_essays import create_essay, create_essays_batch
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
                f"{user_id}@workspace-tools-essays-mut.test",
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


async def test_create_essays_creates_batch_and_derives_word_count(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_create_essays_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(
        essays=[EssayDraft(title="Why us?", content_markdown="Hello world.")]
    )

    assert result["status"] == "ok"
    assert len(result["essays"]) == 1
    row = result["essays"][0]
    assert row["status"] == "Drafting"
    assert row["words"] == "2"
    mutation = result["public_receipt"]["mutation"]
    assert mutation["family"] == "essay"
    assert mutation["action"] == "create"
    assert mutation["outcome"] == "success"
    assert [item["disposition"] for item in mutation["body"]["items"]] == ["changed"]


async def test_create_essays_rejects_batch_on_duplicate_title(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Common App Essay"),
    )
    tool = make_create_essays_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(
        essays=[
            EssayDraft(title="New essay"),
            EssayDraft(title="Common App Essay"),
        ]
    )

    assert result["status"] == "error"
    assert result["retryable"] is False


async def test_create_essays_batch_service_is_atomic_on_mid_batch_failure(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """``create_essays_batch`` (agent mutation receipts plan §7.2) must be
    truly all-or-nothing: a validation failure on the second of two drafts
    (its linked application is archived) must roll back the first draft's
    insert too, unlike the old per-draft-transaction ``create_essay`` loop
    that left earlier creates committed on a later failure. Injected failure
    at item N (the last of two), per the plan's "after item 1 and item N-1"
    coverage requirement.
    """
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    result_b = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 1), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result_b.application.id,
    )

    with pytest.raises(WorkspaceNotFoundError):
        await create_essays_batch(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="counselle",
            drafts=[
                EssayCreate(title="First essay", application_id=result_a.application.id),
                EssayCreate(title="Second essay", application_id=result_b.application.id),
            ],
        )

    async with app_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM counselle.essays WHERE user_id = $1", user_id
        )
    assert count == 0, "first draft's insert must roll back with the batch"


async def test_create_essays_rejects_batch_with_internal_duplicate_titles(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """Two drafts in the same batch with the same title/application must be
    rejected even though neither exists in the DB yet."""
    user_id = await make_user()
    tool = make_create_essays_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(
        essays=[
            EssayDraft(title="Why us?"),
            EssayDraft(title="why us?"),
        ]
    )

    assert result["status"] == "error"
    assert result["retryable"] is True


async def test_create_essays_batch_size_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_create_essays_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essays=[])

    assert result["status"] == "error"
    assert result["retryable"] is True


async def test_update_essay_changes_fields_and_clears_word_limit(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", word_limit=650),
    )
    tool = make_update_essay_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essay_id=str(essay.id), status="Drafting", word_limit="clear")

    assert result["status"] == "ok"
    assert result["essay"]["status"] == "Drafting"
    assert result["essay"]["words"] == "0"
    mutation = result["public_receipt"]["mutation"]
    assert mutation["family"] == "essay"
    assert mutation["action"] == "update"
    changes_by_field = {c["field_key"]: c for c in mutation["body"]["changes"]}
    assert set(changes_by_field) == {"status", "word_limit"}
    status_change = changes_by_field["status"]
    assert status_change["operation"] == "replace"
    assert status_change["before"]["enum"] == "Not started"
    assert status_change["after"]["enum"] == "Drafting"
    word_limit_change = changes_by_field["word_limit"]
    assert word_limit_change["operation"] == "clear"


async def test_update_essay_no_fields_is_retryable_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft"),
    )
    tool = make_update_essay_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essay_id=str(essay.id))

    assert result["status"] == "error"
    assert result["retryable"] is True


async def test_duplicate_essay_copies_essay(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Original"),
    )
    tool = make_duplicate_essay_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(essay_id=str(essay.id))

    assert result["status"] == "ok"
    assert result["essay"]["title"] == "Copy of Original"
    mutation = result["public_receipt"]["mutation"]
    assert mutation["family"] == "essay"
    assert mutation["action"] == "duplicate"
    assert mutation["body"]["source"]["title"]["text"] == "Original"
    assert mutation["body"]["copy"]["title"]["text"] == "Copy of Original"


async def test_archive_then_restore_essay_round_trips(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Toggle me"),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    archive_tool = make_archive_essays_tool(ctx)
    restore_tool = make_restore_essay_tool(ctx)

    archive_result = await archive_tool.function(essay_ids=[str(essay.id)])
    assert archive_result["status"] == "ok"
    assert str(essay.id) in archive_result["archived"]
    archive_mutation = archive_result["public_receipt"]["mutation"]
    assert archive_mutation["action"] == "archive"
    assert [item["disposition"] for item in archive_mutation["body"]["items"]] == ["changed"]

    restore_result = await restore_tool.function(essay_id=str(essay.id))
    assert restore_result["status"] == "ok"
    assert restore_result["essay"]["title"] == "Toggle me"
    restore_mutation = restore_result["public_receipt"]["mutation"]
    assert restore_mutation["action"] == "restore"
    assert restore_mutation["body"]["state"] == "restored"
    assert restore_mutation["body"]["subjects"][0]["title"]["text"] == "Toggle me"


async def test_restore_essay_blocked_by_archived_school(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    app = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Linked essay", application_id=app.application.id),
    )
    ctx = _ctx(app_pool, catalog, user_id)
    await make_archive_essays_tool(ctx).function(essay_ids=[str(essay.id)])
    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=app.application.id,
    )

    result = await make_restore_essay_tool(ctx).function(essay_id=str(essay.id))

    assert result["status"] == "error"
    assert "restore_school" in result["recovery"]
