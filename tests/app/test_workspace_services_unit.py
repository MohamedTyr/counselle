"""Fast unit tests for Phase 2 workspace service helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.workspace.models import WorkspaceSeedingTemplate, WorkspaceValidationError
from app.workspace.seeding import _due_at
from app.workspace.service_essays import _check_not_stale, _word_count, tiptap_preview
from config.settings import load_yaml_asset
from counselle_db import service
from counselle_db.catalog import Catalog


def test_seed_due_at_only_when_user_deadline_exists() -> None:
    assert _due_at(None, 3) is None
    assert _due_at(date(2027, 1, 10), None) is None
    assert _due_at(date(2027, 1, 10), 3) == datetime(2027, 1, 7, tzinfo=UTC)


def test_workspace_seed_template_shape_is_phase_2_contract() -> None:
    template = WorkspaceSeedingTemplate.model_validate(load_yaml_asset("workspace_seeding"))

    assert template.tasks == []
    assert len(template.essays) == 1
    assert template.essays[0].title == "Supplemental essay (confirm required)"


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


async def test_search_school_names_uses_name_path_and_main_campus_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_fetch(_pool: object, sql: str, query: str) -> list[dict[str, Any]]:
        calls.append((sql, query))
        # _SEARCH_SQL is now the authoritative order (main campus first via its
        # ORDER BY); the DB returns rows already ranked, so the fixture mirrors
        # that and the wrapper must preserve — not re-sort — the order.
        return [
            {
                "unitid": 1,
                "name": "Example University",
                "city": "A",
                "state": "NY",
                "control": "public",
                "level": "4-year",
            },
            {
                "unitid": 2,
                "name": "Example University - Downtown",
                "city": "A",
                "state": "NY",
                "control": "public",
                "level": "4-year",
            },
        ]

    monkeypatch.setattr(service, "fetch", fake_fetch)
    catalog = cast(Catalog, SimpleNamespace(pool=object()))

    results = await service.search_school_names(catalog, "Example", limit=1)

    # Preserves DB relevance order and honours the limit (main campus, not Downtown).
    assert [school.unitid for school in results] == [1]
    assert calls and "ILIKE" in calls[0][0]
    # The main-campus preference lives in the SQL, not a Python re-sort.
    assert "main campus" in calls[0][0].lower()
