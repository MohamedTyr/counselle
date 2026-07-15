"""Fast unit tests for Phase 2 workspace service helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest

from app.workspace import service_activities
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    Activity,
    ActivityPatch,
    Honor,
    HonorPatch,
    WorkspaceValidationError,
)
from app.workspace.service_essays import _check_not_stale, _word_count, tiptap_preview
from counselle_db import service
from counselle_db.catalog import Catalog


class _AsyncContext:
    async def __aenter__(self) -> _AsyncContext:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


class _ActivityConnection:
    def __init__(self, row: dict[str, object]) -> None:
        self.row = row
        self.queries: list[str] = []

    def transaction(self) -> _AsyncContext:
        return _AsyncContext()

    async def fetchrow(self, query: str, *_: object) -> dict[str, object]:
        self.queries.append(query)
        return self.row if "SELECT *" in query else {"id": self.row["id"]}


class _ConnectionContext:
    def __init__(self, connection: _ActivityConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> _ActivityConnection:
        return self.connection

    async def __aexit__(self, *_: object) -> None:
        return None


class _ActivityPool:
    def __init__(self, connection: _ActivityConnection) -> None:
        self.connection = connection

    def acquire(self) -> _ConnectionContext:
        return _ConnectionContext(self.connection)



def test_tiptap_preview_extracts_plain_text() -> None:
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Why Duke?"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "Because fit."}]},
        ],
    }

    assert tiptap_preview(content) == "Why Duke? Because fit."


def test_word_count_is_derived_from_tiptap_content_server_side() -> None:
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Why Duke?"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "Because fit."}]},
        ],
    }

    assert _word_count(content) == 4


def test_word_count_of_empty_doc_is_zero() -> None:
    empty = {"type": "doc", "content": [{"type": "paragraph"}]}

    assert _word_count(empty) == 0


def test_check_not_stale_allows_missing_precondition() -> None:
    # No expected_updated_at supplied → last-write-wins, no error.
    _check_not_stale(datetime(2027, 1, 1, tzinfo=UTC), None)


def test_check_not_stale_allows_matching_precondition() -> None:
    current = datetime(2027, 1, 1, tzinfo=UTC)
    _check_not_stale(current, current)


def test_check_not_stale_rejects_mismatched_precondition() -> None:
    current = datetime(2027, 1, 1, tzinfo=UTC)
    stale = datetime(2026, 12, 31, tzinfo=UTC)

    with pytest.raises(WorkspaceValidationError):
        _check_not_stale(current, stale)


@pytest.mark.parametrize("patch", [ActivityPatch(), HonorPatch()])
async def test_empty_activity_or_honor_patch_is_a_true_no_op(
    monkeypatch: pytest.MonkeyPatch,
    patch: ActivityPatch | HonorPatch,
) -> None:
    """Empty patches do not write a change or notify workspace subscribers."""
    user_id = uuid4()
    activity_id = uuid4()
    timestamp = datetime(2027, 1, 1, tzinfo=UTC)
    connection = _ActivityConnection(
        {
            "id": activity_id,
            "user_id": user_id,
            "sort_order": 0,
            "activity_type": "Robotics",
            "position_label": "Builder",
            "organization": "Robotics Club",
            "description": "Built robots.",
            "grades": ["11"],
            "timing": ["school_year"],
            "hours_per_week": 8,
            "weeks_per_year": 30,
            "continue_in_college": True,
            "story": None,
            "title": "Regional robotics award",
            "levels": ["Regional"],
            "created_at": timestamp,
            "updated_at": timestamp,
            "archived_at": None,
        }
    )

    async def fail_if_change_is_recorded(*_: object, **__: object) -> None:
        pytest.fail("an empty patch must not create a workspace change")

    monkeypatch.setattr(service_activities, "_record_change", fail_if_change_is_recorded)
    event_bus = WorkspaceEventBus()
    result: Activity | Honor
    expected: Activity | Honor

    async with event_bus.subscribe(user_id) as queue:
        if isinstance(patch, ActivityPatch):
            result = await service_activities.update_activity(
                cast(Any, _ActivityPool(connection)),
                event_bus,
                user_id=user_id,
                actor="student",
                activity_id=activity_id,
                data=patch,
            )
            expected = Activity.model_validate(connection.row)
        else:
            result = await service_activities.update_honor(
                cast(Any, _ActivityPool(connection)),
                event_bus,
                user_id=user_id,
                actor="student",
                honor_id=activity_id,
                data=patch,
            )
            expected = Honor.model_validate(connection.row)

        assert queue.empty()
    assert result == expected
    assert connection.queries == [service_activities._REQUIRE_ACTIVE_SQL[
        "activities" if isinstance(patch, ActivityPatch) else "honors"
    ]]


async def test_search_school_names_uses_name_path_and_main_campus_order(
) -> None:
    schools = [
        SimpleNamespace(basics=SimpleNamespace(unitid=1)),
        SimpleNamespace(basics=SimpleNamespace(unitid=2)),
    ]
    catalog = cast(Catalog, SimpleNamespace(resolve_candidates=lambda query: tuple(schools)))

    results = await service.search_school_names(catalog, "Example", limit=1)

    assert [school.unitid for school in results] == [1]
