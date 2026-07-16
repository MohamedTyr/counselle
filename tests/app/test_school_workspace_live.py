"""Live DB integrity gates for the school workspace reference layer."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import date
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationCreate,
    ApplicationPatch,
    EssayCreate,
    EssayPatch,
    WorkspaceValidationError,
)
from app.workspace.service_applications import add_application, update_application
from app.workspace.service_essays import (
    archive_essay,
    create_essay,
    duplicate_essay,
    restore_essay,
    update_essay,
)
from app.workspace.service_reference import get_school_reference
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

pytestmark = pytest.mark.live_db


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def catalog() -> AsyncIterator[Catalog]:
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def user_id(app_pool: asyncpg.Pool) -> AsyncIterator[UUID]:
    value = uuid4()
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.users
               (id, email, hashed_password, is_active, is_superuser, is_verified)
               VALUES ($1, $2, 'test', true, false, false)""",
            value,
            f"{value}@school-workspace.test",
        )
    try:
        yield value
    finally:
        async with app_pool.acquire() as conn:
            source_url = f"https://example.edu/{value}"
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", value)
            await conn.execute(
                "DELETE FROM counselle.school_requirements WHERE source_url = $1", source_url
            )
            await conn.execute(
                "DELETE FROM counselle.school_essay_prompts WHERE source_url = $1", source_url
            )
            await conn.execute(
                "DELETE FROM counselle.school_prompt_groups WHERE source_url = $1", source_url
            )


async def _application(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, *, cycle: int = 2027
):
    unitid = sorted(catalog.school_names)[0]
    return await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=unitid, cycle_year=cycle, list_type="Target", round="RD"),
    )


async def test_reference_returns_only_published_provenanced_rows(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    unitid = result.application.school_unitid
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_requirements
               (school_unitid, cycle_year, kind, label, state, source_url)
               VALUES ($1, 2027, 'fee', 'Application fee', 'draft', $2)""",
            unitid,
            f"https://example.edu/{user_id}",
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute(
                """INSERT INTO counselle.school_requirements
                   (school_unitid, cycle_year, kind, label, state, source_url, published_at)
                   VALUES ($1, 2027, 'fafsa', 'FAFSA', 'published', $2, now())""",
                unitid,
                f"https://example.edu/{user_id}",
            )
        await conn.execute(
            """INSERT INTO counselle.school_requirements
               (school_unitid, cycle_year, kind, label, state, source, source_url,
                verified_at, published_at, retired_at)
               VALUES ($1, 2027, 'css_profile', 'CSS Profile', 'retracted',
                       'Admissions office', $3, $2, now(), now())""",
            unitid,
            date(2026, 7, 12),
            f"https://example.edu/{user_id}",
        )
        await conn.execute(
            """INSERT INTO counselle.school_requirements
               (school_unitid, cycle_year, kind, label, state, source, source_url,
                verified_at, published_at)
               VALUES ($1, 2027, 'teacher_rec', 'Teacher recommendations', 'published',
                       'Admissions office', $3, $2, now())""",
            unitid,
            date(2026, 7, 12),
            f"https://example.edu/{user_id}",
        )
    reference = await get_school_reference(app_pool, catalog, unitid=unitid, cycle_year=2027)
    assert [item.kind for item in reference.requirements] == ["teacher_rec"]
    assert reference.status == "loaded"


async def test_published_reference_provenance_timestamp_is_immutable(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    requirement_id = uuid4()
    verified_at = date(2026, 7, 12)
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_requirements
               (id, school_unitid, cycle_year, kind, label, state, source, source_url,
                verified_at, published_at)
               VALUES ($1, $2, 2027, 'fee', 'Application fee', 'published',
                       'Admissions office', $3, $4, now())""",
            requirement_id,
            result.application.school_unitid,
            f"https://example.edu/{user_id}",
            verified_at,
        )
        with pytest.raises(asyncpg.RaiseError):
            await conn.execute(
                """UPDATE counselle.school_requirements
                   SET verified_at = $2
                   WHERE id = $1""",
                requirement_id,
                date(2026, 7, 13),
            )
        persisted = await conn.fetchval(
            "SELECT verified_at FROM counselle.school_requirements WHERE id = $1",
            requirement_id,
        )
    assert persisted == verified_at


