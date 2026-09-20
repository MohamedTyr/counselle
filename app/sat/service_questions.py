"""Question bank reads: counts, session lists and one-question loads
(plan.md §4.2, §4.5). Every function takes ``(pool, user_id, ...)`` — even
the reads with no per-user data (``get_question``) keep the same parameter
order for consistency across this package.

The counts/session ``WHERE`` fragment is ONE module constant
(``_LATEST_CTE`` + ``_FILTER_WHERE``, plan §4.5) shared by both queries so
they can never drift out of the same filter semantics (F3-F6, F13, F20).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.sat.errors import SatNotFoundError
from app.sat.models import SatSessionRow
from app.sat.taxonomy_loader import load_taxonomy
from domain.sat.types import AnswerOption, SatQuestion, SolvedStatus

# --- shared filter fragment (plan §4.5) -------------------------------------
#
# $1 = user_id::uuid, $2 = bands::smallint[] (empty = all), $3 = exclude_
# bluebook::boolean, $4 = status::text. Every param is explicitly typed —
# asyncpg cannot infer a bare $n inside CASE/NOT.

_LATEST_CTE = """
WITH latest AS (
  SELECT DISTINCT ON (question_id) question_id, is_correct
  FROM counselle.sat_attempts WHERE user_id = $1::uuid
  ORDER BY question_id, solved_at DESC, id DESC
)
"""

_FILTER_WHERE = """
  q.retired_at IS NULL
  AND (cardinality($2::smallint[]) = 0 OR q.score_band = ANY($2::smallint[]))
  AND (NOT $3::boolean OR NOT q.in_bluebook)
  AND CASE $4::text
        WHEN 'unsolved'   THEN l.question_id IS NULL
        WHEN 'incorrect'  THEN l.is_correct IS FALSE
        WHEN 'bookmarked' THEN b.question_id IS NOT NULL
        ELSE true END
"""

_COUNTS_SQL = f"""
{_LATEST_CTE}
SELECT q.skill_cd, count(*)
FROM counselle.sat_questions q
LEFT JOIN latest l USING (question_id)
LEFT JOIN counselle.sat_bookmarks b
       ON b.user_id = $1::uuid AND b.question_id = q.question_id
WHERE {_FILTER_WHERE}
GROUP BY q.skill_cd
"""  # nosec B608 -- every value binds via $N; no string interpolation of input

_SESSION_SQL = f"""
{_LATEST_CTE}
SELECT q.question_id, q.score_band, q.content_sha256,
       (b.question_id IS NOT NULL) AS bookmarked,
       EXISTS (
         SELECT 1 FROM counselle.sat_attempts a
         WHERE a.user_id = $1::uuid AND a.question_id = q.question_id AND a.is_correct
       ) AS ever_correct,
       EXISTS (
         SELECT 1 FROM counselle.sat_attempts a
         WHERE a.user_id = $1::uuid AND a.question_id = q.question_id AND NOT a.is_correct
       ) AS ever_incorrect
FROM counselle.sat_questions q
LEFT JOIN latest l USING (question_id)
LEFT JOIN counselle.sat_bookmarks b
       ON b.user_id = $1::uuid AND b.question_id = q.question_id
WHERE {_FILTER_WHERE}
  AND (cardinality($5::text[]) = 0 OR q.skill_cd = ANY($5::text[]))
ORDER BY q.question_id
"""  # nosec B608 -- every value binds via $N; no string interpolation of input

# One-id lookup shares the light-row shape above, minus every filter
# (plan §4.2: "an id lookup, not a filtered list") and ignoring retired_at
# (a deep link must keep working after a bank refresh retires a question).
_SESSION_ROW_BY_ID_SQL = """
SELECT q.question_id, q.score_band, q.content_sha256,
       (b.question_id IS NOT NULL) AS bookmarked,
       EXISTS (
         SELECT 1 FROM counselle.sat_attempts a
         WHERE a.user_id = $1::uuid AND a.question_id = q.question_id AND a.is_correct
       ) AS ever_correct,
       EXISTS (
         SELECT 1 FROM counselle.sat_attempts a
         WHERE a.user_id = $1::uuid AND a.question_id = q.question_id AND NOT a.is_correct
       ) AS ever_incorrect
FROM counselle.sat_questions q
LEFT JOIN counselle.sat_bookmarks b
       ON b.user_id = $1::uuid AND b.question_id = q.question_id
WHERE q.question_id = $2
"""

_QUESTION_SQL = """
SELECT q.question_id, q.external_id, q.ibn, q.u_id, q.source, q.module, q.domain_cd,
       q.skill_cd, q.score_band, q.difficulty, q.program, q.item_type, q.in_bluebook,
       q.cb_created_at, q.cb_updated_at, q.content_sha256, q.retired_at,
       c.stimulus, c.stem, c.answer_options, c.correct_answers, c.rationale
