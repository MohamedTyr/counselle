"""Hermetic coverage for the activities/honors workspace service.

The fakes model only the asyncpg boundary.  Assertions focus on ownership,
capacity/duplicate guards, transaction use, model conversion, and the
post-commit event contract.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.workspace import service_activities as service
from app.workspace.changes import WorkspaceEventBus, make_change_event
from app.workspace.models import (
    ActivityCreate,
    ActivityDuplicateError,
    ActivityPatch,
    HonorCreate,
    HonorDuplicateError,
    HonorPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)


class _AsyncContext:
    def __init__(self, conn: _Conn | None = None) -> None:
        self.conn = conn
        self.entered = False

    async def __aenter__(self) -> _AsyncContext | _Conn:
        self.entered = True
        return self.conn if self.conn is not None else self

    async def __aexit__(self, *_: object) -> None:
        return None


class _Conn:
    def __init__(
        self,
        *,
        rows: list[dict[str, Any]] | None = None,
        row: dict[str, Any] | None = None,
        values: list[Any] | None = None,
    ) -> None:
        self.rows = rows or []
        self.row = row
        self.values = list(values or [])
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.transaction_contexts: list[_AsyncContext] = []

    def transaction(self) -> _AsyncContext:
        context = _AsyncContext()
        self.transaction_contexts.append(context)
        return context

    async def fetch(self, sql: str, *args: object) -> list[dict[str, Any]]:
        self.calls.append((sql, args))
        return self.rows

    async def fetchrow(self, sql: str, *args: object) -> dict[str, Any] | None:
        self.calls.append((sql, args))
        return self.row

    async def fetchval(self, sql: str, *args: object) -> Any:
        self.calls.append((sql, args))
        if self.values:
            return self.values.pop(0)
        return 1

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
        self.acquire_count = 0

    def acquire(self) -> _Acquire:
        self.acquire_count += 1
        return _Acquire(self.conn)


_USER = uuid4()
_OTHER = uuid4()
_ACTIVITY_ID = uuid4()
_HONOR_ID = uuid4()
_NOW = datetime(2027, 1, 1, tzinfo=UTC)


def _activity_row(**changes: object) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": _ACTIVITY_ID,
        "user_id": _USER,
        "sort_order": 2,
        "activity_type": "Work",
        "position_label": "Mentor",
        "organization": "Club",
        "description": "Helped students",
        "grades": ["11"],
        "timing": ["school_year"],
        "hours_per_week": 4.0,
        "weeks_per_year": 30.0,
        "continue_in_college": True,
        "story": "A story",
        "created_at": _NOW,
        "updated_at": _NOW,
        "archived_at": None,
    }
    row.update(changes)
    return row


def _honor_row(**changes: object) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": _HONOR_ID,
        "user_id": _USER,
        "sort_order": 1,
        "title": "Honor Society",
        "grades": ["12"],
        "levels": ["School"],
        "created_at": _NOW,
        "updated_at": _NOW,
        "archived_at": None,
    }
    row.update(changes)
    return row


def _event(object_type: str, object_id: UUID, op: str) -> Any:
    return make_change_event(
        change_id=9,
        actor="student",
        object_type=object_type,  # type: ignore[arg-type]
        object_id=object_id,
        op=op,  # type: ignore[arg-type]
    )


async def test_list_activities_and_honors_validate_rows() -> None:
    activity_conn = _Conn(rows=[_activity_row()])
    honor_conn = _Conn(rows=[_honor_row()])
    assert (await service.list_activities(_Pool(activity_conn), user_id=_USER))[
        0
    ].position == "Mentor"
    assert (await service.list_honors(_Pool(honor_conn), user_id=_USER))[0].title == "Honor Society"
    assert "archived_at IS NULL" in activity_conn.calls[0][0]
    assert "ORDER BY sort_order, created_at" in honor_conn.calls[0][0]


async def test_create_activity_batch_locks_checks_capacity_maps_rows_and_publishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _activity_row(id=uuid4(), sort_order=4)
    second = _activity_row(id=uuid4(), sort_order=5)
    conn = _Conn(rows=[], row=first, values=[2, 7])
    inserted = iter([first, second])

    async def fetchrow(sql: str, *args: object) -> dict[str, Any] | None:
        conn.calls.append((sql, args))
        return next(inserted) if "INSERT" in sql else conn.row

    conn.fetchrow = fetchrow  # type: ignore[method-assign]

    async def record_created(*_args: object, **_kwargs: object) -> Any:
        return _event("activity", first["id"], "created")

    monkeypatch.setattr(service, "_record_change", record_created)
    bus = WorkspaceEventBus()
    data = [
        ActivityCreate(position="Mentor", organization="Club"),
        ActivityCreate(position="Tutor"),
    ]
    async with bus.subscribe(_USER) as queue:
        result = await service.create_activities(
            _Pool(conn), bus, user_id=_USER, actor="student", data=data
        )
        events = [await queue.get(), await queue.get()]
    assert [item.id for item in result] == [first["id"], second["id"]]
    assert [event.type for event in events] == ["activity.created", "activity.created"]
    assert any("pg_advisory_xact_lock" in sql for sql, _ in conn.calls)
    insert_args = [args for sql, args in conn.calls if "INSERT" in sql]
    assert insert_args[0][1] == 7 and insert_args[1][1] == 8


async def test_empty_batches_are_noops() -> None:
    class _ExplodingPool:
        def acquire(self) -> None:
            raise AssertionError("empty batch acquired a connection")

    pool = _ExplodingPool()
    assert (
        await service.create_activities(
            pool, WorkspaceEventBus(), user_id=_USER, actor="student", data=[]
        )
        == []
    )
    assert (
        await service.create_honors_batch(
            pool, WorkspaceEventBus(), user_id=_USER, actor="student", data=[]
        )
        == []
    )


async def test_activity_duplicate_guard_checks_active_and_batch_pairs() -> None:
    active = _activity_row(position_label="Leader", organization="Chess")
    conn = _Conn(rows=[active])
    data = [ActivityCreate(position=" leader ", organization="CHESS")]
    with pytest.raises(ActivityDuplicateError) as error:
        await service.create_activities(
            _Pool(conn),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            data=data,
            reject_duplicate_pairs=True,
        )
    assert error.value.duplicate_index == 0 and error.value.active_activity_id == _ACTIVITY_ID

    conn = _Conn(values=[0, 0])
    duplicate_data = [
        ActivityCreate(position="x", organization="y"),
        ActivityCreate(position=" X ", organization="Y"),
    ]
    with pytest.raises(ActivityDuplicateError) as error:
        await service.create_activities(
            _Pool(conn), WorkspaceEventBus(), user_id=_USER, actor="student", data=duplicate_data
        )
    assert error.value.earlier_batch_index == 0


async def test_capacity_and_honor_duplicate_guards_fail_before_insert() -> None:
    with pytest.raises(WorkspaceValidationError, match="active activities cap"):
        await service.create_activities(
            _Pool(_Conn(values=[service.ACTIVITY_CAP, 0])),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            data=[ActivityCreate()],
        )
    with pytest.raises(WorkspaceValidationError, match="active honors cap"):
        await service.create_honor(
            _Pool(_Conn(values=[service.HONOR_CAP])),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            data=HonorCreate(title="Prize"),
        )

    conn = _Conn(rows=[_honor_row(title="Prize")])
    with pytest.raises(HonorDuplicateError):
        await service.create_honors_batch(
            _Pool(conn),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            data=[HonorCreate(title=" prize ")],
            reject_duplicate_pairs=True,
        )


@pytest.mark.parametrize("kind", ["activity", "honor"])
async def test_update_returns_before_and_after_and_only_publishes_real_patch(
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    before = _activity_row() if kind == "activity" else _honor_row()
    after = dict(before)
    after["position_label" if kind == "activity" else "title"] = "Changed"
    conn = _Conn(row=after)

    async def fetchrow(sql: str, *args: object) -> dict[str, Any] | None:
        conn.calls.append((sql, args))
        return before if "SELECT *" in sql else after

    conn.fetchrow = fetchrow  # type: ignore[method-assign]

    async def record_updated(*_args: object, **_kwargs: object) -> Any:
        return _event(kind, before["id"], "updated")

    monkeypatch.setattr(service, "_record_change", record_updated)
    bus = WorkspaceEventBus()
    result: Any
    prior: Any
    async with bus.subscribe(_USER) as queue:
        if kind == "activity":
            result, prior = await service.update_activity(
                _Pool(conn),
                bus,
                user_id=_USER,
                actor="student",
                activity_id=_ACTIVITY_ID,
                data=ActivityPatch(position="Changed"),
            )
        else:
            result, prior = await service.update_honor(
                _Pool(conn),
                bus,
                user_id=_USER,
                actor="student",
                honor_id=_HONOR_ID,
                data=HonorPatch(title="Changed"),
            )
        event = await queue.get()
    assert result.id == prior.id and event.type == f"{kind}.updated"
    assert result != prior
    assert "RETURNING *" in conn.calls[-1][0]


async def test_update_missing_row_is_not_found() -> None:
    with pytest.raises(WorkspaceNotFoundError):
        await service.update_activity(
            _Pool(_Conn(row=None)),
            WorkspaceEventBus(),
            user_id=_USER,
            actor="student",
            activity_id=_ACTIVITY_ID,
            data=ActivityPatch(position="x"),
        )


@pytest.mark.parametrize("kind", ["activity", "honor"])
async def test_archive_restore_publish_and_restore_capacity_is_enforced(
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    row = _activity_row() if kind == "activity" else _honor_row()
    conn = _Conn(row=row, values=[0, 0, 3])

    async def record_changed(*args: object, **_kwargs: object) -> Any:
        return _event(kind, row["id"], str(args[-1]))

    monkeypatch.setattr(service, "_record_change", record_changed)
    bus = WorkspaceEventBus()
    restored: Any
    async with bus.subscribe(_USER) as queue:
        if kind == "activity":
            await service.archive_activity(
                _Pool(conn), bus, user_id=_USER, actor="student", activity_id=_ACTIVITY_ID
            )
            restored = await service.restore_activity(
                _Pool(conn), bus, user_id=_USER, actor="student", activity_id=_ACTIVITY_ID
            )
        else:
            await service.archive_honor(
                _Pool(conn), bus, user_id=_USER, actor="student", honor_id=_HONOR_ID
            )
            restored = await service.restore_honor(
                _Pool(conn), bus, user_id=_USER, actor="student", honor_id=_HONOR_ID
            )
        events = [await queue.get(), await queue.get()]
    assert restored.id == row["id"]
    assert [event.type for event in events] == [f"{kind}.archived", f"{kind}.restored"]
    assert any("archived_at = now()" in sql for sql, _ in conn.calls)


async def test_archive_missing_and_restore_missing_rows_are_not_found() -> None:
    for operation in (service.archive_activity, service.restore_activity):
        with pytest.raises(WorkspaceNotFoundError):
            await operation(
                _Pool(_Conn(row=None, values=[0, 0])),
                WorkspaceEventBus(),
                user_id=_USER,
                actor="student",
                activity_id=_ACTIVITY_ID,
            )


async def test_reorder_validates_set_returns_old_ranks_and_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ids = [uuid4(), uuid4()]
    rows = [{"id": ids[0], "sort_order": 4}, {"id": ids[1], "sort_order": 1}]
    updated = iter([_activity_row(id=ids[1], sort_order=0), _activity_row(id=ids[0], sort_order=1)])
    conn = _Conn(rows=rows)

    async def fetchrow(sql: str, *args: object) -> dict[str, Any] | None:
        return _next_row(conn, updated, sql, args)

    conn.fetchrow = fetchrow  # type: ignore[method-assign]

    async def record_reordered(*args: object, **_kwargs: object) -> Any:
        return _event("activity", args[4], "updated")  # type: ignore[arg-type]

    monkeypatch.setattr(service, "_record_change", record_reordered)
    result, old_ranks = await service.reorder_activities(
        _Pool(conn),
        WorkspaceEventBus(),
        user_id=_USER,
        actor="student",
        ids=ids,
        with_old_ranks=True,
    )
    assert [activity.sort_order for activity in result] == [0, 1]
    assert old_ranks == {ids[1]: 1, ids[0]: 2}

    with pytest.raises(WorkspaceValidationError, match="unique"):
        await service.reorder_activities(
            _Pool(conn), WorkspaceEventBus(), user_id=_USER, actor="student", ids=[ids[0], ids[0]]
        )


def _next_row(conn: _Conn, rows: Any, sql: str, args: tuple[object, ...]) -> dict[str, Any] | None:
    conn.calls.append((sql, args))
    return next(rows) if "UPDATE" in sql else conn.row