async def test_empty_reference_is_loaded_not_a_query_failure(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    reference = await get_school_reference(
        app_pool,
        catalog,
        unitid=result.application.school_unitid,
        cycle_year=2027,
    )
    assert reference.status == "loaded"
    assert reference.populated is False
    assert reference.prompt_groups == []
    assert reference.prompts == []
    assert reference.requirements == []


async def test_active_application_uniqueness_is_exact_cycle(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    first = await _application(app_pool, catalog, user_id, cycle=2027)
    second = await _application(app_pool, catalog, user_id, cycle=2028)
    assert first.application.school_unitid == second.application.school_unitid
    with pytest.raises(WorkspaceValidationError):
        await _application(app_pool, catalog, user_id, cycle=2027)
    with pytest.raises(WorkspaceValidationError, match="application cycle"):
        await update_application(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            application_id=second.application.id,
            data=ApplicationPatch(cycle_year=2027),
        )


async def test_platform_validation_uses_and_persists_combined_application_state(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    kwargs = dict(
        app_pool=app_pool,
        catalog=catalog,
        event_bus=WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )

    with pytest.raises(WorkspaceValidationError, match="platform_other is required"):
        await update_application(**kwargs, data=ApplicationPatch(platform="other"))

    updated = await update_application(
        **kwargs,
        data=ApplicationPatch(platform="other", platform_other="QuestBridge"),
    )
    assert updated.platform == "other"
    assert updated.platform_other == "QuestBridge"

    renamed = await update_application(
        **kwargs,
        data=ApplicationPatch(platform_other="ApplyTexas"),
    )
    assert renamed.platform == "other"
    assert renamed.platform_other == "ApplyTexas"

    common_app = await update_application(
        **kwargs,
        data=ApplicationPatch(platform="common_app"),
    )
    assert common_app.platform == "common_app"
    assert common_app.platform_other is None


async def test_prompt_links_are_school_cycle_scoped_unique_and_duplicates_unlink(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    unitid = result.application.school_unitid
    prompt_id = uuid4()
    other_prompt_id = uuid4()
    async with app_pool.acquire() as conn:
        for identifier, prompt_unitid in ((prompt_id, unitid), (other_prompt_id, unitid + 1)):
            await conn.execute(
                """INSERT INTO counselle.school_essay_prompts
                   (id, school_unitid, cycle_year, ordinal, prompt, state, source, source_url,
                    verified_at, published_at)
                   VALUES ($1, $2, 2027, 1, 'Why us?', 'published', 'Admissions office',
                           $4, $3, now())""",
                identifier,
                prompt_unitid,
                date(2026, 7, 12),
                f"https://example.edu/{user_id}",
            )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            title="Why us",
            application_id=result.application.id,
            prompt_ref=prompt_id,
            prompt="Caller-supplied contradiction",
            word_limit=999,
        ),
    )
    assert essay.prompt == "Why us?"
    assert essay.word_limit is None
    essay = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(prompt="Another contradiction", word_limit=1),
    )
    assert essay.prompt == "Why us?"
    assert essay.word_limit is None
    with pytest.raises(WorkspaceValidationError):
        await create_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=EssayCreate(
                title="Duplicate", application_id=result.application.id, prompt_ref=prompt_id
            ),
        )
    with pytest.raises(WorkspaceValidationError):
        await update_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay.id,
            data=EssayPatch(prompt_ref=other_prompt_id),
        )
    duplicate = await duplicate_essay(
        app_pool, catalog, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=essay.id
    )
    assert duplicate.prompt_ref is None
    unlinked = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(prompt_ref=None),
    )
    assert unlinked.prompt_ref is None
    assert unlinked.prompt == "Why us?"
    assert unlinked.word_limit is None
    reattached = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(prompt_ref=prompt_id),
    )
    assert reattached.prompt_ref == prompt_id