FROM counselle.sat_questions q
JOIN counselle.sat_question_content c USING (question_id)
WHERE q.question_id = $1
"""


async def resolve_question_id(conn: asyncpg.Connection, raw_id: str) -> str:
    """Alias table then ``lower($1)`` (plan §4.2, §3.4: every ``question_id``
    is ``COLLATE "C"``, 8 lower-case hex characters). Never raises — callers
    check the resolved id against ``sat_questions``/``sat_attempts``
    themselves, since an unresolvable id still needs to reach a 404 with the
    same shape as any other unknown id. Shared with ``service_attempts.py``
    so alias resolution has exactly one implementation."""
    lowered = raw_id.strip().lower()
    alias_target = await conn.fetchval(
        "SELECT question_id FROM counselle.sat_question_aliases WHERE alias_id = $1",
        lowered,
    )
    return str(alias_target) if alias_target is not None else lowered


def _session_row_from_record(row: asyncpg.Record) -> SatSessionRow:
    return SatSessionRow(
        id=row["question_id"],
        score_band=row["score_band"],
        content_sha=row["content_sha256"],
        bookmarked=row["bookmarked"],
        ever_correct=row["ever_correct"],
        ever_incorrect=row["ever_incorrect"],
    )


async def get_counts(
    pool: asyncpg.Pool,
    user_id: UUID,
    *,
    bands: list[int],
    status: SolvedStatus,
    exclude_bluebook: bool,
) -> dict[str, int]:
    """``{skill_cd: n}`` for all 29 skills, zero-filled (F13) — counts ignore
    the skill selection, as upstream's per-skill counts do (plan §4.5)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_COUNTS_SQL, user_id, bands, exclude_bluebook, status)
    counts = {code: 0 for code in load_taxonomy().skill_codes()}
    for row in rows:
        counts[row["skill_cd"]] = row["count"]
    return counts


async def list_session(
    pool: asyncpg.Pool,
    user_id: UUID,
    *,
    skills: list[str],
    bands: list[int],
    status: SolvedStatus,
    exclude_bluebook: bool,
) -> list[SatSessionRow]:
    """The whole launched session as light rows, ``ORDER BY question_id``
    (plan §4.2, §5.4) — an empty ``skills``/``bands`` means *all* (F20)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _SESSION_SQL, user_id, bands, exclude_bluebook, status, skills
        )
    return [_session_row_from_record(row) for row in rows]


async def get_session_row(
    pool: asyncpg.Pool, user_id: UUID, question_id: str
) -> SatSessionRow:
    """``GET /session?question=<id>`` (plan §4.2, P0.4): the same row shape
    for one question, resolved through the alias table then ``lower(id)``,
    ignoring ``retired_at`` so a deep link never 404s after a bank refresh."""
    async with pool.acquire() as conn:
        resolved_id = await resolve_question_id(conn, question_id)
        row = await conn.fetchrow(_SESSION_ROW_BY_ID_SQL, user_id, resolved_id)
    if row is None:
        raise SatNotFoundError(question_id)
    return _session_row_from_record(row)


async def get_question(pool: asyncpg.Pool, question_id: str) -> SatQuestion:
    """One full question (with ``correct_answers``/``rationale``) — the
    route strips those via ``app.sat.models.question_public_from_domain``
    for ``GET /questions/{id}``; ``service_attempts.submit`` uses this
    unstripped for grading (plan §4.2, §4.3). Resolved through the alias
    table then the primary key, both on ``lower(id)``; not filtered by
    ``retired_at`` (plan §3.4: still served by this endpoint and by
    ``POST …/attempts``, so a deep link keeps working)."""
    async with pool.acquire() as conn:
        resolved_id = await resolve_question_id(conn, question_id)
        row = await conn.fetchrow(_QUESTION_SQL, resolved_id)
    if row is None:
        raise SatNotFoundError(question_id)
    return SatQuestion(
        question_id=row["question_id"],
        external_id=row["external_id"],
        ibn=row["ibn"],
        u_id=row["u_id"],
        source=row["source"],
        module=row["module"],
        domain_cd=row["domain_cd"],
        skill_cd=row["skill_cd"],
        score_band=row["score_band"],
        difficulty=row["difficulty"],
        program=row["program"],
        item_type=row["item_type"],
        in_bluebook=row["in_bluebook"],
        cb_created_at=row["cb_created_at"],
        cb_updated_at=row["cb_updated_at"],
        content_sha256=row["content_sha256"],
        retired_at=row["retired_at"],
        stimulus=row["stimulus"],
        stem=row["stem"],
        answer_options=tuple(AnswerOption.model_validate(o) for o in row["answer_options"]),
        correct_answers=tuple(row["correct_answers"]),
        rationale=row["rationale"],
    )


__all__ = [
    "get_counts",
    "get_question",
    "get_session_row",
    "list_session",
    "resolve_question_id",
]
