"""Hermetic contract coverage for the task workspace service.

These tests deliberately fake the asyncpg boundary: service behavior (filters,
ownership validation, transaction seams, and post-commit events) is what is
under test, not PostgreSQL's query engine.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.workspace import service_tasks
from app.workspace.changes import WorkspaceEventBus, make_change_event
from app.workspace.models import (
    TaskCreate,
    TaskPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)


class _AsyncContext:
    async def __aenter__(self) -> _AsyncContext:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


class _Conn:
    def __init__(
        self, *, rows: list[dict[str, Any]] | None = None, row: dict[str, Any] | None = None
    ) -> None:
        self.rows = rows or []
        self.row = row
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def transaction(self) -> _AsyncContext:
        return _AsyncContext()

    async def fetch(self, sql: str, *args: object) -> list[dict[str, Any]]:
        self.calls.append((sql, args))
        return self.rows

    async def fetchrow(self, sql: str, *args: object) -> dict[str, Any] | None:
        self.calls.append((sql, args))
        return self.row

    async def fetchval(self, _sql: str, *_args: object) -> int:
        return 7

    async def execute(self, sql: str, *args: object) -> str:
        self.calls.append((sql, args))
        return "SELECT 1"


class _Acquire:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn

    async def __aenter__(self) -> _Conn:
        return self.conn

    async def __aexit__(self, *_: object) -> None:
        return None


class _Pool:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn

    def acquire(self) -> _Acquire:
        return _Acquire(self.conn)


_USER = uuid4()
_TASK_ID = uuid4()
_APP_ID = uuid4()
_ESSAY_ID = uuid4()
_NOW = datetime(2027, 1, 1, tzinfo=UTC)


def _task_row(**changes: object) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": _TASK_ID,
        "user_id": _USER,
        "application_id": None,
        "essay_id": None,
        "requirement_kind": None,
        "title": "Submit form",
        "notes": None,
        "status": "todo",
        "category": "form",
        "priority": "med",
        "assignee": "student",
        "needs_input": False,
        "due_at": None,
        "planned_for": None,
        "reminder_at": None,
        "completed_at": None,
        "archived_via_application": None,
        "created_at": _NOW,
        "updated_at": _NOW,
        "archived_at": None,
        "when_on": None,
        "deadline_on": None,
        "done_at": None,
        "flagged": False,
        "created_by_actor": "student",
        "last_actor": "student",
        "sort_order": None,
    }
    row.update(changes)
    return row


def _event(task_id: UUID = _TASK_ID, *, op: str = "updated") -> Any:
    return make_change_event(
        change_id=1,
        actor="student",
        object_type="task",
        object_id=task_id,
        op=op,  # type: ignore[arg-type]
    )


async def test_list_tasks_builds_all_optional_filters_and_validates_rows() -> None:
    conn = _Conn(rows=[_task_row()])
    result = await service_tasks.list_tasks(
        _Pool(conn),
        user_id=_USER,
        statuses=["todo", "done"],
        application_id=_APP_ID,
        essay_id=_ESSAY_ID,
        completed_after=_NOW,
        done=False,
        limit=3,
    )

    assert result[0].id == _TASK_ID
    sql, args = conn.calls[0]
    assert "archived_at IS NULL" in sql
    assert "status = ANY($2::text[])" in sql
    assert "done_at IS NULL" in sql
    assert "application_id = $3" in sql and "essay_id = $4" in sql
    assert "completed_at >= $5" in sql and "LIMIT $6" in sql
    assert args == (_USER, ["todo", "done"], _APP_ID, _ESSAY_ID, _NOW, 3)


@pytest.mark.parametrize("done, fragment", [(True, "done_at IS NOT NULL"), (None, "")])
async def test_list_tasks_handles_done_filter_variants(done: bool | None, fragment: str) -> None:
    conn = _Conn(rows=[])
    assert await service_tasks.list_tasks(_Pool(conn), user_id=_USER, done=done) == []
    assert fragment in conn.calls[0][0]


async def test_search_tasks_uses_trigram_only_after_empty_fts() -> None:
    conn = _Conn(rows=[])

    async def fetch(sql: str, *args: object) -> list[dict[str, Any]]:
        conn.calls.append((sql, args))
        return (
            []
            if "ts_headline" in sql
            else [
                {
                    "id": _TASK_ID,
                    "title": "Essay",
                    "status": "done",
                    "category": "essay",
                    "match": None,
                    "archived_at": _NOW,
                }
            ]
        )

    conn.fetch = fetch  # type: ignore[method-assign]
    result = await service_tasks.search_tasks(_Pool(conn), user_id=_USER, query="esay", limit=4)
    assert result[0].state == "archived"
    assert len(conn.calls) == 2
    assert "similarity(title" in conn.calls[1][0]


@pytest.mark.parametrize(
    ("archived_at", "status", "expected"),
    [(None, "todo", "active"), (None, "done", "done"), (_NOW, "todo", "archived")],
)
def test_search_hit_state_prioritizes_archived_then_done(
    archived_at: datetime | None, status: str, expected: str
) -> None:
    hit = service_tasks._search_hit_from_row(
        {
            "id": _TASK_ID,
            "title": "Task",
            "status": status,
            "category": "other",
            "match": "<b>Task</b>",
            "archived_at": archived_at,
        }
    )
    assert hit.state == expected


async def test_task_board_counts_passes_window_and_returns_counts() -> None:
    conn = _Conn(row={"done": 2, "done_recent": 1, "archived": 3})
    result = await service_tasks.task_board_counts(_Pool(conn), user_id=_USER, done_within_days=14)
    assert result.model_dump() == {"done": 2, "done_recent": 1, "archived": 3}
    assert conn.calls[0][1] == (_USER, 14)


async def test_create_task_runs_validation_and_publishes_after_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Conn(row=_task_row(application_id=_APP_ID))
    validated: list[tuple[object, ...]] = []

    async def validate(*args: object) -> None:
        validated.append(args)

    async def record(*_args: object) -> Any:
        return _event(op="created")

    monkeypatch.setattr(service_tasks, "_validate_links", validate)
    monkeypatch.setattr(service_tasks, "_record_task_change", record)
    bus = WorkspaceEventBus()
    data = TaskCreate(title="Apply", application_id=_APP_ID)

    async with bus.subscribe(_USER) as queue:
        task = await service_tasks.create_task(
            _Pool(conn), bus, user_id=_USER, actor="student", data=data
        )
        published = await queue.get()
    assert task.application_id == _APP_ID
    assert validated and validated[0][1:] == (_USER, _APP_ID, None, None)
    assert published.type == "task.created"


async def test_empty_batch_is_noop_without_acquiring_connection() -> None:
    class _ExplodingPool:
        def acquire(self) -> None:
            raise AssertionError("empty batch must not acquire")

    assert (
        await service_tasks.create_tasks_batch(
            _ExplodingPool(), WorkspaceEventBus(), user_id=_USER, actor="student", data=[]
        )
        == []
    )


async def test_bulk_archive_empty_is_noop() -> None:
    class _ExplodingPool:
        def acquire(self) -> None:
            raise AssertionError("empty archive must not acquire")

    assert (
        await service_tasks.bulk_archive(
            _ExplodingPool(), WorkspaceEventBus(), user_id=_USER, actor="student", ids=[]
        )
        == []
    )


async def test_reorder_rejects_duplicate_ids_before_transaction() -> None:
    with pytest.raises(WorkspaceValidationError, match="unique"):
        await service_tasks.reorder_tasks(
            object(), WorkspaceEventBus(), user_id=_USER, actor="student", ids=[_TASK_ID, _TASK_ID]
        )


async def test_reorder_updates_subset_and_returns_full_active_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    updated = _task_row(sort_order=0)
    conn = _Conn(rows=[_task_row(), _task_row(id=uuid4(), title="Other")], row=updated)

    async def record(*_args: object) -> Any:
        return _event()

    monkeypatch.setattr(service_tasks, "_record_task_change", record)
    result = await service_tasks.reorder_tasks(
        _Pool(conn), WorkspaceEventBus(), user_id=_USER, actor="counselle", ids=[_TASK_ID]
    )
    assert len(result) == 2
    assert "pg_advisory_xact_lock" in conn.calls[0][0]


async def test_validate_links_rejects_requirement_without_application() -> None:
    with pytest.raises(WorkspaceValidationError, match="requires application"):
        await service_tasks._validate_links(_Conn(), _USER, None, None, "fee")


async def test_validate_links_rejects_mismatched_essay_application(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Conn()

    async def require_application(*_args: object) -> None:
        return None

    async def require_essay(*_args: object) -> UUID:
        return _APP_ID

    monkeypatch.setattr(service_tasks, "_require_active_application", require_application)
    monkeypatch.setattr(service_tasks, "_require_active_essay", require_essay)
    with pytest.raises(WorkspaceValidationError, match="match"):
        await service_tasks._validate_links(conn, _USER, uuid4(), _ESSAY_ID, None)


async def test_update_task_returns_before_and_after_and_records_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _task_row(title="Before")
    after = _task_row(title="After")
    conn = _Conn()
    calls = iter([before, before])

    async def require_task(*_args: object, **_kwargs: object) -> dict[str, Any]:
        return next(calls)

    async def validate_patch(*_args: object) -> None:
        return None

    async def update_row(*_args: object, **_kwargs: object) -> dict[str, Any]:
        return after

    async def record(*_args: object) -> Any:
        return _event()

    monkeypatch.setattr(service_tasks, "_require_task", require_task)
    monkeypatch.setattr(service_tasks, "_validate_patch_links", validate_patch)
    monkeypatch.setattr(service_tasks, "_update_task_row", update_row)
    monkeypatch.setattr(service_tasks, "_record_task_change", record)
    result, snapshot = await service_tasks.update_task(
        _Pool(conn),
        WorkspaceEventBus(),
        user_id=_USER,
        actor="student",
        task_id=_TASK_ID,
        data=TaskPatch(title="After"),
    )
    assert result.title == "After"
    assert snapshot.title == "Before"


async def test_update_task_detects_concurrent_link_change(monkeypatch: pytest.MonkeyPatch) -> None:
    first = _task_row(application_id=None)
    second = _task_row(application_id=_APP_ID)
    calls = iter([first, second])

    async def require_task(*_args: object, **_kwargs: object) -> dict[str, Any]:
        return next(calls)

    async def validate_patch(*_args: object) -> None:
        return None

    monkeypatch.setattr(service_tasks, "_require_task", require_task)
    monkeypatch.setattr(service_tasks, "_validate_patch_links", validate_patch)
    with pytest.raises(WorkspaceValidationError, match="changed concurrently"):
        await service_tasks.update_task(
            _Pool(_Conn()),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            task_id=_TASK_ID,
            data=TaskPatch(title="x"),
        )


async def test_require_helpers_raise_not_found_and_update_row_does_too() -> None:
    with pytest.raises(WorkspaceNotFoundError):
        await service_tasks._require_task(_Conn(), _USER, _TASK_ID, for_update=False)
    with pytest.raises(WorkspaceNotFoundError):
        await service_tasks._require_active_application(_Conn(), _USER, _APP_ID)
    with pytest.raises(WorkspaceNotFoundError):
        await service_tasks._require_active_essay(_Conn(), _USER, _ESSAY_ID)
    with pytest.raises(WorkspaceNotFoundError):
        await service_tasks._require_restorable_task(_Conn(), _USER, _TASK_ID)
    with pytest.raises(WorkspaceNotFoundError):
        await service_tasks._update_task_row(_Conn(), _USER, _TASK_ID, {}, actor="student")