async def test_prompt_link_rejects_a_different_cycle(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id, cycle=2027)
    prompt_id = uuid4()
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_essay_prompts
               (id, school_unitid, cycle_year, ordinal, prompt, state, source, source_url,
                verified_at, published_at)
               VALUES ($1, $2, 2028, 1, 'Next-cycle prompt', 'published',
                       'Admissions office', $3, $4, now())""",
            prompt_id,
            result.application.school_unitid,
            f"https://example.edu/{user_id}",
            date(2026, 7, 12),
        )
    with pytest.raises(WorkspaceValidationError, match="cycle"):
        await create_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=EssayCreate(
                title="Wrong cycle",
                application_id=result.application.id,
                prompt_ref=prompt_id,
            ),
        )


async def test_checklist_patch_is_atomic_and_json_null_deletes(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    kwargs = dict(
        app_pool=app_pool,
        catalog=catalog,
        event_bus=WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )
    await asyncio.gather(
        update_application(**kwargs, data=ApplicationPatch(checklist={"fee": {"status": "paid"}})),
        update_application(
            **kwargs, data=ApplicationPatch(checklist={"fafsa": {"status": "submitted"}})
        ),
    )
    updated = await update_application(**kwargs, data=ApplicationPatch(checklist={"fee": None}))
    assert "fee" not in updated.checklist.root
    assert updated.checklist.root["fafsa"].status == "submitted"
    async with app_pool.acquire() as conn:
        update_count = await conn.fetchval(
            """SELECT count(*) FROM counselle.workspace_changes
               WHERE user_id = $1 AND object_type = 'application' AND op = 'updated'""",
            user_id,
        )
    assert update_count == 3


async def test_archived_prompt_link_blocks_cycle_change_and_restore_revalidates_unique_link(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    prompt_id = uuid4()
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_essay_prompts
               (id, school_unitid, cycle_year, ordinal, prompt, state, source, source_url,
                verified_at, published_at)
               VALUES ($1, $2, 2027, 1, 'Why here?', 'published', 'Admissions office',
                       $3, $4, now())""",
            prompt_id,
            result.application.school_unitid,
            f"https://example.edu/{user_id}",
            date(2026, 7, 12),
        )
    first = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="First", application_id=result.application.id, prompt_ref=prompt_id),
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=first.id
    )
    with pytest.raises(WorkspaceValidationError, match="cycle"):
        await update_application(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            application_id=result.application.id,
            data=ApplicationPatch(cycle_year=2028),
        )
    await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            title="Second", application_id=result.application.id, prompt_ref=prompt_id
        ),
    )
    with pytest.raises(WorkspaceValidationError, match="already has an active essay"):
        await restore_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=first.id,
        )


async def test_prompt_is_hidden_when_its_group_is_retired(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    group_id = uuid4()
    source_url = f"https://example.edu/{user_id}"
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_prompt_groups
               (id, school_unitid, cycle_year, label, choice_min, state, source, source_url,
                verified_at, published_at, retired_at)
               VALUES ($1, $2, 2027, 'Choose one', 1, 'published', 'Admissions office',
                       $3, $4, now(), now())""",
            group_id,
            result.application.school_unitid,
            source_url,
            date(2026, 7, 12),
        )
        await conn.execute(
            """INSERT INTO counselle.school_essay_prompts
               (school_unitid, cycle_year, ordinal, prompt, group_id, state, source, source_url,
                verified_at, published_at)
               VALUES ($1, 2027, 1, 'Choose one response', $2, 'published',
                       'Admissions office', $3, $4, now())""",
            result.application.school_unitid,
            group_id,
            source_url,
            date(2026, 7, 12),
        )
    reference = await get_school_reference(
        app_pool, catalog, unitid=result.application.school_unitid, cycle_year=2027
    )
    assert reference.prompts == []


async def test_archived_essay_can_restore_against_matching_historical_prompt(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID
) -> None:
    result = await _application(app_pool, catalog, user_id)
    prompt_id = uuid4()
    async with app_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.school_essay_prompts
               (id, school_unitid, cycle_year, ordinal, prompt, word_limit, state,
                source, source_url, verified_at, published_at)
               VALUES ($1, $2, 2027, 1, 'Historical prompt', 250, 'published',
                       'Admissions office', $3, $4, now())""",
            prompt_id,
            result.application.school_unitid,
            f"https://example.edu/{user_id}",
            date(2026, 7, 12),
        )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            title="Historical", application_id=result.application.id, prompt_ref=prompt_id
        ),
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=essay.id
    )
    async with app_pool.acquire() as conn:
        await conn.execute(
            """UPDATE counselle.school_essay_prompts
               SET state = 'retracted', retired_at = now(), updated_at = now()
               WHERE id = $1""",
            prompt_id,
        )
    restored = await restore_essay(
        app_pool, catalog, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=essay.id
    )
    assert restored.prompt_ref == prompt_id
    assert restored.prompt == "Historical prompt"
    assert restored.word_limit == 250
