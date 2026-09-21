"""Live-DB tests for `app/sat/service_questions.py` (plan §4.5, §8.1).

Covers the four `SolvedStatus` values against liprep's semantics (F4, F5),
empty skills/bands meaning *all* (F20), retired-question handling (§3.4),
and per-user scoping (a never sees b's attempts/bookmarks).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.sat import service_attempts, service_questions
from app.sat.errors import SatNotFoundError
from tests.app.sat.conftest import MakeQuestion

pytestmark = pytest.mark.live_db


async def _attempt(
    app_pool: asyncpg.Pool, user_id: UUID, question_id: str, *, answer: str = "A"
) -> None:
    await service_attempts.submit(
        app_pool,
        user_id,
        question_id,
        client_attempt_id=uuid4(),
        answer=answer,
        time_spent_seconds=10,
        local_date=datetime.now(UTC).date(),
    )


async def test_counts_and_session_all_four_statuses(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """F4/F5: unsolved = never attempted; incorrect ("Mistakes") = *latest*
    attempt wrong, not "ever incorrect"; bookmarked = flagged. A fixture
    log of the four cases against one skill so the semantics are pinned."""
    user_id = await make_user()
    unsolved = await make_question("q_unsolved1", skill_cd="INF")
    now_correct = await make_question("q_nowright1", skill_cd="INF")
    now_wrong = await make_question("q_nowwrong1", skill_cd="INF")
    bookmarked = await make_question("q_bookmark1", skill_cd="INF")

    # now_correct: wrong then right -> latest is correct, so NOT "incorrect"
    # even though it was once wrong (F4's point exactly).
    await _attempt(app_pool, user_id, now_correct, answer="B")
    await _attempt(app_pool, user_id, now_correct, answer="A")
    # now_wrong: right then wrong -> latest is wrong -> counts as incorrect.
    await _attempt(app_pool, user_id, now_wrong, answer="A")
    await _attempt(app_pool, user_id, now_wrong, answer="B")
    await service_attempts.set_bookmark(app_pool, user_id, bookmarked)

    # Scoped to this test's own four fixture rows (`question_ids`) — a
    # bank-synced dev database has thousands of other live INF rows for a
    # fresh user, so an unscoped count would include them too.
    fixture_ids = [unsolved, now_correct, now_wrong, bookmarked]
    counts_unsolved = await service_questions.get_counts(
        app_pool,
        user_id,
        bands=[],
        status="unsolved",
        exclude_bluebook=False,
        question_ids=fixture_ids,
    )
    counts_incorrect = await service_questions.get_counts(
        app_pool,
        user_id,
        bands=[],
        status="incorrect",
        exclude_bluebook=False,
        question_ids=fixture_ids,
    )
    counts_bookmarked = await service_questions.get_counts(
        app_pool,
        user_id,
        bands=[],
        status="bookmarked",
        exclude_bluebook=False,
        question_ids=fixture_ids,
    )
    counts_all = await service_questions.get_counts(
        app_pool,
        user_id,
        bands=[],
        status="all",
        exclude_bluebook=False,
        question_ids=fixture_ids,
    )

    # unsolved = never attempted: q_unsolved1 AND q_bookmark1 (bookmarking
    # alone is not an attempt).
    assert counts_unsolved["INF"] == 2
    assert counts_incorrect["INF"] == 1  # only q_nowwrong1 (F4)
    assert counts_bookmarked["INF"] == 1  # only q_bookmark1
    assert counts_all["INF"] == 4

    # Every one of the 29 skills is zero-filled (F13), not just INF — the
    # python-side zero-fill runs regardless of question_ids scoping.
    from app.sat.taxonomy_loader import load_taxonomy

    assert set(counts_all) == set(load_taxonomy().skill_codes())

    session_unsolved = await service_questions.list_session(
        app_pool,
        user_id,
        skills=[],
        bands=[],
        status="unsolved",
        exclude_bluebook=False,
        question_ids=fixture_ids,
    )
    assert {row.id for row in session_unsolved} == {unsolved, bookmarked}


async def test_empty_skills_and_bands_mean_all(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """F20: an empty skills or band list is *no filter*, not *no results*."""
    user_id = await make_user()
    await make_question("q_empty_a", skill_cd="INF", score_band=2)
    await make_question("q_empty_b", skill_cd="CTC", score_band=6)

    rows = await service_questions.list_session(
        app_pool, user_id, skills=[], bands=[], status="all", exclude_bluebook=False
    )
    ids = {row.id for row in rows}
    assert {"q_empty_a", "q_empty_b"} <= ids


async def test_retired_excluded_from_filtered_session_and_counts(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """§3.4: a retired question drops out of *filtered* /session and /counts,
    but is still served by /session?question= and /questions/{id} — a deep
    link keeps working."""
    user_id = await make_user()
    retired = await make_question(
        "q_retired1", skill_cd="INF", retired_at=datetime.now(UTC)
    )

    session_rows = await service_questions.list_session(
        app_pool, user_id, skills=[], bands=[], status="all", exclude_bluebook=False
    )
    assert retired not in {row.id for row in session_rows}

    # Scoped to just the retired fixture row — a bank-synced dev database
    # has hundreds of other live INF rows, so an unscoped count would be
    # nonzero for reasons unrelated to this test.
    counts = await service_questions.get_counts(
        app_pool,
        user_id,
        bands=[],
        status="all",
        exclude_bluebook=False,
        question_ids=[retired],
    )
    assert counts["INF"] == 0

    row = await service_questions.get_session_row(app_pool, user_id, retired)
    assert row.id == retired

    question = await service_questions.get_question(app_pool, retired)
    assert question.question_id == retired


async def test_get_question_resolves_alias_and_case(
    app_pool: asyncpg.Pool, make_question: MakeQuestion
) -> None:
    await make_question("abcd1234", aliases=["old00001"])

    by_alias = await service_questions.get_question(app_pool, "OLD00001")
    assert by_alias.question_id == "abcd1234"

    by_id = await service_questions.get_question(app_pool, "ABCD1234")
    assert by_id.question_id == "abcd1234"


async def test_get_question_unknown_id_raises_not_found(app_pool: asyncpg.Pool) -> None:
    with pytest.raises(SatNotFoundError):
        await service_questions.get_question(app_pool, "notreal1")


async def test_counts_and_bookmarks_scoped_per_user(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
    make_question: MakeQuestion,
) -> None:
    """Authz: user A's attempts/bookmarks never leak into user B's counts."""
    user_a = await make_user()
    user_b = await make_user()
    question = await make_question("q_scoped01", skill_cd="INF")

    await _attempt(app_pool, user_a, question, answer="A")
    await service_attempts.set_bookmark(app_pool, user_a, question)

    counts_a = await service_questions.get_counts(
        app_pool, user_a, bands=[], status="bookmarked", exclude_bluebook=False
    )
    counts_b = await service_questions.get_counts(
        app_pool, user_b, bands=[], status="bookmarked", exclude_bluebook=False
    )
    assert counts_a["INF"] == 1
    assert counts_b["INF"] == 0
