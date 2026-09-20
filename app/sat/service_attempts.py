"""Submit/grade, attempt history and bookmarks (plan.md §4.2, §4.3).

``submit`` is retry-safe, not idempotent-by-question (Q26): a second press
of a fresh answer is a real second attempt; only a *retry of the same
press* (same ``client_attempt_id``) must never create a second row.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from uuid import UUID

import asyncpg
import structlog

from app.sat.errors import SatValidationError
from app.sat.models import SatAttemptOut, SatSubmitResult
from app.sat.service_questions import get_question, resolve_question_id
from config.settings import get_settings
from domain.sat._rounding import js_round
from domain.sat.grading import is_correct as grade_is_correct

logger = structlog.get_logger(__name__)

# Q21: liprep's SPR input mask.
_SPR_ANSWER_RE = re.compile(r"^[0-9./-]{1,7}$")

_MIN_SECONDS = 1

_SUBMIT_INSERT_SQL = """
INSERT INTO counselle.sat_attempts
  (user_id, client_attempt_id, question_id, module, domain_cd, skill_cd, score_band,
   user_answer, is_correct, time_spent_seconds, local_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (user_id, client_attempt_id) DO NOTHING
RETURNING id, question_id, module, domain_cd, skill_cd, score_band, user_answer,
          is_correct, time_spent_seconds, solved_at, local_date
"""

_SUBMIT_EXISTING_SQL = """
SELECT id, question_id, module, domain_cd, skill_cd, score_band, user_answer,
       is_correct, time_spent_seconds, solved_at, local_date
FROM counselle.sat_attempts
WHERE user_id = $1 AND client_attempt_id = $2
"""

_HISTORY_SQL = """
SELECT id, question_id, module, domain_cd, skill_cd, score_band, user_answer,
       is_correct, time_spent_seconds, solved_at, local_date
FROM counselle.sat_attempts
WHERE user_id = $1 AND question_id = $2
ORDER BY solved_at, id
"""

_BOOKMARK_SET_SQL = """
INSERT INTO counselle.sat_bookmarks (user_id, question_id)
VALUES ($1, $2)
ON CONFLICT (user_id, question_id) DO NOTHING
"""

_BOOKMARK_CLEAR_SQL = """
DELETE FROM counselle.sat_bookmarks WHERE user_id = $1 AND question_id = $2
"""


def _attempt_out_from_row(row: asyncpg.Record) -> SatAttemptOut:
    return SatAttemptOut(
        id=row["id"],
        question_id=row["question_id"],
        module=row["module"],
        domain_cd=row["domain_cd"],
        skill_cd=row["skill_cd"],
        score_band=row["score_band"],
        user_answer=row["user_answer"],
        is_correct=row["is_correct"],
        time_spent_seconds=row["time_spent_seconds"],
        solved_at=row["solved_at"],
        local_date=row["local_date"],
    )


def _validate_answer(item_type: str, labels: tuple[str, ...], answer: str) -> None:
    """Q21: mcq must be one of the question's option labels; spr must match
    liprep's input mask. Anything else is a 422."""
    if item_type == "mcq":
        if answer not in labels:
            raise SatValidationError(f"{answer!r} is not one of this question's options")
        return
    if not _SPR_ANSWER_RE.match(answer):
        raise SatValidationError(
            "answer must be 1-7 characters from the set [0-9./-]"
        )


def _clamp_seconds(raw: int, max_seconds: int) -> int:
    """Q25: ``max(1, round(x))``, then the ``sat_attempt_max_seconds``
    ceiling (upstream applies neither the floor nor a ceiling on import;
    ``domain.sat.progress_file`` applies the same clamp there)."""
    return min(max_seconds, max(_MIN_SECONDS, js_round(raw)))


def _validate_local_date(local_date: date, now: datetime) -> None:
    """Accepted iff it is a date that exists somewhere on Earth at this
    instant: ``utc_date - 1 <= local_date <= utc_date + 1`` (UTC-12 ..
    UTC+14, plan §4.3)."""
    utc_date = now.astimezone(UTC).date()
    low = utc_date.toordinal() - 1
    high = utc_date.toordinal() + 1
    if not (low <= local_date.toordinal() <= high):
        raise SatValidationError("local_date is not a valid date for this instant")


async def submit(
    pool: asyncpg.Pool,
    user_id: UUID,
    question_id: str,
    *,
    client_attempt_id: UUID,
    answer: str,
    time_spent_seconds: int,
    local_date: date,
) -> SatSubmitResult:
    """Load (alias-resolved; 404 if unknown), validate, grade, insert
    retry-safe, and return the verdict + key + rationale + the question's
    full attempt history, oldest first, the new attempt last (Q20, Q23,
    Q27, Q28 — plan §4.3)."""
    settings = get_settings()
    question = await get_question(pool, question_id)
    labels = tuple(opt.label for opt in question.answer_options)
    _validate_answer(question.item_type, labels, answer)
    _validate_local_date(local_date, datetime.now(UTC))
    seconds = _clamp_seconds(time_spent_seconds, settings.sat_attempt_max_seconds)
    verdict = grade_is_correct(question.item_type, question.correct_answers, answer)

    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            _SUBMIT_INSERT_SQL,
            user_id,
            client_attempt_id,
            question.question_id,
            question.module,
            question.domain_cd,
            question.skill_cd,
            question.score_band,
            answer,
            verdict,
            seconds,
            local_date,
        )
        if row is None:
            stored = await conn.fetchrow(_SUBMIT_EXISTING_SQL, user_id, client_attempt_id)
            if stored is None:  # pragma: no cover - UNIQUE guarantees a row on conflict
                raise RuntimeError("sat_attempts conflict with no stored row")
            if stored["question_id"] != question.question_id or stored["user_answer"] != answer:
                logger.warning(
                    "sat_submit_retry_payload_mismatch",
                    user_id=str(user_id),
                    client_attempt_id=str(client_attempt_id),
                    stored_question_id=stored["question_id"],
                    submitted_question_id=question.question_id,
                )
            row = stored
        history_rows = await conn.fetch(_HISTORY_SQL, user_id, question.question_id)

    return SatSubmitResult(
        is_correct=row["is_correct"],
        correct_answers=question.correct_answers,
        rationale=question.rationale,
        attempts=tuple(_attempt_out_from_row(r) for r in history_rows),
    )


