"""Hermetic contract coverage for school-list mutation agent tools."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.workspace import agent_tools_schools_mutations as mutations
from app.workspace.agent_tools_schools_mutations import SchoolDraft
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationView,
    Rollup,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)


class _Acquire:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection

    async def __aenter__(self) -> _Connection:
        return self.connection

    async def __aexit__(self, *_args: object) -> None:
        return None


class _Connection:
    def __init__(self, rows: list[dict[str, Any]] | None = None, probe: Any = None) -> None:
        self.rows = rows or []
        self.probe = probe
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        self.calls.append((query, args))
        return self.rows

    async def fetchrow(self, query: str, *args: Any) -> Any:
        self.calls.append((query, args))
        return self.probe


class _Pool:
    def __init__(self, connection: _Connection | None = None) -> None:
        self.connection = connection or _Connection()

    def acquire(self) -> _Acquire:
        return _Acquire(self.connection)


class _Catalog:
    def __init__(self, names: dict[int, str] | None = None) -> None:
        self.names = names or {}

    def school_name(self, unitid: int) -> str | None:
        return self.names.get(unitid)


NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
USER_ID = uuid4()


def _ctx(pool: Any | None = None, names: dict[int, str] | None = None) -> ToolCtx:
    return ToolCtx(
        app_pool=cast(Any, pool or _Pool()),
        catalog=cast(Any, _Catalog(names)),
        workspace_events=WorkspaceEventBus(),
        user_id=USER_ID,
        tool_overflow=None,
    )


def _app(
    *, app_id: UUID | None = None, unitid: int = 1, name: str = "Example University"
) -> ApplicationView:
    return ApplicationView(
        id=app_id or uuid4(),
        user_id=USER_ID,
        school_unitid=unitid,
        school_name=name,
        status="Applying",
        list_type="Target",
        round="RD",
        deadline=date(2026, 12, 1),
        aid_deadline=None,
        scholarship_deadline=None,
        notes="old note",
        intended_major="History",
        test_plan="undecided",
        cycle_year=2027,
        created_at=NOW,
        updated_at=NOW,
        progress=Rollup(completed=1, total=2),
        essays=Rollup(completed=0, total=1),
    )


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        (
            {
                "deadline": "clear",
                "aid_deadline": "2026-11-01",
                "test_plan": "clear",
                "notes": "clear",
            },
            {"deadline": None, "aid_deadline": date(2026, 11, 1), "test_plan": None, "notes": None},
        ),
        (
            {"intended_major": "Physics", "test_plan": "submit"},
            {"intended_major": "Physics", "test_plan": "submit"},
        ),
    ],
)
def test_build_application_patch_supports_clear_and_typed_values(
    fields: dict[str, Any], expected: dict[str, Any]
) -> None:
    patch, problem = mutations._build_application_patch(fields)
    assert problem is None
    assert patch == expected


def test_build_application_patch_rejects_invalid_test_plan_and_date() -> None:
    patch, problem = mutations._build_application_patch({"test_plan": "send"})
    assert patch == {}
    assert problem is not None and problem["retryable"] is True
    _, problem = mutations._build_application_patch({"deadline": "09/15/2026"})
    assert problem is not None and problem["status"] == "error"


@pytest.mark.asyncio
async def test_add_schools_rejects_batch_date_before_any_service_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[Any] = []

    async def add(*_args: Any, **kwargs: Any) -> Any:
        calls.append(kwargs)
        return None

    monkeypatch.setattr(mutations, "add_application", add)
    result = await mutations._add_schools_impl(
        _ctx(), [SchoolDraft(unitid=1, cycle_year=2027, deadline="tomorrow")]
    )
    assert result["status"] == "error"
    assert result["retryable"] is True
    assert calls == []


@pytest.mark.asyncio
async def test_add_schools_reports_partial_success_and_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _app(unitid=1, name="Added U")
    seen: list[Any] = []

    async def add(*_args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs["data"])
        if len(seen) == 2:
            raise WorkspaceValidationError("already on list")
        return type("Result", (), {"application": first})()

    monkeypatch.setattr(mutations, "add_application", add)
    result = await mutations._add_schools_impl(
        _ctx(names={1: "Added U", 2: "Existing U"}),
        [
            SchoolDraft(unitid=1, cycle_year=2027, list_type="Reach"),
            SchoolDraft(unitid=2, cycle_year=2027),
        ],
    )
    assert result["status"] == "warning"
    assert result["added"][0]["school"] == "Added U"
    assert result["skipped"][0]["school"] == "Existing U"
    assert result["public_receipt"]["mutation"]["action"] == "create"
    assert seen[0].deadline is None


@pytest.mark.asyncio
async def test_add_schools_all_skipped_and_size_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def add(*_args: Any, **_kwargs: Any) -> Any:
        raise WorkspaceValidationError("duplicate")

    monkeypatch.setattr(mutations, "add_application", add)
    ctx = _ctx(names={1: "Known"})
    result = await mutations._add_schools_impl(ctx, [SchoolDraft(unitid=1, cycle_year=2027)])
    assert result["status"] == "error" and result["retryable"] is False
    assert result["skipped"][0]["reason"] == "duplicate"
    result = await mutations._add_schools_impl(ctx, [])
    assert "1-20" in result["error"]


@pytest.mark.asyncio
async def test_update_school_validates_stale_empty_and_bad_fields() -> None:
    ctx = _ctx()
    assert (await mutations._update_school_impl(ctx, "bad", status="Submitted"))[
        "retryable"
    ] is False
    assert (await mutations._update_school_impl(ctx, str(uuid4())))["retryable"] is True
    invalid = await mutations._update_school_impl(ctx, str(uuid4()), test_plan="invalid")
    assert invalid["status"] == "error" and invalid["retryable"] is True


@pytest.mark.asyncio
async def test_update_school_success_receipt_and_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    before = _app()
    after = before.model_copy(
        update={"status": "Submitted", "deadline": None, "test_plan": None, "notes": None}
    )

    async def update(*_args: Any, **_kwargs: Any) -> tuple[ApplicationView, ApplicationView]:
        return after, before

    monkeypatch.setattr(mutations, "update_application", update)
    result = await mutations._update_school_impl(
        _ctx(),
        str(before.id),
        status="Submitted",
        deadline="clear",
        test_plan="clear",
        notes="clear",
    )
    assert result["status"] == "ok"
    assert "application_status" in {
        c["field_key"] for c in result["public_receipt"]["mutation"]["body"]["changes"]
    }
    assert result["school"]["status"] == "Submitted"

    async def missing(*_args: Any, **_kwargs: Any) -> Any:
        raise WorkspaceNotFoundError("missing")

    monkeypatch.setattr(mutations, "update_application", missing)
    assert (await mutations._update_school_impl(_ctx(), str(before.id), status="Submitted"))[
        "retryable"
    ] is False


@pytest.mark.asyncio
async def test_archive_schools_partial_and_database_error(monkeypatch: pytest.MonkeyPatch) -> None:
    one, two = uuid4(), uuid4()
    pool = _Pool(
        _Connection(rows=[{"id": one, "school_unitid": 1}, {"id": two, "school_unitid": 2}])
    )
    archived: list[UUID] = []

    async def archive(*_args: Any, **kwargs: Any) -> None:
        archived.append(kwargs["application_id"])
        if kwargs["application_id"] == two:
            raise asyncpg.PostgresError("database unavailable")

    monkeypatch.setattr(mutations, "archive_application", archive)
    result = await mutations._archive_schools_impl(
        _ctx(pool, {1: "One", 2: "Two"}), [str(one), "bad", str(two)]
    )
    assert result["status"] == "error"
    assert archived == [one, two]
    assert result["archived"] == [{"id": str(one), "school": "One"}]
    assert "database error" in result["error"]


@pytest.mark.asyncio
async def test_archive_schools_skips_not_found_and_single_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_id = uuid4()
    pool = _Pool(_Connection(rows=[]))
    monkeypatch.setattr(mutations, "archive_application", pytest.fail)
    result = await mutations._archive_schools_impl(_ctx(pool), ["bad", str(app_id)])
    assert result["status"] == "error"
    assert result["retryable"] is False
    result = await mutations._archive_schools_impl(_ctx(pool), [str(app_id)])
    assert result["retryable"] is False and "No active school" in result["error"]
    result = await mutations._archive_schools_impl(_ctx(pool), [])
    assert "1-20" in result["error"]


@pytest.mark.asyncio
async def test_restore_school_probe_states_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    app_id = uuid4()
    pool = _Pool(_Connection(probe={"school_unitid": 7, "archived_at": None}))
    result = await mutations._restore_school_impl(_ctx(pool, {7: "Seven U"}), str(app_id))
    assert result["status"] == "error" and "not archived" in result["error"]

    pool = _Pool(_Connection(probe={"school_unitid": 7, "archived_at": NOW}))

    async def restore(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(mutations, "restore_application", restore)
    result = await mutations._restore_school_impl(_ctx(pool, {7: "Seven U"}), str(app_id))
    assert result["status"] == "ok"
    assert result["public_receipt"]["mutation"]["body"]["state"] == "restored"

    async def conflict(*_args: Any, **_kwargs: Any) -> None:
        raise WorkspaceValidationError("duplicate")

    monkeypatch.setattr(mutations, "restore_application", conflict)
    result = await mutations._restore_school_impl(_ctx(pool, {7: "Seven U"}), str(app_id))
    assert result["retryable"] is False and "can't be restored" in result["error"]

    async def missing(*_args: Any, **_kwargs: Any) -> None:
        raise WorkspaceNotFoundError("gone")

    monkeypatch.setattr(mutations, "restore_application", missing)
    result = await mutations._restore_school_impl(_ctx(pool, {7: "Seven U"}), str(app_id))
    assert result["retryable"] is False and "No active school" in result["error"]

    missing_probe = _Pool(_Connection(probe=None))
    result = await mutations._restore_school_impl(_ctx(missing_probe), str(app_id))
    assert result["retryable"] is False
