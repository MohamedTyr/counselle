"""A student's saved scholarships (plan §5, D1).

A save of a record later unpublished or archived is kept but not returned,
so it comes back if the record is republished. Every function scopes to the
authenticated `user_id`.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.scholarships.errors import ScholarshipNotFoundError
from app.scholarships.service import NOT_FOUND_MESSAGE

_SAVED_IDS_SQL = """
SELECT sv.scholarship_id
FROM counselle.scholarship_saves sv
JOIN counselle.scholarships s ON s.id = sv.scholarship_id
WHERE sv.user_id = $1 AND s.status = 'published'
ORDER BY sv.created_at, sv.scholarship_id
"""

_IS_PUBLISHED_SQL = "SELECT 1 FROM counselle.scholarships WHERE id = $1 AND status = 'published'"

_SAVE_SQL = """
INSERT INTO counselle.scholarship_saves (user_id, scholarship_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING
"""

_UNSAVE_SQL = "DELETE FROM counselle.scholarship_saves WHERE user_id = $1 AND scholarship_id = $2"


async def saved_ids(pool: asyncpg.Pool, user_id: UUID) -> list[UUID]:
    return [row["scholarship_id"] for row in await pool.fetch(_SAVED_IDS_SQL, user_id)]


async def save(pool: asyncpg.Pool, user_id: UUID, scholarship_id: UUID) -> None:
    """Idempotent; a record that isn't published is a 404."""
    async with pool.acquire() as conn, conn.transaction():
        if await conn.fetchval(_IS_PUBLISHED_SQL, scholarship_id) is None:
            raise ScholarshipNotFoundError(NOT_FOUND_MESSAGE)
        await conn.execute(_SAVE_SQL, user_id, scholarship_id)


async def unsave(pool: asyncpg.Pool, user_id: UUID, scholarship_id: UUID) -> None:
    """Idempotent."""
    await pool.execute(_UNSAVE_SQL, user_id, scholarship_id)


__all__ = ["save", "saved_ids", "unsave"]
