"""Live DB gate tests for the Phase 3 agent workspace task tools.

Mirrors the fixture pattern in ``test_workspace_services_live.py`` (each live
test module owns its own ``app_pool``/``catalog``/``make_user`` fixtures —
there is no shared conftest for these in this codebase).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from pydantic import ValidationError

from app.tool_middleware import ToolMiddlewareContext
from app.tool_overflow import ToolResultStore
from app.workspace.agent_tools import TaskDraft, build_workspace_tools
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationCreate,
    EssayCreate,
    TaskCreate,
)
from app.workspace.service_applications import add_application, archive_application
from app.workspace.service_essays import archive_essay, create_essay
from app.workspace.service_tasks import archive_task, create_task
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
                f"{user_id}@workspace-tools.test",
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


def _unitid(catalog: Catalog, offset: int = 0) -> int:
    return sorted(catalog.school_names)[offset]


def _tools(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    user_id: UUID,
    *,
    tool_overflow: ToolMiddlewareContext | None = None,
) -> dict[str, Any]:
    built = build_workspace_tools(app_pool, catalog, WorkspaceEventBus(), user_id, tool_overflow)
    return {tool.name: tool for tool in built}


def test_application_create_rejects_null_cycle_year() -> None:
    with pytest.raises(ValidationError):
        ApplicationCreate(
            unitid=1,
            cycle_year=None,  # type: ignore[arg-type]
            list_type="Target",
            round="RD",
        )


# --------------------------------------------------------------------------
# view_tasks
# --------------------------------------------------------------------------


async def test_view_tasks_default_sort_urgency_then_priority(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    now = datetime.now(UTC)
    soon = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Due soon", priority="low", due_at=now + timedelta(days=1)),
    )
    later = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Due later", priority="high", due_at=now + timedelta(days=5)),
    )
    high_no_due = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="No due high", priority="high"),
    )
    low_no_due = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="No due low", priority="low"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function()

    ids = [row["id"] for row in result["tasks"]]
    assert ids == [str(soon.id), str(later.id), str(high_no_due.id), str(low_no_due.id)]
    assert result["status"] == "ok"
    assert "today" in result


async def test_view_tasks_status_all_includes_done(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    active = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Active one"),
    )
    done = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Done one", status="done"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function(status="all")

    ids = {row["id"] for row in result["tasks"]}
    assert ids == {str(active.id), str(done.id)}
    done_row = next(row for row in result["tasks"] if row["id"] == str(done.id))
    assert "completed" in done_row


async def test_view_tasks_status_done_footer_has_no_tail(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Finished", status="done"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function(status="done")

    assert result["footer"] == "Showing 1 of 1 done tasks."


async def test_view_tasks_application_and_essay_filters(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Why us?", essay_type="Supplement"),
    )
    on_app = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="On app", application_id=result_a.application.id),
    )
    on_essay = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="On essay", essay_id=essay.id),
    )
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Unlinked"),
    )

    tools = _tools(app_pool, catalog, user_id)
    by_app = await tools["view_tasks"].function(application_id=str(result_a.application.id))
    by_essay = await tools["view_tasks"].function(essay_id=str(essay.id))

    assert [row["id"] for row in by_app["tasks"]] == [str(on_app.id)]
    assert by_app["tasks"][0]["app"] == result_a.application.school_name
    assert [row["id"] for row in by_essay["tasks"]] == [str(on_essay.id)]
    assert by_essay["tasks"][0]["essay"] == "Why us?"


async def test_view_tasks_limit_and_overcap_footer(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    for index in range(3):
        await create_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=TaskCreate(title=f"Task {index}"),
        )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function(limit=2)

    assert len(result["tasks"]) == 2
    assert result["footer"] == "Showing 2 of 3 — narrow with application_id, essay_id, or status."


async def test_view_tasks_filtered_empty_not_globally_empty(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Unrelated task"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function(application_id=str(result_a.application.id))

    assert result["tasks"] == []
    assert result["status"] == "ok"
    assert result_a.application.school_name in result["summary"]
    assert "call view_tasks() without filters" in result["footer"]


async def test_view_tasks_empty_board_suggests_starter_tasks(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["view_tasks"].function()

    assert result["tasks"] == []
    assert "create_tasks" in result["footer"]


# --------------------------------------------------------------------------
# search_tasks
# --------------------------------------------------------------------------


async def test_search_tasks_keyword_hit(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Request transcript from registrar"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["search_tasks"].function(query="transcript")

    assert [row["id"] for row in result["tasks"]] == [str(task.id)]
    assert result["tasks"][0]["state"] == "active"


async def test_search_tasks_empty_result_teaching_footer(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Anything"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["search_tasks"].function(query="zzzznonexistentqueryterm")

    assert result["status"] == "ok"
    assert result["tasks"] == []
    assert "synonyms" in result["footer"]


async def test_search_tasks_archived_hit_flagged_with_footer(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Submit outstanding paperwork"),
    )
    await archive_task(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", task_id=task.id
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["search_tasks"].function(query="outstanding paperwork")

    hit = next(row for row in result["tasks"] if row["id"] == str(task.id))
    assert hit["state"] == "archived"
    assert "archived" in hit
    assert result["footer"] == "Archived hits can be restored with restore_task(...)"


# --------------------------------------------------------------------------
# create_tasks
# --------------------------------------------------------------------------


async def test_create_tasks_single_and_batch_with_links_and_ui(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Why us?", essay_type="Supplement"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["create_tasks"].function(
        tasks=[
            TaskDraft(title="Task linked to app", application_id=str(result_a.application.id)),
            TaskDraft(title="Task linked to essay", essay_id=str(essay.id)),
        ]
    )

    assert result["status"] == "ok"
    assert len(result["created"]) == 2
    # process_tool_result's demote_tool_ui moves the raw "ui" payload into
    # public_receipt.ui (app/tool_middleware.py) — the model never sees "ui".
    assert "ui" not in result
    assert result["public_receipt"]["ui"] == {
        "widget": "task_added",
        "data": {"title": "2 tasks", "count": 2},
    }
    assert result["footer"] == "The student sees these on their board now."


async def test_create_tasks_single_ui_uses_title(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    result = await tools["create_tasks"].function(tasks=[TaskDraft(title="Solo task")])

    assert result["public_receipt"]["ui"]["data"] == {"title": "Solo task", "count": 1}


async def test_create_tasks_invalid_application_link_ships_link_targets(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)
    bogus_id = str(uuid4())

    result = await tools["create_tasks"].function(
        tasks=[TaskDraft(title="Bad link", application_id=bogus_id)]
    )

    assert result["status"] == "error"
    assert result["retryable"] is True
    assert (
        f'tasks[0]: application_id "{bogus_id}" does not match any active application '
        "in this student's workspace. Nothing was created." == result["error"]
    )
    assert "link_targets" in result


async def test_create_tasks_near_duplicate_blocked_and_force_overrides(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    existing = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Request transcript from registrar", status="doing"),
    )

    tools = _tools(app_pool, catalog, user_id)
    blocked = await tools["create_tasks"].function(
        tasks=[TaskDraft(title="Request transcript from registrar")]
    )

    assert blocked["status"] == "error"
    assert blocked["retryable"] is True
    assert str(existing.id) in blocked["error"]
    assert "status doing" in blocked["error"]
    assert "Nothing was created." in blocked["error"]

    forced = await tools["create_tasks"].function(
        tasks=[TaskDraft(title="Request transcript from registrar")], force=True
    )
    assert forced["status"] == "warning"
    assert len(forced["created"]) == 1
    assert forced["warnings"]


async def test_create_tasks_unparseable_date(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    result = await tools["create_tasks"].function(
        tasks=[TaskDraft(title="Bad date", due="July 15")]
    )

    assert result["status"] == "error"
    assert result["error"] == 'tasks[0]: due "July 15" is not a valid date.'
    assert result["retryable"] is True


async def test_create_tasks_batch_caps(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    empty = await tools["create_tasks"].function(tasks=[])
    assert empty["status"] == "error"
    assert "1-20 items" in empty["error"]

    too_many = await tools["create_tasks"].function(
        tasks=[TaskDraft(title=f"Task {i}") for i in range(21)]
    )
    assert too_many["status"] == "error"
    assert "got 21" in too_many["error"]

    exactly_twenty = await tools["create_tasks"].function(
        tasks=[TaskDraft(title=f"Cap task {i}") for i in range(20)]
    )
    assert exactly_twenty["status"] == "ok"
    assert len(exactly_twenty["created"]) == 20


# --------------------------------------------------------------------------
# update_task
# --------------------------------------------------------------------------


async def test_update_task_partial_patch_and_summary(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Original title", priority="low"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["update_task"].function(
        task_id=str(task.id), status="doing", due="2026-07-15"
    )

    assert result["status"] == "ok"
    assert result["task"]["status"] == "doing"
    assert result["task"]["due"] == "2026-07-15"
    assert result["task"]["title"] == "Original title"
    assert result["task"]["priority"] == "low"
    assert 'Updated "Original title"' in result["summary"]
    assert "status → doing" in result["summary"]
    assert "due → 2026-07-15" in result["summary"]


async def test_update_task_clear_sentinel_on_every_clearable_field(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    essay = await create_essay(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=EssayCreate(title="Why us?", essay_type="Supplement"),
    )
    now = datetime.now(UTC)
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(
            title="Fully linked task",
            notes="Some notes",
            due_at=now,
            planned_for=now,
            reminder_at=now,
            application_id=result_a.application.id,
            essay_id=essay.id,
        ),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["update_task"].function(
        task_id=str(task.id),
        notes="clear",
        due="clear",
        planned_for="clear",
        reminder="clear",
        application_id="clear",
        essay_id="clear",
    )

    assert result["status"] == "ok"
    row = result["task"]
    for key in ("notes", "due", "planned", "reminder", "app", "essay"):
        assert key not in row
    for phrase in ("notes → cleared", "due → cleared", "planned → cleared", "reminder → cleared"):
        assert phrase in result["summary"]


async def test_update_task_stale_task_id_matches_a7_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)
    bogus_id = str(uuid4())

    result = await tools["update_task"].function(task_id=bogus_id, status="doing")

    assert result["status"] == "error"
    assert result["retryable"] is False
    assert (
        result["error"]
        == f'No active task with id "{bogus_id}". It may have been archived, completed and '
        "pruned from your view, or the id may be stale."
    )
    assert "Do not retry this same id." in result["recovery"]


async def test_update_task_invalid_uuid_string_hits_curated_error_not_crash(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    result = await tools["update_task"].function(task_id="not-a-uuid", status="doing")

    assert result["status"] == "error"
    assert 'No active task with id "not-a-uuid"' in result["error"]


async def test_update_task_archived_task_hits_stale_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="To archive"),
    )
    await archive_task(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", task_id=task.id
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["update_task"].function(task_id=str(task.id), status="doing")

    assert result["status"] == "error"
    assert f'No active task with id "{task.id}"' in result["error"]


async def test_update_task_foreign_task_id_never_reveals_existence(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    owner_id = await make_user()
    stranger_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=owner_id,
        actor="student",
        data=TaskCreate(title="Owned by someone else"),
    )

    tools = _tools(app_pool, catalog, stranger_id)
    result = await tools["update_task"].function(task_id=str(task.id), status="doing")

    assert result["status"] == "error"
    assert f'No active task with id "{task.id}"' in result["error"]


async def test_update_task_invalid_link_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Needs a link"),
    )
    bogus_id = str(uuid4())

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["update_task"].function(task_id=str(task.id), application_id=bogus_id)

    assert result["status"] == "error"
    assert "Nothing was changed." in result["error"]
    assert bogus_id in result["error"]


async def test_update_task_unparseable_date(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Needs a date"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["update_task"].function(task_id=str(task.id), due="not-a-date")

    assert result["status"] == "error"
    assert result["error"] == 'due "not-a-date" is not a valid date.'


# --------------------------------------------------------------------------
# archive_tasks
# --------------------------------------------------------------------------


async def test_archive_tasks_full_success(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    first = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="First"),
    )
    second = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Second"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["archive_tasks"].function(task_ids=[str(first.id), str(second.id)])

    assert result["status"] == "ok"
    assert {row["id"] for row in result["archived"]} == {str(first.id), str(second.id)}
    assert "skipped" not in result
    assert result["footer"] == "restore_task(task_id=...) undoes any of these."


async def test_archive_tasks_partial_success_reports_skipped(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    valid = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Valid"),
    )
    bogus_id = str(uuid4())

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["archive_tasks"].function(task_ids=[str(valid.id), bogus_id])

    assert result["status"] == "warning"
    assert [row["id"] for row in result["archived"]] == [str(valid.id)]
    assert result["skipped"] == [{"id": bogus_id, "reason": "not found or already archived"}]


async def test_archive_tasks_all_skipped_single_id_uses_a7_stale_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)
    bogus_id = str(uuid4())

    result = await tools["archive_tasks"].function(task_ids=[bogus_id])

    assert result["status"] == "error"
    assert f'No active task with id "{bogus_id}"' in result["error"]


async def test_archive_tasks_all_skipped_multi_id_error(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    result = await tools["archive_tasks"].function(task_ids=[str(uuid4()), str(uuid4())])

    assert result["status"] == "error"
    assert result["retryable"] is False
    assert "No active tasks found among the given ids." in result["error"]
    assert "Do not retry this same id." in result["recovery"]


async def test_archive_tasks_batch_caps(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    empty = await tools["archive_tasks"].function(task_ids=[])
    assert empty["status"] == "error"
    assert "1-20 items" in empty["error"]

    too_many = await tools["archive_tasks"].function(task_ids=[str(uuid4()) for _ in range(21)])
    assert too_many["status"] == "error"
    assert "got 21" in too_many["error"]


# --------------------------------------------------------------------------
# restore_task
# --------------------------------------------------------------------------


async def test_restore_task_success(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Bring me back"),
    )
    await archive_task(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", task_id=task.id
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["restore_task"].function(task_id=str(task.id))

    assert result["status"] == "ok"
    assert result["summary"] == 'Restored "Bring me back" to the active board.'
    assert result["task"]["id"] == str(task.id)
    assert result["task"]["status"] == "todo"


async def test_restore_task_blocked_by_archived_application(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    result_a = await add_application(
        app_pool,
        catalog,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=ApplicationCreate(
            unitid=_unitid(catalog, 0), cycle_year=2027, list_type="Target", round="RD"
        ),
    )
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Linked to app", application_id=result_a.application.id),
    )
    await archive_application(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        application_id=result_a.application.id,
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["restore_task"].function(task_id=str(task.id))

    assert result["status"] == "error"
    assert result["retryable"] is False
    assert (
        f'"Linked to app" can\'t be restored on its own — its linked application '
        f"({result_a.application.school_name}) is archived." == result["error"]
    )
    assert "Restore the application first" in result["recovery"]


async def test_restore_task_blocked_by_archived_essay(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
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
        data=TaskCreate(title="Linked to essay", essay_id=essay.id),
    )
    await archive_task(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", task_id=task.id
    )
    await archive_essay(
        app_pool, WorkspaceEventBus(), user_id=user_id, actor="student", essay_id=essay.id
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["restore_task"].function(task_id=str(task.id))

    assert result["status"] == "error"
    assert (
        result["error"]
        == '"Linked to essay" can\'t be restored on its own — its linked essay '
        "(Personal statement) is archived."
    )


async def test_restore_task_of_non_archived_task_errors(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Still active"),
    )

    tools = _tools(app_pool, catalog, user_id)
    result = await tools["restore_task"].function(task_id=str(task.id))

    assert result["status"] == "error"
    assert result["error"] == "That task is not archived — it is already on the active board."
    assert result["retryable"] is False


async def test_restore_task_invalid_uuid_hits_stale_error_not_crash(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    tools = _tools(app_pool, catalog, user_id)

    result = await tools["restore_task"].function(task_id="not-a-uuid")

    assert result["status"] == "error"
    assert 'No active task with id "not-a-uuid"' in result["error"]


async def test_restore_task_foreign_task_id_never_reveals_existence(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    owner_id = await make_user()
    stranger_id = await make_user()
    task = await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=owner_id,
        actor="student",
        data=TaskCreate(title="Not yours"),
    )
    await archive_task(
        app_pool, WorkspaceEventBus(), user_id=owner_id, actor="student", task_id=task.id
    )

    tools = _tools(app_pool, catalog, stranger_id)
    result = await tools["restore_task"].function(task_id=str(task.id))

    assert result["status"] == "error"
    assert f'No active task with id "{task.id}"' in result["error"]


# --------------------------------------------------------------------------
# Overflow routing
# --------------------------------------------------------------------------


async def test_view_tasks_result_spills_through_overflow_when_oversized(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    for index in range(25):
        await create_task(
            app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=TaskCreate(
                title=f"Task number {index} with a fairly long descriptive title indeed",
                notes="x" * 100,
            ),
        )

    store = ToolResultStore()
    overflow_ctx = ToolMiddlewareContext(overflow_store=store, max_result_chars=200)
    tools = _tools(app_pool, catalog, user_id, tool_overflow=overflow_ctx)

    result = await tools["view_tasks"].function()

    assert result["status"] == "overflow"
    handle = result["result_for_agent"]["handle"]
    full = store.read(handle)
    assert len(full["tasks"]) > 0


async def test_view_tasks_result_not_spilled_when_no_overflow_context(
    app_pool: asyncpg.Pool, catalog: Catalog, make_user: Callable[[], Awaitable[UUID]]
) -> None:
    user_id = await make_user()
    await create_task(
        app_pool,
        WorkspaceEventBus(),
        user_id=user_id,
        actor="student",
        data=TaskCreate(title="Small"),
    )

    tools = _tools(app_pool, catalog, user_id, tool_overflow=None)
    result = await tools["view_tasks"].function()

    assert result["status"] == "ok"
