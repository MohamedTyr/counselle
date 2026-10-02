"""Live DB tests: the supplements catalog reaching students' essays."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from adapters import supplements_store as store
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationCreate,
    ApplicationSupplements,
    EssayPatch,
    WorkspaceValidationError,
)
from app.workspace.service_applications import add_application
from app.workspace.service_essays import archive_essay, restore_essay, update_essay
from app.workspace.service_supplements import (
    acknowledge_prompt_change,
    list_supplements,
    propagate_catalog_changes,
    start_supplement_essay,
)
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from domain.supplements import SupplementPrompt, prompts_hash

pytestmark = pytest.mark.live_db

WHY = "Why do you want to attend our university? Be specific."
WHY_REWORDED = "Why do you want to attend our university? Please be specific."
COMMUNITY = "Describe a community you belong to and your place within it."
PICK_A = "Tell us about a book that changed your mind."
PICK_B = "Tell us about a problem you would like to solve."


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
    uid = uuid4()
    await app_pool.execute(
        """
        INSERT INTO counselle.users
          (id, email, hashed_password, is_active, is_superuser, is_verified)
        VALUES ($1, $2, 'not-a-real-password-hash', true, false, false)
        """,
        uid,
        f"{uid}@supplements.test",
    )
    try:
        yield uid
    finally:
        await app_pool.execute("DELETE FROM counselle.users WHERE id = $1", uid)


@pytest_asyncio.fixture
async def school(
    app_pool: asyncpg.Pool, catalog: Catalog
) -> AsyncIterator[Callable[[list[SupplementPrompt]], Awaitable[None]]]:
    """A real school with no catalog row of its own; yields a setter that
    stores its prompts the way a sync pass does. The catalog row is removed
    afterwards."""
    cycle = get_settings().supplements_cycle
    taken = set(await store.load_schools(app_pool, cycle))
    unitid = next(u for u in sorted(catalog.school_names) if u not in taken)

    async def set_prompts(prompts: list[SupplementPrompt]) -> None:
        await store.save_school(
            app_pool,
            cycle,
            store.SchoolRow(
                unitid=unitid,
                status="prompts" if prompts else "none",
                source_url="https://example.test/supplements",
                source_heading="Test University",
                block_sha256=None,
                prompts_sha256=prompts_hash(prompts),
                checked="unchecked",
                checked_on=None,
                prompts=prompts,
            ),
            changed=True,
        )

    set_prompts.unitid = unitid  # type: ignore[attr-defined]
    try:
        yield set_prompts
    finally:
        await app_pool.execute(
            "DELETE FROM counselle.supplement_schools WHERE cycle = $1 AND school_unitid = $2",
            cycle,
            unitid,
        )


def _base() -> list[SupplementPrompt]:
    return [
        SupplementPrompt(prompt=WHY, word_limit=250),
        SupplementPrompt(prompt=COMMUNITY, word_limit=300),
        SupplementPrompt(prompt=PICK_A, group="Choose one", choose_count=1, word_limit=200),
        SupplementPrompt(prompt=PICK_B, group="Choose one", choose_count=1, word_limit=200),
    ]


async def _add(app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, unitid: int) -> UUID:
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=unitid, cycle_year=2027, list_type="Target", round="RD"),
    )
    return result.application.id


async def _essays(app_pool: asyncpg.Pool, user_id: UUID) -> dict[str, asyncpg.Record]:
    rows = await app_pool.fetch(
        "SELECT * FROM counselle.essays WHERE user_id = $1 AND supplement_key IS NOT NULL",
        user_id,
    )
    return {r["supplement_prompt"]: r for r in rows}


async def _supplements(app_pool: asyncpg.Pool, user_id: UUID) -> ApplicationSupplements:
    (view,) = await list_supplements(app_pool, user_id=user_id)
    return view


async def test_adding_a_school_creates_only_its_required_essays(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)

    essays = await _essays(app_pool, user_id)
    assert set(essays) == {WHY, COMMUNITY}
    assert essays[WHY]["word_limit"] == 250
    view = await _supplements(app_pool, user_id)
    assert {p.prompt for p in view.prompts if p.essay_id} == {WHY, COMMUNITY}


async def test_starting_a_prompt_twice_returns_the_same_essay(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    application_id = await _add(app_pool, catalog, user_id, school.unitid)
    key = next(p.key for p in (await _supplements(app_pool, user_id)).prompts if p.prompt == PICK_A)

    first = await start_supplement_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=application_id,
        key=key,
    )
    again = await start_supplement_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=application_id,
        key=key,
    )
    assert again.id == first.id


async def test_reworded_prompt_moves_the_essay_and_keeps_the_students_limit(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)
    why = (await _essays(app_pool, user_id))[WHY]
    edited = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=why["id"],
        data=EssayPatch(word_limit=240),
    )

    prompts = _base()
    prompts[0] = SupplementPrompt(prompt=WHY_REWORDED, word_limit=250)
    await school(prompts)
    assert await propagate_catalog_changes(app_pool) >= 1

    moved = await app_pool.fetchrow("SELECT * FROM counselle.essays WHERE id = $1", why["id"])
    assert moved["prompt"] == WHY_REWORDED
    assert moved["prompt_previous"] == WHY
    assert moved["prompt_updated_at"] is not None
    assert moved["word_limit"] == 240  # the catalog's limit did not change
    # An open editor's guarded autosave must not conflict with the sync.
    assert moved["updated_at"] == edited.updated_at

    # Nothing is owed any more: a second pass touches nothing.
    assert await propagate_catalog_changes(app_pool) == 0

    await acknowledge_prompt_change(
        app_pool, WorkspaceEventBus(), user_id=user_id, essay_id=why["id"]
    )
    cleared = await app_pool.fetchrow("SELECT * FROM counselle.essays WHERE id = $1", why["id"])
    assert (cleared["prompt_previous"], cleared["prompt_updated_at"]) == (None, None)


async def test_a_new_catalog_limit_reaches_the_essay_without_a_prompt_notice(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)
    prompts = _base()
    prompts[0] = SupplementPrompt(prompt=WHY, word_limit=200)
    await school(prompts)
    await propagate_catalog_changes(app_pool)

    why = (await _essays(app_pool, user_id))[WHY]
    assert why["word_limit"] == 200
    assert why["prompt_previous"] is None and why["prompt_updated_at"] is None


async def test_a_dropped_prompt_is_flagged_and_cleared_when_it_returns(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)

    await school([p for p in _base() if p.prompt != COMMUNITY])
    await propagate_catalog_changes(app_pool)
    assert (await _essays(app_pool, user_id))[COMMUNITY]["prompt_removed_at"] is not None

    await school(_base())
    await propagate_catalog_changes(app_pool)
    assert (await _essays(app_pool, user_id))[COMMUNITY]["prompt_removed_at"] is None


async def test_a_deleted_supplement_is_not_recreated_after_a_rewording(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)
    why = (await _essays(app_pool, user_id))[WHY]
    await archive_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=why["id"],
    )

    prompts = _base()
    prompts[0] = SupplementPrompt(prompt=WHY_REWORDED, word_limit=250)
    await school(prompts)
    await propagate_catalog_changes(app_pool)

    count = await app_pool.fetchval(
        "SELECT count(*) FROM counselle.essays WHERE user_id = $1 AND prompt IN ($2, $3)",
        user_id,
        WHY,
        WHY_REWORDED,
    )
    assert count == 1


async def test_restoring_over_a_restarted_supplement_is_a_validation_error(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    application_id = await _add(app_pool, catalog, user_id, school.unitid)
    why = (await _essays(app_pool, user_id))[WHY]
    await archive_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=why["id"],
    )
    await start_supplement_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=application_id,
        key=why["supplement_key"],
    )

    with pytest.raises(WorkspaceValidationError):
        await restore_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=why["id"],
        )


async def test_moving_a_supplement_to_another_school_drops_its_link(
    app_pool: asyncpg.Pool, catalog: Catalog, user_id: UUID, school
) -> None:
    await school(_base())
    await _add(app_pool, catalog, user_id, school.unitid)
    other = next(u for u in sorted(catalog.school_names) if u != school.unitid)
    other_application = await _add(app_pool, catalog, user_id, other)
    why = (await _essays(app_pool, user_id))[WHY]

    await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=why["id"],
        data=EssayPatch(application_id=other_application),
    )

    moved = await app_pool.fetchrow("SELECT * FROM counselle.essays WHERE id = $1", why["id"])
    assert moved["supplement_key"] is None and moved["supplement_prompt"] is None
