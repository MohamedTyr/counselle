"""Hermetic contract coverage for the honors mutation agent tools.

The activity service owns database correctness; these tests exercise the
agent-facing translation layer with typed-enough fakes, including validation,
partial batch results, state transitions, and public receipt redaction.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from app.workspace import agent_tools_honors_mutations as mutations
from app.workspace.agent_tools_shared import HonorDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    Honor,
    HonorDuplicateError,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
USER_ID = uuid4()
SERVICE: Any = cast(Any, mutations).service_activities


def _ctx(pool: Any | None = None) -> ToolCtx:
    return ToolCtx(
        app_pool=cast(Any, pool if pool is not None else object()),
        catalog=cast(Any, None),
        workspace_events=WorkspaceEventBus(),
        user_id=USER_ID,
        tool_overflow=None,
    )


def _honor(*, honor_id: UUID | None = None, **changes: Any) -> Honor:
    values: dict[str, Any] = {
        "id": honor_id or uuid4(),
        "user_id": USER_ID,
        "sort_order": 0,
        "title": "National Merit Scholar",
        "grades": ["11", "12"],
        "levels": ["national"],
        "created_at": NOW,
        "updated_at": NOW,
        "archived_at": None,
    }
    values.update(changes)
    return Honor.model_validate(values)


def _draft(**changes: Any) -> HonorDraft:
    values: dict[str, Any] = {
        "title": "National Merit Scholar",
        "grades": ["11"],
        "levels": ["national"],
    }
    values.update(changes)
    return HonorDraft.model_validate(values)


class _Acquire:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row

    async def __aenter__(self) -> _Acquire:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def fetchrow(self, *_args: object) -> dict[str, Any] | None:
        return self.row


class _Pool:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self.row = row

    def acquire(self) -> _Acquire:
        return _Acquire(self.row)


async def test_create_validates_batch_and_maps_success_with_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = [_honor(title="x" * 101), _honor(title="Prize")]
    calls: dict[str, Any] = {}

    async def create(*_args: Any, **kwargs: Any) -> list[Honor]:
        calls["data"] = kwargs["data"]
        calls["reject"] = kwargs["reject_duplicate_pairs"]
        return created

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return created

    monkeypatch.setattr(SERVICE, "create_honors_batch", create)
    monkeypatch.setattr(SERVICE, "list_honors", listed)
    invalid = await mutations._create_honors_impl(_ctx(), [], False)
    assert invalid["status"] == "error"
    assert "1-20" in invalid["error"]

    result = await mutations._create_honors_impl(
        _ctx(), [_draft(title="x" * 101), _draft(title="Prize")], False
    )
    assert result["status"] == "ok"
    assert calls["reject"] is True
    assert calls["data"][0].title == "x" * 101
    assert "title 101/100" in result["warning"]
    receipt = result["public_receipt"]["mutation"]
    assert receipt["action"] == "create"
    assert [item["disposition"] for item in receipt["body"]["items"]] == [
        "changed",
        "changed",
    ]


@pytest.mark.parametrize(
    ("exc", "needle", "retryable"),
    [
        (
            HonorDuplicateError(
                duplicate_index=1,
                active_honor_id=UUID("00000000-0000-0000-0000-000000000001"),
            ),
            "duplicates active honor id",
            False,
        ),
        (
            HonorDuplicateError(duplicate_index=1, earlier_batch_index=0),
            "earlier in this batch",
            True,
        ),
    ],
)
async def test_create_duplicate_errors_are_safe(
    monkeypatch: pytest.MonkeyPatch,
    exc: HonorDuplicateError,
    needle: str,
    retryable: bool,
) -> None:
    async def fail(*_args: Any, **_kwargs: Any) -> list[Honor]:
        raise exc

    monkeypatch.setattr(SERVICE, "create_honors_batch", fail)
    result = await mutations._create_honors_impl(_ctx(), [_draft(), _draft(title="Prize")], False)
    assert result["status"] == "error"
    assert needle in result["error"]
    assert result["retryable"] is retryable
    assert "Nothing was created" in result["error"]


async def test_create_cap_error_reports_current_active_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail(*_args: Any, **_kwargs: Any) -> list[Honor]:
        raise WorkspaceValidationError("active honors cap")

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return [_honor(title=str(index)) for index in range(3)]

    monkeypatch.setattr(SERVICE, "create_honors_batch", fail)
    monkeypatch.setattr(SERVICE, "list_honors", listed)
    result = await mutations._create_honors_impl(_ctx(), [_draft()], False)
    assert result["status"] == "error"
    assert "3 active" in result["error"]


async def test_update_validates_stale_and_returns_redacted_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    empty = await mutations._update_honor_impl(
        _ctx(), str(uuid4()), title=None, grades=None, levels=None
    )
    stale = await mutations._update_honor_impl(_ctx(), "bad-id", title="x")
    assert "No fields provided" in empty["error"]
    assert "No active honor" in stale["error"]

    before = _honor()
    after = _honor(
        honor_id=before.id,
        title="Updated title",
        grades=["12"],
        levels=["international"],
    )
    calls: dict[str, Any] = {}

    async def update(*_args: Any, **kwargs: Any) -> tuple[Honor, Honor]:
        calls["patch"] = kwargs["data"]
        return after, before

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return [after]

    monkeypatch.setattr(SERVICE, "update_honor", update)
    monkeypatch.setattr(SERVICE, "list_honors", listed)
    result = await mutations._update_honor_impl(
        _ctx(), str(before.id), title="Updated title", grades=["12"], levels=["international"]
    )
    assert result["status"] == "ok"
    assert calls["patch"].levels == ["international"]
    changes = result["public_receipt"]["mutation"]["body"]["changes"]
    assert {item["field_key"] for item in changes} == {"title", "grades", "recognition_level"}
    # Titles are bounded display values (not unbounded raw payloads); list
    # changes remain typed list values rather than stringified input.
    title_change = next(item for item in changes if item["field_key"] == "title")
    assert title_change["after"]["kind"] == "text"
    assert changes[1]["after"]["kind"] == "text_list"


async def test_update_missing_row_has_stale_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing(*_args: Any, **_kwargs: Any) -> tuple[Honor, Honor]:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "update_honor", missing)
    result = await mutations._update_honor_impl(_ctx(), str(uuid4()), title="x")
    assert result["status"] == "error"
    assert "No active honor" in result["error"]


async def test_archive_mixed_batch_reports_skips_and_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    honor = _honor()
    archived: list[UUID] = []

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return [honor]

    async def archive(*_args: Any, **kwargs: Any) -> None:
        if kwargs["honor_id"] == honor.id:
            archived.append(honor.id)
        else:
            raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "list_honors", listed)
    monkeypatch.setattr(SERVICE, "archive_honor", archive)
    result = await mutations._archive_honors_impl(_ctx(), [str(honor.id), "bad", str(uuid4())])
    assert result["status"] == "warning"
    assert archived == [honor.id]
    assert len(result["skipped"]) == 2
    assert result["public_receipt"]["mutation"]["body"]["items"][1]["disposition"] == "skipped"


async def test_archive_all_invalid_and_bad_batch_sizes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return []

    monkeypatch.setattr(SERVICE, "list_honors", listed)
    too_large = await mutations._archive_honors_impl(_ctx(), [])
    single = await mutations._archive_honors_impl(_ctx(), ["bad"])
    batch = await mutations._archive_honors_impl(_ctx(), ["bad", "also-bad"])
    assert "1-20" in too_large["error"]
    assert "No active honor" in single["error"]
    assert "No active honors" in batch["error"]


async def test_restore_handles_probe_states_cap_success_and_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    honor = _honor()
    ctx = _ctx(_Pool({"title": honor.title, "archived_at": NOW}))

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return [honor]

    async def restore(*_args: Any, **_kwargs: Any) -> Honor:
        return honor

    monkeypatch.setattr(SERVICE, "list_honors", listed)
    monkeypatch.setattr(SERVICE, "restore_honor", restore)
    result = await mutations._restore_honor_impl(ctx, str(honor.id))
    assert result["status"] == "ok"
    assert result["honor"]["rank"] == 1
    assert result["public_receipt"]["mutation"]["action"] == "restore"

    active = await mutations._restore_honor_impl(
        _ctx(_Pool({"title": honor.title, "archived_at": None})), str(honor.id)
    )
    assert "already on the active page" in active["error"]

    async def full(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return [_honor() for _ in range(5)]

    monkeypatch.setattr(SERVICE, "list_honors", full)
    capped = await mutations._restore_honor_impl(ctx, str(honor.id))
    assert "allows 5 honors" in capped["error"]

    missing = await mutations._restore_honor_impl(_ctx(_Pool(None)), str(honor.id))
    assert "No active honor" in missing["error"]


async def test_restore_service_conflicts_and_reorder_contracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    honor = _honor()
    ctx = _ctx(_Pool({"title": honor.title, "archived_at": NOW}))

    async def listed(*_args: Any, **_kwargs: Any) -> list[Honor]:
        return []

    async def fail(*_args: Any, **_kwargs: Any) -> Honor:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "list_honors", listed)
    monkeypatch.setattr(SERVICE, "restore_honor", fail)
    stale = await mutations._restore_honor_impl(ctx, str(honor.id))
    assert stale["status"] == "error"

    invalid = await mutations._reorder_honors_impl(_ctx(), ["bad"])
    assert invalid["status"] == "error"
    assert invalid["retryable"] is True

    first, second = _honor(title="First"), _honor(title="Second")

    async def reorder(*_args: Any, **_kwargs: Any) -> tuple[list[Honor], dict[UUID, int]]:
        return [second, first], {second.id: 2, first.id: 1}

    monkeypatch.setattr(SERVICE, "reorder_honors", reorder)
    result = await mutations._reorder_honors_impl(_ctx(), [str(first.id), str(second.id)])
    assert result["status"] == "ok"
    assert result["public_receipt"]["mutation"]["action"] == "reorder"
    assert result["public_receipt"]["mutation"]["body"]["moved_index"] == 0

    async def conflict(*_args: Any, **_kwargs: Any) -> Any:
        raise WorkspaceValidationError()

    monkeypatch.setattr(SERVICE, "reorder_honors", conflict)
    failed = await mutations._reorder_honors_impl(_ctx(), [str(first.id)])
    assert failed["status"] == "error"
    assert "exactly the current active honors" in failed["recovery"]
