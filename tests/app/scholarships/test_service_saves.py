"""Live-DB tests for `app/scholarships/service_saves.py` (plan §11
behaviours 10-12)."""

from __future__ import annotations

from uuid import UUID

import asyncpg
import pytest

from app.scholarships import service, service_saves
from app.scholarships.errors import ScholarshipNotFoundError
from app.scholarships.models import StatusChangeIn
from tests.app.scholarships.conftest import MakeScholarship, MakeUser

pytestmark = pytest.mark.live_db


async def test_save_is_idempotent_and_needs_published(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    student = await make_user()
    published = await make_scholarship("published")
    draft = await make_scholarship("draft")
    archived = await make_scholarship("draft")
    await service.change_status(app_pool, archived.id, StatusChangeIn(status="archived"), admin)

    await service_saves.save(app_pool, student, published.id)
    await service_saves.save(app_pool, student, published.id)
    for record in (draft, archived):
        with pytest.raises(ScholarshipNotFoundError):
            await service_saves.save(app_pool, student, record.id)

    assert await service_saves.saved_ids(app_pool, student) == [published.id]
    await service_saves.unsave(app_pool, student, published.id)
    await service_saves.unsave(app_pool, student, published.id)
    assert await service_saves.saved_ids(app_pool, student) == []


async def test_saves_hidden_while_unpublished_and_back_on_republish(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    student = await make_user()
    record = await make_scholarship("published")
    await service_saves.save(app_pool, student, record.id)

    await service.change_status(app_pool, record.id, StatusChangeIn(status="draft"), admin)
    assert await service_saves.saved_ids(app_pool, student) == []
    await service.change_status(app_pool, record.id, StatusChangeIn(status="published"), admin)
    assert await service_saves.saved_ids(app_pool, student) == [record.id]


async def test_saves_are_per_user_and_cascade_on_user_delete(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    alice, bob = await make_user(), await make_user()
    record = await make_scholarship("published")
    await service_saves.save(app_pool, alice, record.id)

    assert await service_saves.saved_ids(app_pool, bob) == []
    await service_saves.unsave(app_pool, bob, record.id)
    assert await service_saves.saved_ids(app_pool, alice) == [record.id]

    await app_pool.execute("DELETE FROM counselle.users WHERE id = $1", alice)
    remaining = await app_pool.fetchval(
        "SELECT count(*) FROM counselle.scholarship_saves WHERE user_id = $1", alice
    )
    assert remaining == 0
    assert (await service.get(app_pool, record.id)).id == record.id
    assert await service.revisions(app_pool, record.id)


async def test_deleting_the_editor_keeps_the_record_and_history(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    editor = await make_user(superuser=True)
    record = await make_scholarship("draft")
    await app_pool.execute(
        "UPDATE counselle.scholarship_revisions SET actor_id = $1 WHERE scholarship_id = $2",
        editor,
        record.id,
    )
    await app_pool.execute("DELETE FROM counselle.users WHERE id = $1", editor)
    revisions = await service.revisions(app_pool, record.id)
    assert revisions[0].actor_email is None