async def get_attempt_history(
    pool: asyncpg.Pool, user_id: UUID, question_id: str
) -> list[SatAttemptOut]:
    """``GET /questions/{id}/attempts``: the student's history for one
    question, oldest first (S12). Resolved through the alias table the same
    way ``/questions/{id}`` is."""
    async with pool.acquire() as conn:
        resolved_id = await resolve_question_id(conn, question_id)
        rows = await conn.fetch(_HISTORY_SQL, user_id, resolved_id)
    return [_attempt_out_from_row(r) for r in rows]


async def set_bookmark(pool: asyncpg.Pool, user_id: UUID, question_id: str) -> None:
    """``PUT /bookmarks/{id}``: idempotent set, not a toggle."""
    async with pool.acquire() as conn:
        resolved_id = await resolve_question_id(conn, question_id)
        await conn.execute(_BOOKMARK_SET_SQL, user_id, resolved_id)


async def clear_bookmark(pool: asyncpg.Pool, user_id: UUID, question_id: str) -> None:
    """``DELETE /bookmarks/{id}``: idempotent clear, not a toggle."""
    async with pool.acquire() as conn:
        resolved_id = await resolve_question_id(conn, question_id)
        await conn.execute(_BOOKMARK_CLEAR_SQL, user_id, resolved_id)


__all__ = ["clear_bookmark", "get_attempt_history", "set_bookmark", "submit"]
