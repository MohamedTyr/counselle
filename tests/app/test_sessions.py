"""Live CRUD tests for ``counselle.sessions`` (ADR 0019) — app role pool."""

import asyncio
from collections.abc import AsyncIterator
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.sessions import create_session, get_session, set_session_response_mode, touch_session
from config.settings import get_settings
from counselle_db.db import create_pool
from domain.response_mode import ResponseMode

pytestmark = pytest.mark.live_db

_SOURCE_CONFIG = {"web": True, "reddit": False, "reddit_subreddits": None, "edu": True}


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    """A function-scoped pool on the counselle_app role (writes to counselle.*)."""
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


async def _delete(pool: asyncpg.Pool, session_id: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.sessions WHERE session_id = $1", session_id)


async def test_create_then_get_roundtrip(app_pool: asyncpg.Pool) -> None:
    session_id = await create_session(app_pool, _SOURCE_CONFIG, title="Duke questions")
    try:
        row = await get_session(app_pool, session_id)

        assert row is not None
        assert row["session_id"] == session_id
        assert row["user_id"] is None  # platform phase fills this (ADR 0019)
        assert row["title"] == "Duke questions"
        assert row["source_config"] == _SOURCE_CONFIG
        assert row["created_at"] == row["updated_at"]
        assert row["response_mode"] == "quick"
    finally:
        await _delete(app_pool, session_id)


async def test_get_unknown_session_returns_none(app_pool: asyncpg.Pool) -> None:
    assert await get_session(app_pool, str(uuid4())) is None


async def test_create_session_with_explicit_think_mode(app_pool: asyncpg.Pool) -> None:
    session_id = await create_session(
        app_pool, _SOURCE_CONFIG, response_mode=ResponseMode.THINK
    )
    try:
        row = await get_session(app_pool, session_id)
        assert row is not None
        assert row["response_mode"] == "think"
    finally:
        await _delete(app_pool, session_id)


async def test_set_session_response_mode_updates_row(app_pool: asyncpg.Pool) -> None:
    session_id = await create_session(app_pool, _SOURCE_CONFIG)
    try:
        await set_session_response_mode(app_pool, session_id, ResponseMode.THINK)
        row = await get_session(app_pool, session_id)
        assert row is not None
        assert row["response_mode"] == "think"

        await set_session_response_mode(app_pool, session_id, ResponseMode.QUICK)
        row = await get_session(app_pool, session_id)
        assert row is not None
        assert row["response_mode"] == "quick"
    finally:
        await _delete(app_pool, session_id)


async def test_touch_bumps_updated_at(app_pool: asyncpg.Pool) -> None:
    session_id = await create_session(app_pool, _SOURCE_CONFIG)
    try:
        before = await get_session(app_pool, session_id)
        assert before is not None
        await asyncio.sleep(0.01)  # guarantee a strictly later now()

        await touch_session(app_pool, session_id)

        after = await get_session(app_pool, session_id)
        assert after is not None
        assert after["updated_at"] > before["updated_at"]
        assert after["created_at"] == before["created_at"]
    finally:
        await _delete(app_pool, session_id)
