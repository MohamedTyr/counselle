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
from uuid import UUID, uuid4

import asyncpg

from app.workspace.models import WorkspaceNotFoundError
from domain.response_mode import ResponseMode

_INSERT_SQL = """
INSERT INTO counselle.sessions (session_id, source_config, title, user_id, response_mode)
VALUES ($1, $2, $3, $4, $5)
"""
_INSERT_ESSAY_SESSION_SQL = """
INSERT INTO counselle.sessions (session_id, source_config, user_id, essay_id, response_mode)
SELECT $1, $2, $3, e.id, $5
FROM counselle.essays e
WHERE e.id = $4 AND e.user_id = $3 AND e.archived_at IS NULL
ON CONFLICT (essay_id) WHERE essay_id IS NOT NULL DO NOTHING
RETURNING session_id
"""
_SELECT_ESSAY_SESSION_SQL = """
SELECT session_id FROM counselle.sessions WHERE essay_id = $1 AND user_id = $2
"""
_SELECT_SQL = """
SELECT session_id, user_id, title, source_config, created_at, updated_at, response_mode,
       essay_id
FROM counselle.sessions
WHERE session_id = $1
"""
_TOUCH_SQL = "UPDATE counselle.sessions SET updated_at = now() WHERE session_id = $1"
_SET_TITLE_SQL = "UPDATE counselle.sessions SET title = $2 WHERE session_id = $1"
_SET_SOURCE_CONFIG_SQL = (
    "UPDATE counselle.sessions SET source_config = $2 WHERE session_id = $1"
)
_SET_RESPONSE_MODE_SQL = (
    "UPDATE counselle.sessions SET response_mode = $2 WHERE session_id = $1"
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
    response_mode: ResponseMode = ResponseMode.QUICK,
) -> str:
    """Insert a new session row; returns the new ``session_id`` (uuid4 string).

    ``user_id`` is optional (the eval runner still calls without it — those rows
    are dev-only and re-runnable; B3's FK purge sweeps any NULL-user rows once).

    ``response_mode`` seeds the sticky next-turn preference (plan §4.2); the DB
    column default (``'quick'``) is the final compatibility backstop for call
    sites that predate this parameter.
    """
    session_id = str(uuid4())
    async with pool.acquire() as conn:
        await conn.execute(
            _INSERT_SQL, session_id, source_config, title, user_id, response_mode.value
        )
    return session_id


async def get_or_create_essay_session(
    pool: asyncpg.Pool,
    *,
    user_id: str,
    essay_id: UUID,
    source_config: dict[str, Any],
    response_mode: ResponseMode = ResponseMode.QUICK,
) -> str:
    """The one durable chat session for this essay, creating it if absent.

    ``sessions_essay_id_idx`` (migration 0020) is a partial UNIQUE index, so
    the insert is the concurrency guard: two first-opens of the same essay
    race into ON CONFLICT, and the loser reads the winner's row instead of
    creating a second thread.

    Ownership is enforced here rather than assumed: the insert selects the
    essay row under ``user_id``, so an essay that is not this student's (or is
    archived, or gone) inserts nothing and matches nothing, and the caller
    gets :class:`WorkspaceNotFoundError` — never a thread attached to someone
    else's essay.
    """
    async with pool.acquire() as conn:
        session_id = await conn.fetchval(
            _INSERT_ESSAY_SESSION_SQL,
            str(uuid4()),
            source_config,
            user_id,
            essay_id,
            response_mode.value,
        )
        if session_id is None:
            session_id = await conn.fetchval(_SELECT_ESSAY_SESSION_SQL, essay_id, user_id)
    if session_id is None:
        raise WorkspaceNotFoundError()
    return str(session_id)


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


async def set_session_response_mode(
    pool: asyncpg.Pool, session_id: str, response_mode: ResponseMode
) -> None:
    """Persist the chat's sticky next-turn response mode (plan §4.2/§4.3).

    Callers are responsible for only invoking this for an explicitly selected
    normal new turn — clarification, steering, and regenerate must never call
    this (plan §4.3 step 5).
    """
    async with pool.acquire() as conn:
        await conn.execute(_SET_RESPONSE_MODE_SQL, session_id, response_mode.value)


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
        parsed_ts = datetime.fromisoformat(ts_str)
        UUID(sid)  # validate before the uuid-typed column; keep sid as str, not the UUID object
        return parsed_ts, sid
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

    An essay's own panel thread (``essay_id IS NOT NULL``, plan Part 0 C6) is
    excluded: it belongs to the essay, is reached from the editor, and would
    otherwise clutter the chat list with one untitled row per essay.

    ``q`` filters by ``title ILIKE '%q%'`` (NULL titles excluded from search).
    ``cursor`` is an opaque encoding of the last row's ``(updated_at, session_id)``;
    a garbage cursor degrades to the first page. ``limit`` is capped at
    :data:`_MAX_LIST_LIMIT`. Parameterized only.
    """
    capped = max(1, min(limit, _MAX_LIST_LIMIT))
    where = ["user_id = $1", "essay_id IS NULL"]
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
