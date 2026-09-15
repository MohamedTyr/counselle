"""Hermetic contract coverage for the activity mutation agent tools.

These tests deliberately stop at the tool/service boundary.  The live service
tests cover SQL; this file checks that the agent-facing boundary translates
inputs, errors, ordering, and mutation receipts without requiring a database.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from app.workspace import agent_tools_activities_mutations as mutations
from app.workspace.agent_tools_shared import ActivityDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    Activity,
    ActivityDuplicateError,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from counselle_db.catalog import Catalog

NOW = datetime(2026, 9, 15, tzinfo=UTC)
SERVICE: Any = cast(Any, mutations).service_activities


def _ctx(pool: Any | None = None) -> ToolCtx:
    return ToolCtx(
        app_pool=cast(Any, pool if pool is not None else object()),
        catalog=cast(Catalog, None),
        workspace_events=WorkspaceEventBus(),
        user_id=uuid4(),
        tool_overflow=None,
    )


def _activity(*, user_id: UUID | None = None, **changes: Any) -> Activity:
    values: dict[str, Any] = {
        "id": uuid4(),
        "user_id": user_id or uuid4(),
        "sort_order": 0,
        "activity_type": "Robotics",
        "position_label": "Captain",
        "organization": "Robotics Club",
        "description": "Built robots",
        "grades": ["11"],
        "timing": ["school_year"],
        "hours_per_week": 4,
        "weeks_per_year": 30,
        "continue_in_college": False,
        "story": "Raw source material",
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(changes)
    return Activity.model_validate(values)


def _draft(**changes: Any) -> ActivityDraft:
    values: dict[str, Any] = {
        "type": "Robotics",
        "position": "Captain",
        "organization": "Robotics Club",
        "description": "Built robots",
        "grades": ["11"],
        "timing": ["school_year"],
        "hours_per_week": 4,
        "weeks_per_year": 30,
        "continue_in_college": True,
        "story": "source",
    }
    values.update(changes)
    return ActivityDraft.model_validate(values)


class _Connection:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row

    async def __aenter__(self) -> _Connection:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def fetchrow(self, *_args: object) -> dict[str, Any] | None:
        return self.row


class _Pool:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self.row = row

    def acquire(self) -> _Connection:
        return _Connection(self.row)


async def test_create_rejects_bad_batch_without_touching_service() -> None:
    result = await mutations._create_activities_impl(_ctx(), [], False)
    assert result["status"] == "error"
    assert "1-20" in result["error"]


async def test_create_maps_drafts_warns_and_emits_batch_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = [_activity(), _activity(position_label="Lead", description="x" * 151)]
    calls: dict[str, Any] = {}

    async def create(*args: Any, **kwargs: Any) -> list[Activity]:
        calls["data"] = kwargs["data"]
        calls["reject"] = kwargs["reject_duplicate_pairs"]
        return created

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return created

    monkeypatch.setattr(SERVICE, "create_activities", create)
    monkeypatch.setattr(SERVICE, "list_activities", listed)
    result = await mutations._create_activities_impl(
        _ctx(), [_draft(), _draft(position="Lead")], False
    )

    assert result["status"] == "ok"
    assert calls["reject"] is True
    assert calls["data"][0].activity_type == "Robotics"
    assert calls["data"][0].grades == ["11"]
    assert "description 151/150" in result["warning"]
    receipt = result["public_receipt"]["mutation"]
    assert receipt["action"] == "create"
    assert [item["disposition"] for item in receipt["body"]["items"]] == ["changed", "changed"]


@pytest.mark.parametrize(
    ("exc", "needle"),
    [
        (
            ActivityDuplicateError(
                duplicate_index=1, active_activity_id=UUID("00000000-0000-0000-0000-000000000001")
            ),
            "duplicates active activity id",
        ),
        (ActivityDuplicateError(duplicate_index=1, earlier_batch_index=0), "earlier in this batch"),
    ],
)
async def test_create_duplicate_errors_are_safe_and_actionable(
    monkeypatch: pytest.MonkeyPatch, exc: ActivityDuplicateError, needle: str
) -> None:
    async def fail(*_args: Any, **_kwargs: Any) -> list[Activity]:
        raise exc

    monkeypatch.setattr(SERVICE, "create_activities", fail)
    result = await mutations._create_activities_impl(
        _ctx(), [_draft(), _draft(position="Lead")], True
    )
    assert result["status"] == "error"
    assert needle in result["error"]
    assert "Nothing was created" in result["error"]


async def test_create_validation_error_reports_current_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail(*_args: Any, **_kwargs: Any) -> list[Activity]:
        raise WorkspaceValidationError("cap")

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [_activity(), _activity()]

    monkeypatch.setattr(SERVICE, "create_activities", fail)
    monkeypatch.setattr(SERVICE, "list_activities", listed)
    result = await mutations._create_activities_impl(_ctx(), [_draft()], False)
    assert result["status"] == "error"
    assert "2 active" in result["error"]


async def test_update_rejects_empty_or_stale_input() -> None:
    ctx = _ctx()
    empty = await mutations._update_activity_impl(
        ctx,
        str(uuid4()),
        **{
            key: None
            for key in (
                "type",
                "position",
                "organization",
                "description",
                "grades",
                "timing",
                "hours_per_week",
                "weeks_per_year",
                "continue_in_college",
                "story",
            )
        },
    )
    stale = await mutations._update_activity_impl(ctx, "not-a-uuid", description="x")
    assert empty["status"] == stale["status"] == "error"
    assert "No fields provided" in empty["error"]
    assert "No active activity" in stale["error"]


async def test_update_maps_clear_values_and_receipt_hides_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _activity()
    after = _activity(
        id=before.id,
        position_label="Updated",
        description="new",
        story=None,
        hours_per_week=None,
        continue_in_college=True,
    )
    calls: dict[str, Any] = {}

    async def update(*_args: Any, **kwargs: Any) -> tuple[Activity, Activity]:
        calls["patch"] = kwargs["data"]
        return after, before

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [after]

    monkeypatch.setattr(SERVICE, "update_activity", update)
    monkeypatch.setattr(SERVICE, "list_activities", listed)
    result = await mutations._update_activity_impl(
        _ctx(),
        str(before.id),
        type="Academic",
        position="Updated",
        organization=None,
        grades=["12"],
        timing=["break"],
        hours_per_week="clear",
        weeks_per_year=20,
        continue_in_college=True,
        description="new",
        story="clear",
    )
    assert result["status"] == "ok"
    assert calls["patch"].hours_per_week is None
    assert calls["patch"].weeks_per_year == 20
    changes = result["public_receipt"]["mutation"]["body"]["changes"]
    assert {item["field_key"] for item in changes} == {
        "type",
        "position",
        "grades",
        "timing",
        "hours_per_week",
        "weeks_per_year",
        "continuation",
        "description",
        "story",
    }
    assert all("new" not in str(item) for item in changes)


async def test_update_handles_missing_row_and_noop_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    async def missing(*_args: Any, **_kwargs: Any) -> tuple[Activity, Activity]:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "update_activity", missing)
    fields: dict[str, Any] = {
        key: None
        for key in (
            "type",
            "position",
            "organization",
            "description",
            "grades",
            "timing",
            "hours_per_week",
            "weeks_per_year",
            "continue_in_college",
            "story",
        )
    }
    fields["position"] = "x"
    missing_result = await mutations._update_activity_impl(_ctx(), str(uuid4()), **fields)
    assert missing_result["status"] == "error"

    same = _activity()

    async def unchanged(*_args: Any, **_kwargs: Any) -> tuple[Activity, Activity]:
        return same, same

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [same]

    monkeypatch.setattr(SERVICE, "update_activity", unchanged)
    monkeypatch.setattr(SERVICE, "list_activities", listed)
    noop_fields: dict[str, Any] = {
        key: None
        for key in (
            "type",
            "position",
            "organization",
            "description",
            "grades",
            "timing",
            "hours_per_week",
            "weeks_per_year",
            "continue_in_college",
            "story",
        )
    }
    noop_fields["position"] = same.position
    result = await mutations._update_activity_impl(_ctx(), str(same.id), **noop_fields)
    assert result["status"] == "ok"
    assert result["public_receipt"]["mutation"]["body"]["changes"][0]["field_key"] == "position"


async def test_archive_batch_keeps_valid_items_and_marks_bad_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    activity = _activity()
    archived: list[UUID] = []

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [activity]

    async def archive(*_args: Any, **kwargs: Any) -> None:
        if kwargs["activity_id"] == activity.id:
            archived.append(activity.id)
        else:
            raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "list_activities", listed)
    monkeypatch.setattr(SERVICE, "archive_activity", archive)
    stale_id = str(uuid4())
    result = await mutations._archive_activities_impl(_ctx(), [str(activity.id), "bad", stale_id])
    assert result["status"] == "warning"
    assert archived == [activity.id]
    assert len(result["skipped"]) == 2
    assert result["public_receipt"]["mutation"]["body"]["items"][1]["disposition"] == "skipped"


async def test_archive_all_invalid_single_and_batch_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _ctx(_Pool())

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return []

    monkeypatch.setattr(SERVICE, "list_activities", listed)
    single = await mutations._archive_activities_impl(ctx, ["bad"])
    batch = await mutations._archive_activities_impl(ctx, ["bad", "also-bad"])
    assert single["status"] == batch["status"] == "error"
    assert "No active activity" in single["error"]
    assert "No active activities" in batch["error"]


async def test_restore_covers_probe_states_success_and_service_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    activity = _activity()
    ctx = _ctx(_Pool({"position_label": activity.position, "archived_at": NOW}))

    async def listed(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [activity]

    async def restore(*_args: Any, **_kwargs: Any) -> Activity:
        return activity

    monkeypatch.setattr(SERVICE, "list_activities", listed)
    monkeypatch.setattr(SERVICE, "restore_activity", restore)
    result = await mutations._restore_activity_impl(ctx, str(activity.id))
    assert result["status"] == "ok"
    assert result["activity"]["rank"] == 1
    assert result["public_receipt"]["mutation"]["action"] == "restore"

    active_ctx = _ctx(_Pool({"position_label": "Captain", "archived_at": None}))
    active = await mutations._restore_activity_impl(active_ctx, str(activity.id))
    assert "already on the active page" in active["error"]

    async def not_found(*_args: Any, **_kwargs: Any) -> Activity:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(SERVICE, "restore_activity", not_found)
    missing = await mutations._restore_activity_impl(ctx, str(activity.id))
    assert missing["status"] == "error"


async def test_restore_cap_and_reorder_contracts(monkeypatch: pytest.MonkeyPatch) -> None:
    activity = _activity()
    archived_ctx = _ctx(_Pool({"position_label": "Captain", "archived_at": NOW}))

    async def full(*_args: Any, **_kwargs: Any) -> list[Activity]:
        return [_activity() for _ in range(10)]

    monkeypatch.setattr(SERVICE, "list_activities", full)
    capped = await mutations._restore_activity_impl(archived_ctx, str(activity.id))
    assert "allows 10 activities" in capped["error"]

    invalid = await mutations._reorder_activities_impl(_ctx(), ["bad"])
    assert invalid["status"] == "error"

    async def reorder(*_args: Any, **_kwargs: Any) -> tuple[list[Activity], dict[UUID, int]]:
        second = _activity()
        first = _activity()
        return [second, first], {second.id: 2, first.id: 1}

    monkeypatch.setattr(SERVICE, "reorder_activities", reorder)
    reordered = await mutations._reorder_activities_impl(_ctx(), [str(uuid4())])
    assert reordered["status"] == "ok"
    receipt = reordered["public_receipt"]["mutation"]
    assert receipt["action"] == "reorder"
    assert receipt["body"]["moved_index"] == 0


async def test_reorder_service_conflict_returns_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail(*_args: Any, **_kwargs: Any) -> Any:
        raise WorkspaceValidationError()

    monkeypatch.setattr(SERVICE, "reorder_activities", fail)
    result = await mutations._reorder_activities_impl(_ctx(), [str(uuid4())])
    assert result["status"] == "error"
    assert result["retryable"] is True
    assert "exactly the current active activities" in result["recovery"]
