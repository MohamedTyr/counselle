"""Fast unit tests for Phase 2 workspace service helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.workspace.models import WorkspaceSeedingTemplate
from app.workspace.seeding import _due_at
from app.workspace.service_essays import tiptap_preview
from config.settings import load_yaml_asset
from counselle_db import service
from counselle_db.catalog import Catalog


def test_seed_due_at_only_when_user_deadline_exists() -> None:
    assert _due_at(None, 3) is None
    assert _due_at(date(2027, 1, 10), None) is None
    assert _due_at(date(2027, 1, 10), 3) == datetime(2027, 1, 7, tzinfo=UTC)


def test_workspace_seed_template_shape_is_phase_2_contract() -> None:
    template = WorkspaceSeedingTemplate.model_validate(load_yaml_asset("workspace_seeding"))

    assert len(template.tasks) == 6
    assert len(template.essays) == 1
    assert template.essays[0].title == "Supplemental essay"


def test_tiptap_preview_extracts_plain_text() -> None:
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Why Duke?"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "Because fit."}]},
        ],
    }

    assert tiptap_preview(content) == "Why Duke? Because fit."


async def test_search_school_names_uses_name_path_and_main_campus_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    async def fake_fetch(_pool: object, sql: str, query: str) -> list[dict[str, Any]]:
        calls.append((sql, query))
        return [
            {
                "unitid": 2,
                "name": "Example University - Downtown",
                "city": "A",
                "state": "NY",
                "control": "public",
                "level": "4-year",
            },
            {
                "unitid": 1,
                "name": "Example University",
                "city": "A",
                "state": "NY",
                "control": "public",
                "level": "4-year",
            },
        ]

    monkeypatch.setattr(service, "fetch", fake_fetch)
    catalog = cast(Catalog, SimpleNamespace(pool=object()))

    results = await service.search_school_names(catalog, "Example", limit=1)

    assert [school.unitid for school in results] == [1]
    assert calls and "ILIKE" in calls[0][0]
