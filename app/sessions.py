"""The thin ``counselle.sessions`` row CRUD (ADR 0019, migration 0001).

A session row fronts the checkpoint data: ``session_id`` is the LangGraph
``thread_id``; ``user_id`` stays NULL until the platform phase. The pool is the
``counselle_app`` role pool (``counselle_db.db.create_pool(dsn=db_app_dsn)`` —
its json codec lets ``source_config`` dicts pass straight to jsonb).
"""

from typing import Any
from uuid import uuid4

import asyncpg

_INSERT_SQL = """
INSERT INTO counselle.sessions (session_id, source_config, title, user_id)
VALUES ($1, $2, $3, $4)
"""
_SELECT_SQL = """
SELECT session_id, user_id, title, source_config, created_at, updated_at
FROM counselle.sessions
WHERE session_id = $1
"""
_TOUCH_SQL = "UPDATE counselle.sessions SET updated_at = now() WHERE session_id = $1"


async def create_session(
    pool: asyncpg.Pool,
    source_config: dict[str, Any],
    title: str | None = None,
    *,
    user_id: str | None = None,
) -> str:
    """Insert a new session row; returns the new ``session_id`` (uuid4 string).

    ``user_id`` is optional (the eval runner still calls without it — those rows
    are dev-only and re-runnable; B3's FK purge sweeps any NULL-user rows once).
    """
    session_id = str(uuid4())
    async with pool.acquire() as conn:
        await conn.execute(_INSERT_SQL, session_id, source_config, title, user_id)
    return session_id


async def get_session(pool: asyncpg.Pool, session_id: str) -> dict[str, Any] | None:
    """Fetch one session row as a dict (uuids as strings), or None if absent."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_SELECT_SQL, session_id)
    if row is None:
        return None
    record = dict(row)
    record["session_id"] = str(record["session_id"])
    if record["user_id"] is not None:
        record["user_id"] = str(record["user_id"])
    return record


async def touch_session(pool: asyncpg.Pool, session_id: str) -> None:
    """Bump ``updated_at`` to now (call once per turn)."""
    async with pool.acquire() as conn:
        await conn.execute(_TOUCH_SQL, session_id)
