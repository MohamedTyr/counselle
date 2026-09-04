"""Live DB gate for the suggestion queue and per-essay chat threads.

Covers the two things that cannot be proven without Postgres: the row-lock
behavior that makes accept/reject race-safe, and the partial UNIQUE index that
makes "one durable thread per essay" true under concurrency. Scoped to the
honesty carve-out — a silently-wrong accept corrupts a student's essay.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.sessions import get_or_create_essay_session, list_sessions
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    EssayCreate,
    EssayPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_essays import (
    STALE_SUGGESTION_MESSAGE,
    append_suggestions,
    create_essay,
    get_essay,
    resolve_all_suggestions,
    resolve_suggestion,
    update_essay,
)
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

pytestmark = pytest.mark.live_db

_SOURCE_CONFIG = {"web": True, "reddit": False, "reddit_subreddits": None, "edu": True}


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
async def make_user(app_pool: asyncpg.Pool) -> AsyncIterator[Callable[[], Awaitable[UUID]]]:
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
                f"{user_id}@essay-suggestions.test",
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


def _doc(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def _suggestion(old_text: str, new_text: str) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "old_text": old_text,
        "new_text": new_text,
        "old_text_plain": old_text,
        "new_text_plain": new_text,
        "rationale": "tightens the line",
        "actor": "counselle",
        "created_at": "2026-09-04T12:00:00+00:00",
        "essay_version_at_creation": "2026-09-04T12:00:00+00:00",
        "turn_message_id": str(uuid4()),
    }


async def _essay_with_suggestions(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    user_id: UUID,
    text: str,
    suggestions: list[dict[str, Any]],
) -> UUID:
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Draft", content=_doc(text)),
    )
    if suggestions:
        await append_suggestions(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="counselle",
            essay_id=essay.id,
            suggestions=suggestions,
        )
    return essay.id


# --------------------------------------------------------------------------
# Accept / reject
# --------------------------------------------------------------------------


async def test_append_suggestions_leaves_content_alone(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [_suggestion("hissed", "hissed back")]
    )

    essay = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay_id)
    assert len(essay.suggestions) == 1
    assert essay.content == _doc("The board hissed.")
    assert essay.word_count == 3


async def test_accept_applies_only_that_suggestion_and_drops_only_it(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = _suggestion("board", "old board")
    second = _suggestion("hissed", "hissed back")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [first, second]
    )

    after = await resolve_suggestion(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay_id,
        suggestion_id=UUID(second["id"]),
        accept=True,
    )

    assert [s["id"] for s in after.suggestions] == [first["id"]]
    assert after.content == _doc("The board hissed back.")
    assert after.word_count == 4


async def test_reject_drops_the_suggestion_without_touching_content(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    suggestion = _suggestion("hissed", "hissed back")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [suggestion]
    )

    after = await resolve_suggestion(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay_id,
        suggestion_id=UUID(suggestion["id"]),
        accept=False,
    )

    assert after.suggestions == []
    assert after.content == _doc("The board hissed.")


@pytest.mark.parametrize(
    ("rewritten", "old_text"),
    [
        # not_found: the student edited the very text the suggestion targets.
        ("The panel murmured.", "hissed"),
        # ambiguous: the student duplicated it, so there is no single anchor.
        ("The board hissed and hissed.", "hissed"),
    ],
)
async def test_accepting_a_stale_suggestion_leaves_the_essay_untouched(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
    rewritten: str,
    old_text: str,
) -> None:
    """The honest outcome for a suggestion that no longer applies.

    Surfaces as a validation error (422, never 409 — the message deliberately
    omits "already active"), the suggestion stays pending so the student can
    reject it, and the content is exactly what they typed.
    """
    user_id = await make_user()
    suggestion = _suggestion(old_text, "hissed back")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [suggestion]
    )
    await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay_id,
        data=EssayPatch(content=_doc(rewritten)),
    )

    with pytest.raises(WorkspaceValidationError) as excinfo:
        await resolve_suggestion(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay_id,
            suggestion_id=UUID(suggestion["id"]),
            accept=True,
        )
    assert str(excinfo.value) == STALE_SUGGESTION_MESSAGE

    essay = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay_id)
    assert essay.content == _doc(rewritten)
    assert [s["id"] for s in essay.suggestions] == [suggestion["id"]]


async def test_two_simultaneous_accepts_apply_the_edit_exactly_once(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """The row lock is what makes a double-accept safe, not luck.

    Both calls read-then-write inside one transaction holding the essay's
    ``FOR UPDATE`` lock, so the loser sees the winner's result: the suggestion
    is gone, and it gets a 404 instead of applying the same edit twice.
    """
    user_id = await make_user()
    suggestion = _suggestion("hissed", "hissed back")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [suggestion]
    )

    async def _accept() -> Any:
        return await resolve_suggestion(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay_id,
            suggestion_id=UUID(suggestion["id"]),
            accept=True,
        )

    results = await asyncio.gather(_accept(), _accept(), return_exceptions=True)

    failures = [r for r in results if isinstance(r, BaseException)]
    assert len(failures) == 1
    assert isinstance(failures[0], WorkspaceNotFoundError)

    essay = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay_id)
    assert essay.content == _doc("The board hissed back.")
    assert essay.suggestions == []


async def test_accept_all_applies_what_it_can_and_reports_what_it_skipped(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """One stale item must not sink independently authored siblings."""
    user_id = await make_user()
    good = _suggestion("hissed", "hissed back")
    stale = _suggestion("nowhere in the essay", "x")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, user_id, "The board hissed.", [good, stale]
    )

    result = await resolve_all_suggestions(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay_id,
        accept=True,
    )

    assert result["applied"] == 1
    assert result["skipped"] == [{"id": stale["id"], "reason": "not_found"}]
    essay = result["essay"]
    assert essay.content == _doc("The board hissed back.")
    assert [s["id"] for s in essay.suggestions] == [stale["id"]]


async def test_reject_all_clears_the_queue_and_never_skips(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(
        app_pool,
        catalog,
        user_id,
        "The board hissed.",
        [_suggestion("hissed", "hissed back"), _suggestion("nowhere", "x")],
    )

    result = await resolve_all_suggestions(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay_id,
        accept=False,
    )

    assert result["applied"] == 2
    assert result["skipped"] == []
    assert result["essay"].suggestions == []
    assert result["essay"].content == _doc("The board hissed.")


async def test_resolving_an_unknown_suggestion_is_a_404(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(app_pool, catalog, user_id, "Text.", [])

    with pytest.raises(WorkspaceNotFoundError):
        await resolve_suggestion(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay_id,
            suggestion_id=uuid4(),
            accept=True,
        )


# --------------------------------------------------------------------------
# Ownership — every mutating entry point (§10.3)
# --------------------------------------------------------------------------


async def test_another_users_essay_id_never_resolves(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    owner = await make_user()
    intruder = await make_user()
    suggestion = _suggestion("hissed", "hissed back")
    essay_id = await _essay_with_suggestions(
        app_pool, catalog, owner, "The board hissed.", [suggestion]
    )

    with pytest.raises(WorkspaceNotFoundError):
        await append_suggestions(
            app_pool,
            WorkspaceEventBus(),
            user_id=intruder,
            actor="counselle",
            essay_id=essay_id,
            suggestions=[_suggestion("board", "panel")],
        )
    with pytest.raises(WorkspaceNotFoundError):
        await resolve_suggestion(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=intruder,
            actor="student",
            essay_id=essay_id,
            suggestion_id=UUID(suggestion["id"]),
            accept=True,
        )
    with pytest.raises(WorkspaceNotFoundError):
        await resolve_all_suggestions(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=intruder,
            actor="student",
            essay_id=essay_id,
            accept=True,
        )
    with pytest.raises(WorkspaceNotFoundError):
        await get_or_create_essay_session(
            app_pool,
            user_id=str(intruder),
            essay_id=essay_id,
            source_config=_SOURCE_CONFIG,
        )

    essay = await get_essay(app_pool, catalog, user_id=owner, essay_id=essay_id)
    assert [s["id"] for s in essay.suggestions] == [suggestion["id"]]
    assert essay.content == _doc("The board hissed.")


# --------------------------------------------------------------------------
# Per-essay chat threads (Part 0 C6)
# --------------------------------------------------------------------------


async def test_one_durable_session_per_essay_even_under_a_race(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """The partial UNIQUE index, not the application, is the guarantee.

    Two simultaneous first-opens of the same essay race into ON CONFLICT; the
    loser must read the winner's thread rather than create a second one the
    student would silently lose half their conversation in.
    """
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(app_pool, catalog, user_id, "Text.", [])

    async def _open() -> str:
        return await get_or_create_essay_session(
            app_pool, user_id=str(user_id), essay_id=essay_id, source_config=_SOURCE_CONFIG
        )

    raced = await asyncio.gather(_open(), _open(), _open())
    assert len(set(raced)) == 1
    assert await _open() == raced[0]

    async with app_pool.acquire() as conn:
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM counselle.sessions WHERE essay_id = $1", essay_id
            )
            == 1
        )


async def test_the_index_rejects_a_second_thread_for_one_essay(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    """A direct insert bypassing the service still cannot create a second."""
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(app_pool, catalog, user_id, "Text.", [])
    await get_or_create_essay_session(
        app_pool, user_id=str(user_id), essay_id=essay_id, source_config=_SOURCE_CONFIG
    )

    async with app_pool.acquire() as conn:
        with pytest.raises(asyncpg.UniqueViolationError):
            await conn.execute(
                """
                INSERT INTO counselle.sessions
                  (session_id, source_config, user_id, essay_id, response_mode)
                VALUES ($1, $2, $3, $4, 'quick')
                """,
                str(uuid4()),
                _SOURCE_CONFIG,
                user_id,
                essay_id,
            )


async def test_essay_threads_stay_out_of_the_main_chat_list(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    essay_id = await _essay_with_suggestions(app_pool, catalog, user_id, "Text.", [])
    essay_session = await get_or_create_essay_session(
        app_pool, user_id=str(user_id), essay_id=essay_id, source_config=_SOURCE_CONFIG
    )

    listed = await list_sessions(app_pool, str(user_id))
    assert essay_session not in {row["session_id"] for row in listed}
