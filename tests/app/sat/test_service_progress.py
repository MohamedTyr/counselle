"""Live-DB tests for `app/sat/service_progress.py` (plan §4.4, §4.6, §8.1).

Covers stats plumbing, export/import round-tripping (byte-for-byte keys,
A12), import's replace semantics (A13: bookmarks wiped even when absent
from the file), A13a defaulting for a minimal row, and reset.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.sat import service_attempts, service_progress, service_questions
from app.sat.errors import SatValidationError
from tests.app.sat.conftest import MakeQuestion

pytestmark = pytest.mark.live_db


async def test_stats_reflects_recorded_attempts(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("p_stats001", module="math")
    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )

    stats = await service_progress.get_stats(app_pool, user_id, today=datetime.now(UTC).date())
    assert stats.total_attempts_count == 1
    assert stats.unique_correct == 1
    assert stats.math.unique_attempted == 1
    assert stats.heatmap[datetime.now(UTC).date().isoformat()] == 1


async def test_export_then_import_round_trips(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("p_export01")
    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    await service_attempts.set_bookmark(app_pool, user_id, question_id)

    now = datetime.now(UTC)
    exported = await service_progress.export_progress(app_pool, user_id, now=now)
    payload = json.loads(exported)
    assert payload["format"] == "LiPrep"
    assert payload["version"] == 1
    assert len(payload["data"]["attempts"]) == 1
    assert "id" not in payload["data"]["attempts"][0]  # A12: numeric id omitted
    assert len(payload["data"]["bookmarks"]) == 1

    result = await service_progress.import_progress(
        app_pool, user_id, data=exported, today=now.date(), now=now
    )
    assert result.attempts_imported == 1
    assert result.bookmarks_imported == 1

    history = await service_attempts.get_attempt_history(app_pool, user_id, question_id)
    assert len(history) == 1
    assert history[0].user_answer == "A"


async def test_import_replaces_and_wipes_bookmarks_even_when_file_has_none(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """A13: import always replaces both attempts and bookmarks, even when
    the file carries no bookmarks at all."""
    user_id = await make_user()
    question_id = await make_question("p_replace1")
    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    await service_attempts.set_bookmark(app_pool, user_id, question_id)

    now = datetime.now(UTC)
    empty_file = json.dumps(
        {
            "format": "LiPrep",
            "version": 1,
            "exportedAt": int(now.timestamp() * 1000),
            "exportDateStr": now.date().isoformat(),
            "data": {"attempts": [], "bookmarks": []},
        }
    )
    result = await service_progress.import_progress(
        app_pool, user_id, data=empty_file, today=now.date(), now=now
    )
    assert result.attempts_imported == 0
    assert result.bookmarks_imported == 0

    history = await service_attempts.get_attempt_history(app_pool, user_id, question_id)
    assert history == []
    async with app_pool.acquire() as conn:
        bookmark_count = await conn.fetchval(
            "SELECT count(*) FROM counselle.sat_bookmarks WHERE user_id = $1", user_id
        )
    assert bookmark_count == 0


async def test_import_defaults_a_minimal_row_and_keeps_unknown_ids(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    """A13a: a row needs only a string questionId and a boolean isCorrect —
    everything else defaults — and an id our bank does not hold is kept, not
    dropped (§3.4: no FK from sat_attempts to sat_questions)."""
    user_id = await make_user()
    now = datetime.now(UTC)
    minimal_file = json.dumps(
        {
            "format": "LiPrep",
            "data": {
                "attempts": [{"questionId": "unknownid", "isCorrect": True}],
                "bookmarks": [],
            },
        }
    )
    result = await service_progress.import_progress(
        app_pool, user_id, data=minimal_file, today=now.date(), now=now
    )
    assert result.attempts_imported == 1

    history = await service_attempts.get_attempt_history(app_pool, user_id, "unknownid")
    assert len(history) == 1
    assert history[0].module == "reading"  # A13a default
    assert history[0].score_band == 3  # A13a default
    assert history[0].time_spent_seconds == 1  # A13a default

    async with app_pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM counselle.sat_attempts WHERE user_id = $1", user_id
        )


async def test_import_invalid_json_raises_validation_error(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    now = datetime.now(UTC)
    with pytest.raises(SatValidationError):
        await service_progress.import_progress(
            app_pool, user_id, data="not json at all", today=now.date(), now=now
        )


async def test_reset_clears_attempts_and_bookmarks_only(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("p_reset001")
    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    await service_attempts.set_bookmark(app_pool, user_id, question_id)

    await service_progress.reset_progress(app_pool, user_id)

    history = await service_attempts.get_attempt_history(app_pool, user_id, question_id)
    assert history == []
    async with app_pool.acquire() as conn:
        bookmark_count = await conn.fetchval(
            "SELECT count(*) FROM counselle.sat_bookmarks WHERE user_id = $1", user_id
        )
    assert bookmark_count == 0
    # The question itself is untouched (reset never touches the bank).
    question = await service_questions.get_question(app_pool, question_id)
    assert question.question_id == question_id
