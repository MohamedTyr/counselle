"""Per-message feedback (B4, §29): the caller's thumbs on an assistant message.

A row keys on ``(user_id, message_id)`` — the assistant message_id (G1). The
transcript read joins :func:`feedback_for_session` so a thumbs-up survives reload
(the honesty piece: without the read path a re-tap toggle is a lie after F5).
"""

from __future__ import annotations

from uuid import uuid4

import asyncpg

_UPSERT_SQL = """
INSERT INTO counselle.feedback (id, user_id, session_id, message_id, rating)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, message_id)
DO UPDATE SET rating = EXCLUDED.rating, session_id = EXCLUDED.session_id
"""
_DELETE_SQL = "DELETE FROM counselle.feedback WHERE user_id = $1 AND message_id = $2"
_SELECT_SQL = """
SELECT message_id, rating
FROM counselle.feedback
WHERE user_id = $1 AND session_id = $2
"""


async def set_feedback(
    pool: asyncpg.Pool,
    *,
    user_id: str,
    session_id: str,
    message_id: str,
    rating: str,
) -> None:
    """Upsert the caller's rating on an assistant message (``up`` toggles to ``down``)."""
    async with pool.acquire() as conn:
        await conn.execute(_UPSERT_SQL, uuid4(), user_id, session_id, message_id, rating)


async def clear_feedback(pool: asyncpg.Pool, *, user_id: str, message_id: str) -> None:
    """Remove the caller's rating on a message (the ``rating: null`` clear path)."""
    async with pool.acquire() as conn:
        await conn.execute(_DELETE_SQL, user_id, message_id)


async def feedback_for_session(
    pool: asyncpg.Pool, *, user_id: str, session_id: str
) -> dict[str, str]:
    """``{message_id: rating}`` for the caller in this session (the read-path join)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_SELECT_SQL, user_id, session_id)
    return {str(row["message_id"]): str(row["rating"]) for row in rows}
