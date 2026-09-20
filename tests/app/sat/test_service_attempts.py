"""Live-DB tests for `app/sat/service_attempts.py` (plan §4.3, §8.1).

Covers retry-safe submit (same `client_attempt_id` never creates a second
row), a changed-answer conflict (logged, still answered from the stored
row), the `local_date` UTC-1..UTC+1 window, the seconds floor/ceiling
clamp, mcq/spr answer validation, idempotent bookmarks, and per-user scoping.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.sat import service_attempts
from app.sat.errors import SatValidationError
from config.settings import get_settings
from tests.app.sat.conftest import MakeQuestion

pytestmark = pytest.mark.live_db


async def test_submit_grades_and_records(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("s_grade001")

    result = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=12,
        local_date=datetime.now(UTC).date(),
    )
    assert result.is_correct is True
    assert result.correct_answers == ("A",)
    assert len(result.attempts) == 1
    assert result.attempts[0].is_correct is True

    wrong = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="B",
        time_spent_seconds=5,
        local_date=datetime.now(UTC).date(),
    )
    assert wrong.is_correct is False
    assert len(wrong.attempts) == 2
    # Q28: oldest first, the new attempt last.
    assert [a.user_answer for a in wrong.attempts] == ["A", "B"]


async def test_submit_is_retry_safe_not_idempotent_by_question(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """Q26: a second submit of the same question with a *different*
    client_attempt_id is a real second attempt; the *same* client_attempt_id
    retried must never create a second row."""
    user_id = await make_user()
    question_id = await make_question("s_retry001")
    same_id = uuid4()

    first = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=same_id,
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    retried = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=same_id,
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    assert len(first.attempts) == 1
    assert len(retried.attempts) == 1  # no second row from the retry

    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="B",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    history = await service_attempts.get_attempt_history(app_pool, user_id, question_id)
    assert len(history) == 2  # the retry never added a row; the new id did


async def test_submit_conflict_with_changed_answer_serves_stored_row(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """A conflicting retry whose payload differs from the stored row is
    still answered from the stored row (the first press is authoritative)."""
    user_id = await make_user()
    question_id = await make_question("s_conflict1")
    same_id = uuid4()

    first = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=same_id,
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    changed = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=same_id,
        answer="B",  # different answer, same client_attempt_id
        time_spent_seconds=99,
        local_date=datetime.now(UTC).date(),
    )
    assert first.is_correct is changed.is_correct
    assert changed.attempts[0].user_answer == "A"  # stored row wins, not "B"
    assert len(changed.attempts) == 1


async def test_submit_rejects_local_date_outside_window(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("s_datewin01")
    too_far_past = date.today() - timedelta(days=5)

    with pytest.raises(SatValidationError):
        await service_attempts.submit(
            app_pool,
            user_id,
            question_id,
            client_attempt_id=uuid4(),
            answer="A",
            time_spent_seconds=10,
            local_date=too_far_past,
        )


async def test_submit_seconds_floor_and_ceiling(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    question_id = await make_question("s_seconds01")
    max_seconds = get_settings().sat_attempt_max_seconds

    floored = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=0,
        local_date=datetime.now(UTC).date(),
    )
    assert floored.attempts[0].time_spent_seconds == 1

    capped = await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=max_seconds * 10,
        local_date=datetime.now(UTC).date(),
    )
    assert capped.attempts[-1].time_spent_seconds == max_seconds


async def test_submit_validates_mcq_and_spr_answers(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_id = await make_user()
    mcq_id = await make_question("s_valmcq01", item_type="mcq")
    spr_id = await make_question(
        "s_valspr01", item_type="spr", answer_options=[], correct_answers=["3/4"]
    )

    with pytest.raises(SatValidationError):
        await service_attempts.submit(
            app_pool,
            user_id,
            mcq_id,
            client_attempt_id=uuid4(),
            answer="Z",  # not one of the question's labels
            time_spent_seconds=5,
            local_date=datetime.now(UTC).date(),
        )
    with pytest.raises(SatValidationError):
        await service_attempts.submit(
            app_pool,
            user_id,
            spr_id,
            client_attempt_id=uuid4(),
            answer="not-numeric-ish!!",  # outside [0-9./-]{1,7}
            time_spent_seconds=5,
            local_date=datetime.now(UTC).date(),
        )
    ok = await service_attempts.submit(
        app_pool,
        user_id,
        spr_id,
        client_attempt_id=uuid4(),
        answer="3/4",
        time_spent_seconds=5,
        local_date=datetime.now(UTC).date(),
    )
    assert ok.is_correct is True


async def test_bookmarks_are_idempotent_and_scoped_per_user(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_a = await make_user()
    user_b = await make_user()
    question_id = await make_question("s_bookmark1")

    await service_attempts.set_bookmark(app_pool, user_a, question_id)
    await service_attempts.set_bookmark(app_pool, user_a, question_id)  # idempotent
    await service_attempts.clear_bookmark(app_pool, user_b, question_id)  # no-op, no error

    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT user_id FROM counselle.sat_bookmarks WHERE question_id = $1", question_id
        )
    assert {r["user_id"] for r in rows} == {user_a}

    await service_attempts.clear_bookmark(app_pool, user_a, question_id)
    await service_attempts.clear_bookmark(app_pool, user_a, question_id)  # idempotent
    async with app_pool.acquire() as conn:
        remaining = await conn.fetchval(
            "SELECT count(*) FROM counselle.sat_bookmarks WHERE question_id = $1", question_id
        )
    assert remaining == 0


async def test_attempt_history_scoped_per_user(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    user_a = await make_user()
    user_b = await make_user()
    question_id = await make_question("s_history01")

    await service_attempts.submit(
        app_pool,
        user_a,
        question_id,
        client_attempt_id=uuid4(),
        answer="A",
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )
    history_a = await service_attempts.get_attempt_history(app_pool, user_a, question_id)
    history_b = await service_attempts.get_attempt_history(app_pool, user_b, question_id)
    assert len(history_a) == 1
    assert len(history_b) == 0
