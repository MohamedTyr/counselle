"""Live-DB fixtures for `app/scholarships` tests (adapted from
`tests/app/sat/conftest.py`).

The local database is shared, so tests assert only on the records they
create. Teardown deletes every scholarship a fixture user created before
deleting the users themselves.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest_asyncio

from app.scholarships import service
from app.scholarships.models import AdminScholarship, ScholarshipCreateIn
from config.settings import get_settings
from counselle_db.db import create_pool

TODAY = dt.datetime.now(dt.UTC).date()

MakeUser = Callable[..., Awaitable[UUID]]
MakeScholarship = Callable[..., Awaitable[AdminScholarship]]


def complete_fields(**overrides: Any) -> dict[str, Any]:
    """A draft that passes every publish check."""
    fields: dict[str, Any] = {
        "name": "Future Leaders Award",
        "sponsor": "Acme Foundation",
        "summary": "For students who lead.",
        "apply_url": "https://acme.org/apply",
        "source_url": "https://acme.org/scholarship",
        "award": {"kind": "fixed", "amount": 5000},
        "deadline": {"kind": "fixed", "date": (TODAY + dt.timedelta(days=60)).isoformat()},
        "eligibility": [{"kind": "state", "any_of": ["TX"]}],
        "last_checked_on": TODAY.isoformat(),
    }
    fields.update(overrides)
    return fields


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def make_user(app_pool: asyncpg.Pool) -> AsyncIterator[MakeUser]:
    created: list[UUID] = []

    async def _make_user(*, superuser: bool = False) -> UUID:
        user_id = uuid4()
        await app_pool.execute(
            """
            INSERT INTO counselle.users
              (id, email, hashed_password, is_active, is_superuser, is_verified)
            VALUES ($1, $2, 'not-a-real-password-hash', true, $3, false)
            """,
            user_id,
            f"{user_id}@scholarships.test",
            superuser,
        )
        created.append(user_id)
        return user_id

    try:
        yield _make_user
    finally:
        async with app_pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM counselle.scholarships WHERE created_by = ANY($1::uuid[])", created
            )
            await conn.execute("DELETE FROM counselle.users WHERE id = ANY($1::uuid[])", created)


@pytest_asyncio.fixture
async def admin(make_user: MakeUser) -> UUID:
    return await make_user(superuser=True)


@pytest_asyncio.fixture
async def make_scholarship(app_pool: asyncpg.Pool, admin: UUID) -> MakeScholarship:
    async def _make(status: str = "draft", **overrides: Any) -> AdminScholarship:
        data = ScholarshipCreateIn.model_validate(
            {**complete_fields(**overrides), "status": status}
        )
        return await service.create(app_pool, data, admin)

    return _make
