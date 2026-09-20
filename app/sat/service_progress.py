"""Stats, `.liprep` export/import and reset (plan.md §4.2, §4.4, §4.6).

Every function takes ``(pool, user_id, ...)``. Import and reset each touch
both ``sat_attempts`` and ``sat_bookmarks`` in one transaction (A13: import
always replaces both, even when the file carries no bookmarks at all).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

import asyncpg

from app.sat.errors import SatValidationError
from app.sat.models import SatImportResult, SatStatsResponse, stats_response_from_domain
from app.sat.taxonomy_loader import load_taxonomy
from config.settings import get_settings
from domain.sat.progress_file import ProgressFileError, decode, encode
from domain.sat.stats import compute_heatmap, compute_user_stats
from domain.sat.types import Attempt, Bookmark

_ATTEMPTS_BY_USER_SQL = """
SELECT id, user_id, client_attempt_id, question_id, module, domain_cd, skill_cd,
       score_band, user_answer, is_correct, time_spent_seconds, solved_at, local_date
FROM counselle.sat_attempts WHERE user_id = $1 ORDER BY solved_at, id
"""

_BOOKMARKS_BY_USER_SQL = """
SELECT user_id, question_id, bookmarked_at
FROM counselle.sat_bookmarks WHERE user_id = $1
"""

_DELETE_ATTEMPTS_SQL = "DELETE FROM counselle.sat_attempts WHERE user_id = $1"
_DELETE_BOOKMARKS_SQL = "DELETE FROM counselle.sat_bookmarks WHERE user_id = $1"

_IMPORT_INSERT_ATTEMPT_SQL = """
INSERT INTO counselle.sat_attempts
  (user_id, client_attempt_id, question_id, module, domain_cd, skill_cd, score_band,
   user_answer, is_correct, time_spent_seconds, solved_at, local_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
"""

_IMPORT_INSERT_BOOKMARK_SQL = """
INSERT INTO counselle.sat_bookmarks (user_id, question_id, bookmarked_at)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, question_id) DO NOTHING
"""

# Bulk variant of `service_questions.resolve_question_id` (alias table then
# lower(raw id), same rule) for the whole import file in one round trip
# rather than one query per row (an import can carry tens of thousands).
_RESOLVE_IDS_SQL = """
SELECT r.raw_id, coalesce(a.question_id, lower(r.raw_id)) AS resolved_id
FROM unnest($1::text[]) AS r(raw_id)
LEFT JOIN counselle.sat_question_aliases a ON a.alias_id = lower(r.raw_id)
"""


async def get_stats(pool: asyncpg.Pool, user_id: UUID, *, today: date) -> SatStatsResponse:
    """``GET /stats``: one indexed scan of the user's attempts (plan §4.4),
    then ``compute_user_stats``/``compute_heatmap`` — pure, clock-free."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_ATTEMPTS_BY_USER_SQL, user_id)
    attempts = [Attempt.model_validate(dict(row)) for row in rows]
    stats = compute_user_stats(attempts, today, load_taxonomy())
    heatmap = compute_heatmap(attempts)
    return stats_response_from_domain(stats, heatmap)


async def export_progress(pool: asyncpg.Pool, user_id: UUID, *, now: datetime) -> str:
    """``GET /progress/export``: the ``.liprep`` v1 JSON payload (A12)."""
    async with pool.acquire() as conn:
        attempt_rows = await conn.fetch(_ATTEMPTS_BY_USER_SQL, user_id)
        bookmark_rows = await conn.fetch(_BOOKMARKS_BY_USER_SQL, user_id)
    attempts = [Attempt.model_validate(dict(row)) for row in attempt_rows]
    bookmarks = [Bookmark.model_validate(dict(row)) for row in bookmark_rows]
    return encode(attempts, bookmarks, now)


async def import_progress(
    pool: asyncpg.Pool,
    user_id: UUID,
    *,
    data: bytes | str,
    today: date,
    now: datetime,
) -> SatImportResult:
    """``PUT /progress``: import = replace (A13), one transaction. Raises
    ``app.sat.errors.SatValidationError`` (422, A13b's own sentence) for a
    file that fails to parse at all; every row-level defect is silently
    dropped/defaulted by ``decode`` (A13a)."""
    settings = get_settings()
    try:
        decoded = decode(
            data, today=today, now=now, max_seconds=settings.sat_attempt_max_seconds
        )
    except ProgressFileError as exc:
        raise SatValidationError(str(exc)) from exc

    raw_ids = sorted(
        {a.question_id for a in decoded.attempts} | {b.question_id for b in decoded.bookmarks}
    )
    async with pool.acquire() as conn, conn.transaction():
        resolved: dict[str, str] = {}
        if raw_ids:
            rows = await conn.fetch(_RESOLVE_IDS_SQL, raw_ids)
            resolved = {row["raw_id"]: row["resolved_id"] for row in rows}

        await conn.execute(_DELETE_ATTEMPTS_SQL, user_id)
        await conn.execute(_DELETE_BOOKMARKS_SQL, user_id)

        if decoded.attempts:
            await conn.executemany(
                _IMPORT_INSERT_ATTEMPT_SQL,
                [
                    (
                        user_id,
                        a.client_attempt_id,
                        resolved[a.question_id],
                        a.module,
                        a.domain_cd,
                        a.skill_cd,
                        a.score_band,
                        a.user_answer,
                        a.is_correct,
                        a.time_spent_seconds,
                        a.solved_at,
                        a.local_date,
                    )
                    for a in decoded.attempts
                ],
            )
        if decoded.bookmarks:
            await conn.executemany(
                _IMPORT_INSERT_BOOKMARK_SQL,
                [
                    (user_id, resolved[b.question_id], b.bookmarked_at)
                    for b in decoded.bookmarks
                ],
            )

    return SatImportResult(
        attempts_imported=len(decoded.attempts),
        bookmarks_imported=len(decoded.bookmarks),
    )


async def reset_progress(pool: asyncpg.Pool, user_id: UUID) -> None:
    """``DELETE /progress``: attempts + bookmarks only (A14) — saved filter
    preferences live in the frontend, not here, and survive untouched."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(_DELETE_ATTEMPTS_SQL, user_id)
        await conn.execute(_DELETE_BOOKMARKS_SQL, user_id)


__all__ = ["export_progress", "get_stats", "import_progress", "reset_progress"]
