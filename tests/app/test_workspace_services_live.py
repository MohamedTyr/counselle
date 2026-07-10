"""Live DB gate tests for Phase 2 workspace services."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.workspace import service_applications
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ActivityCreate,
    ActivityPatch,
    ApplicationCreate,
    ApplicationPatch,
    EssayCreate,
    EssayPatch,
    HonorCreate,
    HonorPatch,
    TaskCreate,
    TaskPatch,
    WorkspaceNotFoundError,
    WorkspaceSeedingTemplate,
    WorkspaceValidationError,
)
from app.workspace.service_activities import (
    archive_activity,
    archive_honor,
    create_activity,
    create_honor,
    list_activities,
    list_honors,
    reorder_activities,
    reorder_honors,
    restore_activity,
    restore_honor,
    update_activity,
    update_honor,
)
from app.workspace.service_applications import (
    add_application,
    archive_application,
    list_applications,
    restore_application,
    search_schools,
    update_application,
)
from app.workspace.service_essays import (
    archive_essay,
    create_essay,
    get_essay,
    restore_essay,
    update_essay,
)
from app.workspace.service_tasks import (
    archive_task,
    bulk_archive,
    bulk_update_status,
    create_task,
    list_tasks,
    restore_task,
    search_tasks,
    task_board_counts,
    update_task,
)
from config.settings import get_settings, load_yaml_asset
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
async def make_user(
    app_pool: asyncpg.Pool,
) -> AsyncIterator[Callable[[], Awaitable[UUID]]]:
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
                f"{user_id}@workspace.test",
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


def _template() -> WorkspaceSeedingTemplate:
    return WorkspaceSeedingTemplate.model_validate(load_yaml_asset("workspace_seeding"))


def _unitid(catalog: Catalog, offset: int = 0) -> int:
    return sorted(catalog.school_names)[offset]


async def _change_count(app_pool: asyncpg.Pool, user_id: UUID) -> int:
    async with app_pool.acquire() as conn:
        return int(
            await conn.fetchval(
                "SELECT count(*) FROM counselle.workspace_changes WHERE user_id = $1",
                user_id,
            )
        )


async def test_add_application_seeding_is_atomic(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await make_user()
    unitid = _unitid(catalog)

    async def fail_mid_seed(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("seed failure")

    monkeypatch.setattr(service_applications, "seed_application_workspace", fail_mid_seed)

    with pytest.raises(RuntimeError, match="seed failure"):
        await add_application(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=ApplicationCreate(unitid=unitid, list_type="Target", round="RD"),
            template=_template(),
        )

    async with app_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM counselle.applications WHERE user_id = $1",
            user_id,
        )
    assert count == 0


async def test_ownership_duplicate_and_school_search_scoping(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    unitid = _unitid(catalog)

    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=unitid, list_type="Target", round="RD"),
        template=_template(),
    )

    assert await list_applications(app_pool, catalog, user_id=other_user_id) == []
    with pytest.raises(WorkspaceNotFoundError):
        await update_application(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=other_user_id,
            actor="student",
            application_id=result.application.id,
            data=ApplicationPatch(status="Applying"),
        )
    with pytest.raises(WorkspaceValidationError):
        await add_application(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=ApplicationCreate(unitid=unitid, list_type="Reach", round="EA"),
            template=_template(),
        )

    hits = await search_schools(
        catalog, app_pool, user_id=user_id, query=catalog.school_names[unitid], limit=8
    )
    assert any(hit.unitid == unitid and hit.on_list for hit in hits)


async def test_archive_cascade_restore_exact_set(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), list_type="Target", round="RD"),
        template=_template(),
    )
    # Seeding no longer creates a starter checklist (change 11); create a task
    # directly to exercise "archived directly, not via application" semantics.
    pre_archived = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(application_id=result.application.id, title="Extra task"),
    )

    await archive_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=pre_archived.id,
    )
    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )
    await restore_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )

    restored_tasks = await list_tasks(app_pool, user_id=user_id)
    assert len(restored_tasks) == 0
    assert pre_archived.id not in {task.id for task in restored_tasks}

    async with app_pool.acquire() as conn:
        via = await conn.fetchval(
            "SELECT archived_via_application FROM counselle.tasks WHERE id = $1",
            pre_archived.id,
        )
    assert via is None


async def test_task_and_essay_archived_via_application_restore_only_after_application_restore(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), list_type="Target", round="RD"),
        template=_template(),
    )
    # Seeding no longer creates a starter checklist (change 11); create a task
    # linked to the application directly.
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(application_id=result.application.id, title="Confirm requirements"),
    )
    task_id = task.id
    essay_id = result.seeded.essay_ids[0]

    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )

    with pytest.raises(WorkspaceNotFoundError):
        await restore_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            task_id=task_id,
        )
    with pytest.raises(WorkspaceNotFoundError):
        await restore_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay_id,
        )

    await restore_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )
    assert task_id in {task.id for task in await list_tasks(app_pool, user_id=user_id)}
    async with app_pool.acquire() as conn:
        essay_archived_at = await conn.fetchval(
            "SELECT archived_at FROM counselle.essays WHERE id = $1",
            essay_id,
        )
    assert essay_archived_at is None


async def test_task_restore_requires_linked_essay_active(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Personal statement", essay_type="Personal statement"),
    )
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Revise essay", essay_id=essay.id),
    )

    await archive_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=task.id,
    )
    await archive_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
    )

    with pytest.raises(WorkspaceNotFoundError):
        await restore_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            task_id=task.id,
        )

    await restore_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
    )
    restored = await restore_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=task.id,
    )
    assert restored.essay_id == essay.id


async def test_application_restore_keeps_task_archived_when_linked_essay_archived(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), list_type="Target", round="RD"),
        template=_template(),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            application_id=result.application.id,
            title="Why this school?",
            essay_type="Supplement",
        ),
    )
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(
            application_id=result.application.id,
            essay_id=essay.id,
            title="Revise supplement",
            category="essay",
        ),
    )

    await archive_essay(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
    )
    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )
    await restore_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
    )

    active_tasks = await list_tasks(app_pool, user_id=user_id)
    assert task.id not in {active_task.id for active_task in active_tasks}
    async with app_pool.acquire() as conn:
        task_archived_at = await conn.fetchval(
            "SELECT archived_at FROM counselle.tasks WHERE id = $1",
            task.id,
        )
    assert task_archived_at is not None

    await restore_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
    )
    restored_task = await restore_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=task.id,
    )

    assert restored_task.id == task.id
    active_task_ids = {
        active_task.id for active_task in await list_tasks(app_pool, user_id=user_id)
    }
    assert task.id in active_task_ids


async def test_change_log_rows_rollups_and_seeded_deadlines(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog), list_type="Target", round="RD", deadline=date(2027, 1, 10)
        ),
        template=_template(),
    )

    # Seeding no longer creates a starter checklist (change 11): only the
    # application + the one supplement essay slot are seeded.
    assert await _change_count(app_pool, user_id) == 2
    tasks = await list_tasks(app_pool, user_id=user_id)
    assert tasks == []
    await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=result.seeded.essay_ids[0],
        data=EssayPatch(status="Ready"),
    )

    apps = await list_applications(app_pool, catalog, user_id=user_id)
    assert apps[0].progress.completed == 0
    assert apps[0].progress.total == 0
    assert apps[0].essays.completed == 1
    assert apps[0].essays.total == 1
    assert await _change_count(app_pool, user_id) == 3


async def test_application_patch_round_trips_new_fields(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), list_type="Target", round="RD"),
        template=_template(),
    )

    updated = await update_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result.application.id,
        data=ApplicationPatch(
            status="Deferred",
            round="ED2",
            aid_deadline=date(2027, 2, 1),
            scholarship_deadline=date(2027, 3, 1),
            notes="Visited campus in June.",
            intended_major="Computer Science",
            test_plan="withhold",
        ),
    )

    assert updated.status == "Deferred"
    assert updated.round == "ED2"
    assert updated.aid_deadline == date(2027, 2, 1)
    assert updated.scholarship_deadline == date(2027, 3, 1)
    assert updated.notes == "Visited campus in June."
    assert updated.intended_major == "Computer Science"
    assert updated.test_plan == "withhold"


async def test_essay_word_count_is_derived_server_side_on_content_patch(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Personal statement", essay_type="Personal statement"),
    )

    updated = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(
            content={
                "type": "doc",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "Why Duke?"}]},
                ],
            }
        ),
    )

    assert updated.word_count == 2


async def test_essay_update_rejects_stale_expected_updated_at(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Personal statement", essay_type="Personal statement"),
    )
    stale_updated_at = essay.updated_at

    # A concurrent write (e.g. the student's own autosave) moves updated_at.
    await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(prompt="Why us?"),
    )

    with pytest.raises(WorkspaceValidationError):
        await update_essay(
            app_pool,
            catalog,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            essay_id=essay.id,
            data=EssayPatch(title="New title", expected_updated_at=stale_updated_at),
        )

    current = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(),
    )
    accepted = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(title="New title", expected_updated_at=current.updated_at),
    )
    assert accepted.title == "New title"


async def test_essay_effective_deadline_coalesces_own_override_and_application_deadline(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog), list_type="Target", round="RD", deadline=date(2027, 1, 10)
        ),
        template=_template(),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            application_id=result.application.id,
            title="Honors college essay",
            essay_type="Scholarship",
        ),
    )

    # No per-essay override yet: effective deadline falls back to the app's.
    unset = await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay.id)
    assert unset.deadline == date(2027, 1, 10)

    # A per-essay override wins over the application deadline.
    overridden = await update_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        essay_id=essay.id,
        data=EssayPatch(deadline=date(2027, 2, 15)),
    )
    assert overridden.deadline == date(2027, 2, 15)


async def test_task_bulk_ops_are_owned_and_logged(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog), list_type="Target", round="RD"),
        template=_template(),
    )
    other_result = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog, 1), list_type="Safety", round="RD"),
        template=_template(),
    )
    # Seeding no longer creates a starter checklist (change 11); create the
    # tasks this test needs directly.
    own_tasks = [
        await create_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=TaskCreate(application_id=result.application.id, title=f"Own task {index}"),
        )
        for index in range(2)
    ]
    other_task_id = (
        await create_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=other_user_id,
            actor="student",
            data=TaskCreate(
                application_id=other_result.application.id, title="Other user's task"
            ),
        )
    ).id

    with pytest.raises(WorkspaceNotFoundError):
        await update_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=other_user_id,
            actor="student",
            task_id=own_tasks[0].id,
            data=TaskPatch(status="done"),
        )
    changed = await bulk_update_status(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        ids=[own_tasks[0].id, other_task_id],
        status="done",
    )
    archived = await bulk_archive(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        ids=[own_tasks[0].id, own_tasks[1].id, other_task_id],
    )

    assert [task.id for task in changed] == [own_tasks[0].id]
    assert set(archived) == {own_tasks[0].id, own_tasks[1].id}
    # user_id: add_application (application.created + essay.created) + 2x
    # task.created + 1x bulk task.updated + 2x bulk task.archived = 7.
    assert await _change_count(app_pool, user_id) == 7
    # other_user_id: add_application (application.created + essay.created)
    # + 1x task.created = 3.
    assert await _change_count(app_pool, other_user_id) == 3
    assert other_result.application.id


async def test_activity_lifecycle_cap_and_ownership(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    first = await create_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ActivityCreate(position="Founder", organization="Robotics"),
    )
    second = await create_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ActivityCreate(position="Tutor"),
    )
    other = await create_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=ActivityCreate(position="Other"),
    )

    with pytest.raises(WorkspaceNotFoundError):
        await update_activity(
            app_pool,
            WorkspaceEventBus(),
            user_id=other_user_id,
            actor="student",
            activity_id=first.id,
            data=ActivityPatch(position="Nope"),
        )

    updated = await update_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        activity_id=first.id,
        data=ActivityPatch(description="Built outreach program"),
    )
    reordered = await reorder_activities(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        ids=[second.id, first.id],
    )
    await archive_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        activity_id=first.id,
    )
    restored = await restore_activity(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        activity_id=first.id,
    )

    assert updated.description == "Built outreach program"
    assert [activity.id for activity in reordered] == [second.id, first.id]
    assert restored.id == first.id
    assert len(await list_activities(app_pool, user_id=user_id)) == 2

    for index in range(8):
        await create_activity(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=ActivityCreate(position=f"Activity {index}"),
        )
    with pytest.raises(WorkspaceValidationError):
        await create_activity(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=ActivityCreate(position="Overflow"),
        )
    with pytest.raises(WorkspaceNotFoundError):
        await restore_activity(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            activity_id=other.id,
        )

    assert await _change_count(app_pool, user_id) == 15


async def test_honor_lifecycle_cap_and_ownership(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    first = await create_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=HonorCreate(title="National Merit"),
    )
    second = await create_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=HonorCreate(title="Science Fair"),
    )
    other = await create_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=HonorCreate(title="Other"),
    )

    with pytest.raises(WorkspaceNotFoundError):
        await archive_honor(
            app_pool,
            WorkspaceEventBus(),
            user_id=other_user_id,
            actor="student",
            honor_id=first.id,
        )

    updated = await update_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        honor_id=first.id,
        data=HonorPatch(levels=["National"]),
    )
    reordered = await reorder_honors(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        ids=[second.id, first.id],
    )
    await archive_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        honor_id=first.id,
    )
    restored = await restore_honor(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        honor_id=first.id,
    )

    assert updated.levels == ["National"]
    assert [honor.id for honor in reordered] == [second.id, first.id]
    assert restored.id == first.id
    assert len(await list_honors(app_pool, user_id=user_id)) == 2

    for index in range(3):
        await create_honor(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=HonorCreate(title=f"Honor {index}"),
        )
    with pytest.raises(WorkspaceValidationError):
        await create_honor(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=HonorCreate(title="Overflow"),
        )
    with pytest.raises(WorkspaceNotFoundError):
        await restore_honor(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            honor_id=other.id,
        )

    assert await _change_count(app_pool, user_id) == 10


async def _assert_activity_create_restore_race(
    app_pool: asyncpg.Pool,
    user_id: UUID,
) -> None:
    event_bus = WorkspaceEventBus()
    for index in range(10):
        await create_activity(
            app_pool,
            event_bus,
            user_id=user_id,
            actor="student",
            data=ActivityCreate(position=f"Activity {index}"),
        )
    archived = (await list_activities(app_pool, user_id=user_id))[-1]
    await archive_activity(
        app_pool, event_bus, user_id=user_id, actor="student", activity_id=archived.id
    )
    results = await asyncio.gather(
        create_activity(
            app_pool,
            event_bus,
            user_id=user_id,
            actor="student",
            data=ActivityCreate(position="Concurrent"),
        ),
        restore_activity(
            app_pool, event_bus, user_id=user_id, actor="student", activity_id=archived.id
        ),
        return_exceptions=True,
    )
    active = await list_activities(app_pool, user_id=user_id)

    assert sum(isinstance(result, WorkspaceValidationError) for result in results) == 1
    assert len(active) == 10
    assert len({row.sort_order for row in active}) == 10


async def test_activity_create_restore_race_stays_within_cap(
    app_pool: asyncpg.Pool, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    await _assert_activity_create_restore_race(app_pool, await make_user())


async def test_list_tasks_status_filter(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    todo = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Todo task", status="todo"),
    )
    doing = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Doing task", status="doing"),
    )
    done = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Done task", status="done"),
    )

    all_active = {task.id for task in await list_tasks(app_pool, user_id=user_id)}
    assert all_active == {todo.id, doing.id, done.id}

    only_done = await list_tasks(app_pool, user_id=user_id, statuses=["done"])
    assert [task.id for task in only_done] == [done.id]

    todo_or_doing = await list_tasks(
        app_pool, user_id=user_id, statuses=["todo", "doing"]
    )
    assert {task.id for task in todo_or_doing} == {todo.id, doing.id}


async def test_list_tasks_application_and_essay_filters(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    app_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog, 0), list_type="Target", round="RD"),
        template=_template(),
    )
    app_b = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(unitid=_unitid(catalog, 1), list_type="Target", round="RD"),
        template=_template(),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(
            application_id=app_a.application.id,
            title="Why us?",
            essay_type="Supplement",
        ),
    )
    task_a = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(application_id=app_a.application.id, title="Task on app A"),
    )
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(application_id=app_b.application.id, title="Task on app B"),
    )
    task_essay = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(essay_id=essay.id, title="Task on essay"),
    )

    by_app = await list_tasks(app_pool, user_id=user_id, application_id=app_a.application.id)
    assert [task.id for task in by_app] == [task_a.id]

    by_essay = await list_tasks(app_pool, user_id=user_id, essay_id=essay.id)
    assert [task.id for task in by_essay] == [task_essay.id]


async def test_list_tasks_completed_after_and_limit_and_ownership(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    before_done = datetime.now(UTC)
    done_task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Finished thing", status="done"),
    )
    after_done = datetime.now(UTC)
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=TaskCreate(title="Other user done thing", status="done"),
    )

    recent = await list_tasks(app_pool, user_id=user_id, completed_after=before_done)
    assert [task.id for task in recent] == [done_task.id]

    stale = await list_tasks(app_pool, user_id=user_id, completed_after=after_done)
    assert stale == []

    other_recent = await list_tasks(
        app_pool, user_id=other_user_id, completed_after=before_done
    )
    assert done_task.id not in {task.id for task in other_recent}

    for index in range(3):
        await create_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=TaskCreate(title=f"Extra task {index}"),
        )
    limited = await list_tasks(app_pool, user_id=user_id, limit=2)
    assert len(limited) == 2


async def test_search_tasks_keyword_and_synonym_match(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    transcript_task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Request transcript from registrar"),
    )
    lor_task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Ask counselor for a letter of recommendation"),
    )

    exact_hits = await search_tasks(app_pool, user_id=user_id, query="transcript")
    assert [hit.id for hit in exact_hits] == [transcript_task.id]

    synonym_hits = await search_tasks(
        app_pool, user_id=user_id, query="LOR OR recommendation"
    )
    assert lor_task.id in {hit.id for hit in synonym_hits}


async def test_search_tasks_trgm_typo_fallback(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Financial aid worksheet"),
    )

    hits = await search_tasks(app_pool, user_id=user_id, query="finnancial")
    assert task.id in {hit.id for hit in hits}


async def test_search_tasks_includes_archived_hits_flagged_and_scoped(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Submit outstanding paperwork"),
    )
    other_task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=TaskCreate(title="Submit outstanding paperwork"),
    )
    await archive_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=task.id,
    )

    hits = await search_tasks(app_pool, user_id=user_id, query="outstanding paperwork")
    matched = [hit for hit in hits if hit.id == task.id]
    assert len(matched) == 1
    assert matched[0].state == "archived"
    assert matched[0].archived_at is not None
    assert other_task.id not in {hit.id for hit in hits}


async def test_search_tasks_empty_query_returns_no_hits(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Anything at all"),
    )

    hits = await search_tasks(app_pool, user_id=user_id, query="zzzznonexistentqueryterm")
    assert hits == []


async def test_search_tasks_active_vs_done_state(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    active = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Interview prep session"),
    )
    done = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Interview prep worksheet", status="done"),
    )

    hits = {
        hit.id: hit.state
        for hit in await search_tasks(app_pool, user_id=user_id, query="interview prep")
    }
    assert hits[active.id] == "active"
    assert hits[done.id] == "done"


async def test_task_board_counts(
    app_pool: asyncpg.Pool,
    make_user: Callable[[], Awaitable[UUID]],
) -> None:
    user_id = await make_user()
    other_user_id = await make_user()
    old_done = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Old done task", status="done"),
    )
    async with app_pool.acquire() as conn:
        await conn.execute(
            "UPDATE counselle.tasks SET completed_at = now() - interval '60 days' WHERE id = $1",
            old_done.id,
        )
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Recent done task", status="done"),
    )
    to_archive = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="To archive"),
    )
    await archive_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        task_id=to_archive.id,
    )
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=other_user_id,
        actor="student",
        data=TaskCreate(title="Other user's done task", status="done"),
    )

    counts = await task_board_counts(app_pool, user_id=user_id, done_within_days=30)
    assert counts.done == 2
    assert counts.done_recent == 1
    assert counts.archived == 1
