"""Shared live-DB fixtures for `app/sat` service tests (plan §8.1).

Mirrors `tests/app/test_workspace_services_live.py`'s `app_pool`/`make_user`
shape. The question bank is not seeded locally, so `make_question` inserts
directly into `sat_questions`/`sat_question_content` — the minimal row a
service function needs, not a realistic bank item.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from datetime import datetime
from uuid import UUID, uuid4

import asyncpg
import pytest_asyncio

from config.settings import get_settings
from counselle_db.db import create_pool


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def make_user(app_pool: asyncpg.Pool) -> AsyncIterator[Callable[[], Awaitable[UUID]]]:
    created: list[UUID] = []

    async def _make_user() -> UUID:
        user_id = uuid4()
        async with app_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.users
                  (id, email, hashed_password, is_active, is_superuser, is_verified)
                VALUES ($1, $2, $3, true, false, false)
                """,
                user_id,
                f"{user_id}@sat.test",
                "not-a-real-password-hash",
            )
        created.append(user_id)
        return user_id

    try:
        yield _make_user
    finally:
        async with app_pool.acquire() as conn:
            for user_id in created:
                await conn.execute("DELETE FROM counselle.users WHERE id = $1", user_id)


MakeQuestion = Callable[..., Awaitable[str]]


@pytest_asyncio.fixture
async def make_question(app_pool: asyncpg.Pool) -> AsyncIterator[MakeQuestion]:
    created: list[str] = []

    async def _make_question(
        question_id: str,
        *,
        module: str = "reading",
        domain_cd: str = "CID",
        skill_cd: str = "INF",
        score_band: int = 4,
        item_type: str = "mcq",
        in_bluebook: bool = False,
        retired_at: datetime | None = None,
        answer_options: Sequence[dict[str, str]] | None = None,
        correct_answers: Sequence[str] = ("A",),
        rationale: str = "Because the passage says so.",
        stem: str = "What is the answer?",
        aliases: Sequence[str] = (),
    ) -> str:
        if answer_options is None:
            answer_options = (
                [
                    {"label": "A", "content": "Right"},
                    {"label": "B", "content": "Wrong"},
                    {"label": "C", "content": "Wrong"},
                    {"label": "D", "content": "Wrong"},
                ]
                if item_type == "mcq"
                else []
            )
        async with app_pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.sat_questions
                  (question_id, external_id, ibn, u_id, source, module, domain_cd, skill_cd,
                   score_band, difficulty, program, item_type, in_bluebook, content_sha256,
                   retired_at)
                VALUES ($1, $2, NULL, $3, 'qbank', $4, $5, $6, $7, 'M', 'SAT', $8, $9, $10, $11)
                """,
                question_id,
                uuid4(),
                uuid4(),
                module,
                domain_cd,
                skill_cd,
                score_band,
                item_type,
                in_bluebook,
                f"sha-{question_id}",
                retired_at,
            )
            await conn.execute(
                """
                INSERT INTO counselle.sat_question_content
                  (question_id, stimulus, stem, answer_options, correct_answers, rationale)
                VALUES ($1, NULL, $2, $3, $4, $5)
                """,
                question_id,
                stem,
                list(answer_options),  # pool's jsonb codec encodes this itself
                list(correct_answers),
                rationale,
            )
            for alias_id in aliases:
                await conn.execute(
                    """
                    INSERT INTO counselle.sat_question_aliases (alias_id, question_id)
                    VALUES ($1, $2)
                    """,
                    alias_id,
                    question_id,
                )
        created.append(question_id)
        return question_id

    try:
        yield _make_question
    finally:
        async with app_pool.acquire() as conn:
            for question_id in created:
                await conn.execute(
                    "DELETE FROM counselle.sat_question_aliases WHERE question_id = $1",
                    question_id,
                )
                await conn.execute(
                    "DELETE FROM counselle.sat_attempts WHERE question_id = $1", question_id
                )
                await conn.execute(
                    "DELETE FROM counselle.sat_bookmarks WHERE question_id = $1", question_id
                )
                await conn.execute(
                    "DELETE FROM counselle.sat_question_content WHERE question_id = $1",
                    question_id,
                )
                await conn.execute(
                    "DELETE FROM counselle.sat_questions WHERE question_id = $1", question_id
                )
