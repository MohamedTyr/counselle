"""Live DB tests for the Phase 4 profile/document agent tools.

Mirrors the fixture pattern in ``test_workspace_tools_essays.py`` — each live
test module owns its own ``app_pool``/``catalog``/``make_user`` fixtures.
Focused on the genuinely new tool-layer logic (earn-their-place rule,
AGENTS.md): the ``update_profile`` set/merge/clear patch assembly (honesty-
critical — a bug here writes or silently drops a student's own data) and the
``read_document`` unreadable-document teaching error. Batch shapes and
stale-id envelopes are pinned elsewhere by the task/essay tool suites and are
not re-tested here.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from decimal import Decimal
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.agent_tools_profile import (
    make_read_document_tool,
    make_update_profile_tool,
    make_view_documents_tool,
)
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Academics, Basics, DocumentCreate, HighSchool
from app.workspace.service_documents import create_document
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
                f"{user_id}@workspace-tools-profile.test",
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
# update_profile — set/merge/clear semantics
# --------------------------------------------------------------------------


async def test_update_profile_no_section_is_a_retryable_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_update_profile_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function()

    assert result["status"] == "error"
    assert result["retryable"] is True


async def test_update_profile_sets_fields_verbatim_never_rounds_gpa(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_update_profile_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(
        academics=Academics(gpa_unweighted=Decimal("3.87"), gpa_scale=Decimal("4.0"))
    )

    assert result["status"] == "ok"
    assert "3.87" in result["profile"]
    assert "4.0" in result["profile"]
    mutation = result["public_receipt"]["mutation"]
    assert mutation["family"] == "profile"
    assert mutation["action"] == "update"
    section = next(s for s in mutation["body"]["sections"] if s["section_key"] == "academics")
    changed_fields = {c["field_key"] for c in section["changes"]}
    assert "academics.gpa_unweighted" in changed_fields
    gpa_change = next(
        c for c in section["changes"] if c["field_key"] == "academics.gpa_unweighted"
    )
    assert gpa_change["operation"] == "set"


async def test_update_profile_merges_new_fields_without_touching_others(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    ctx = _ctx(app_pool, catalog, await make_user())
    tool = make_update_profile_tool(ctx)

    await tool.function(basics=Basics(preferred_name="Maya", pronouns="she/her"))
    result = await tool.function(basics=Basics(graduation_year=2027))

    assert "Maya" in result["profile"]
    assert "she/her" in result["profile"]
    assert "2027" in result["profile"]


async def test_update_profile_null_clears_one_field_within_a_section(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    ctx = _ctx(app_pool, catalog, await make_user())
    tool = make_update_profile_tool(ctx)

    await tool.function(basics=Basics(preferred_name="Maya", pronouns="she/her"))
    result = await tool.function(basics=Basics(pronouns=None))

    assert "Maya" in result["profile"]
    assert "she/her" not in result["profile"]


async def test_update_profile_clear_sentinel_empties_a_whole_section(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    ctx = _ctx(app_pool, catalog, await make_user())
    tool = make_update_profile_tool(ctx)

    await tool.function(
        basics=Basics(
            preferred_name="Maya",
            high_school=HighSchool(name="Lincoln HS", type="public"),
        )
    )
    result = await tool.function(basics="clear")

    assert "Maya" not in result["profile"]
    assert "Lincoln HS" not in result["profile"]
    mutation = result["public_receipt"]["mutation"]
    section = next(s for s in mutation["body"]["sections"] if s["section_key"] == "basics")
    assert [c["field_key"] for c in section["changes"]] == ["basics"]
    assert section["changes"][0]["operation"] == "clear"


# --------------------------------------------------------------------------
# view_documents / read_document
# --------------------------------------------------------------------------


async def test_view_documents_empty(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_view_documents_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function()

    assert result["status"] == "ok"
    assert result["documents"] == []


async def test_read_document_returns_framed_extracted_text(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    document = await create_document(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=DocumentCreate(
            title="Lincoln HS Transcript",
            doc_type="transcript",
            filename="transcript.pdf",
            mime="application/pdf",
            content=b"%PDF-1.4 fake",
            text_status="extracted",
            extracted_text="Junior year: 3.9 GPA, 6 APs.",
        ),
    )

    ctx = _ctx(app_pool, catalog, user_id)
    view_tool = make_view_documents_tool(ctx)
    view_result = await view_tool.function()
    assert view_result["documents"][0]["id"] == str(document.id)[:8]

    read_tool = make_read_document_tool(ctx)
    read_result = await read_tool.function(document_ref=str(document.id)[:8])

    assert read_result["status"] == "ok"
    assert "Lincoln HS Transcript" in read_result["content"]
    assert "student-provided document" in read_result["content"]
    assert "Junior year: 3.9 GPA, 6 APs." in read_result["content"]


async def test_read_document_unsupported_returns_teaching_error_not_fabricated_text(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    document = await create_document(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=DocumentCreate(
            title="Award photo",
            doc_type="award",
            filename="award.jpg",
            mime="image/jpeg",
            content=b"\xff\xd8\xff",
            text_status="unsupported",
        ),
    )

    tool = make_read_document_tool(_ctx(app_pool, catalog, user_id))
    result = await tool.function(document_ref=str(document.id))

    assert result["status"] == "error"
    assert result["retryable"] is False
    assert "paste" in result["recovery"].lower()


async def test_read_document_stale_ref_points_to_view_documents(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tool = make_read_document_tool(_ctx(app_pool, catalog, user_id))

    result = await tool.function(document_ref="deadbeef")

    assert result["status"] == "error"
    assert "view_documents" in result["recovery"]
