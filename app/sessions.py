"""The thin ``counselle.sessions`` row CRUD (ADR 0019, migration 0001).

A session row fronts the checkpoint data: ``session_id`` is the LangGraph
``thread_id``; ``user_id`` stays NULL until the platform phase. The pool is the
``counselle_app`` role pool (``counselle_db.db.create_pool(dsn=db_app_dsn)`` —
its json codec lets ``source_config`` dicts pass straight to jsonb).
"""

from __future__ import annotations

import base64
import binascii
from datetime import datetime
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
_SET_TITLE_SQL = "UPDATE counselle.sessions SET title = $2 WHERE session_id = $1"
_SET_SOURCE_CONFIG_SQL = (
    "UPDATE counselle.sessions SET source_config = $2 WHERE session_id = $1"
)

#: List-page defaults — small page, hard ceiling (KISS pagination guard).
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 50


def _escape_like(value: str) -> str:
    """Escape ILIKE wildcards so a literal ``%``/``_`` in the query matches itself
    (not everything). Paired with ``ESCAPE '\\'`` on the predicate."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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


async def set_session_title(pool: asyncpg.Pool, session_id: str, title: str) -> None:
    """Set the session title. Does NOT bump ``updated_at`` — a rename isn't activity."""
    async with pool.acquire() as conn:
        await conn.execute(_SET_TITLE_SQL, session_id, title)


async def set_session_source_config(
    pool: asyncpg.Pool, session_id: str, source_config: dict[str, Any]
) -> None:
    """Upsert the per-message source_config onto the session row (PRD story 10).

    A mid-chat toggle is sticky: it survives devices and cleared storage, and
    the session read seeds the dropdown from it.
    """
    async with pool.acquire() as conn:
        await conn.execute(_SET_SOURCE_CONFIG_SQL, session_id, source_config)


def encode_cursor(updated_at: datetime, session_id: str) -> str:
    """Opaque keyset cursor: base64 of ``"<iso_ts>|<session_id>"``."""
    raw = f"{updated_at.isoformat()}|{session_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, str] | None:
    """Decode a keyset cursor → ``(updated_at, session_id)``, or None if garbage.

    A malformed cursor degrades to None (treated as no cursor — first page),
    never a 500.
    """
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        ts_str, sid = raw.split("|", 1)
        return datetime.fromisoformat(ts_str), sid
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None


def decode_cursor_for_test(cursor: str) -> tuple[datetime, str] | None:
    """Public wrapper over :func:`_decode_cursor` for the cursor round-trip test."""
    return _decode_cursor(cursor)


async def list_sessions(
    pool: asyncpg.Pool,
    user_id: str,
    *,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = _DEFAULT_LIST_LIMIT,
) -> list[dict[str, Any]]:
    """User-scoped chat list, keyset-paginated on ``(updated_at DESC, session_id DESC)``.

    ``q`` filters by ``title ILIKE '%q%'`` (NULL titles excluded from search).
    ``cursor`` is an opaque encoding of the last row's ``(updated_at, session_id)``;
    a garbage cursor degrades to the first page. ``limit`` is capped at
    :data:`_MAX_LIST_LIMIT`. Parameterized only.
    """
    capped = max(1, min(limit, _MAX_LIST_LIMIT))
    where = ["user_id = $1"]
    args: list[Any] = [user_id]

    if q:
        args.append(f"%{_escape_like(q)}%")
        where.append(f"title ILIKE ${len(args)} ESCAPE '\\'")

    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            cursor_ts, cursor_sid = decoded
            args.append(cursor_ts)
            ts_pos = len(args)
            args.append(cursor_sid)
            sid_pos = len(args)
            where.append(f"(updated_at, session_id) < (${ts_pos}, ${sid_pos})")

    args.append(capped)
    limit_pos = len(args)
    # WHERE clauses are built from a fixed allowlist of column predicates; every
    # value binds via $N. Safe by construction.
    sql = (
        "SELECT session_id, title, source_config, created_at, updated_at "  # nosec B608
        "FROM counselle.sessions "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY updated_at DESC, session_id DESC "
        f"LIMIT ${limit_pos}"
    )
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    result: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        record["session_id"] = str(record["session_id"])
        result.append(record)
    return result
