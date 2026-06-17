"""CFG-01: the coverage count is DB-derived, never a hardcoded literal.

No live DB: ``counselle_db.catalog.fetch`` is monkeypatched to return fixtured
rows so ``Catalog._reload`` runs against a fake pool (mirrors the fake-pool style
of ``test_catalog_refresh.py``).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from counselle_db import catalog as catalog_mod
from counselle_db import service as service_mod
from counselle_db.catalog import Catalog
from counselle_db.models import ResolveNotFound


def _fake_fetch_factory(name_rows: list[dict[str, Any]]) -> Any:
    """A ``fetch`` stub keyed off the SQL: school names get ``name_rows``;
    every other catalog query returns empty (fields/files/websites)."""

    async def _fetch(pool: Any, sql: str, *args: Any) -> list[dict[str, Any]]:
        if "FROM schools" in sql and "unitid, name" in sql:
            return name_rows
        return []

    return _fetch


async def test_catalog_school_count(monkeypatch: pytest.MonkeyPatch) -> None:
    """``school_count`` equals the number of loaded school-name rows after reload."""
    rows = [{"unitid": i, "name": f"School {i}"} for i in range(1, 2711)]
    monkeypatch.setattr(catalog_mod, "fetch", _fake_fetch_factory(rows))

    cat = Catalog(MagicMock())
    assert cat.school_count == 0  # nothing loaded yet
    await cat._reload()
    assert cat.school_count == 2710
    assert cat.school_count == len(cat.school_names)


def test_not_found_message_uses_count() -> None:
    """The not-found copy interpolates the live count, never the old literal."""
    message = service_mod._not_found_message(2710)
    assert "2,710" in message
    assert "2,746" not in message


async def test_resolve_school_not_found_message_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``resolve_school`` (not-found path) carries the live count in its message."""

    async def _no_rows(pool: Any, sql: str, *args: Any) -> list[dict[str, Any]]:
        return []  # ILIKE + fuzzy both find nothing → not_found

    monkeypatch.setattr(service_mod, "fetch", _no_rows)

    fake_catalog = MagicMock()
    fake_catalog.school_count = 2710
    fake_catalog.pool = MagicMock()

    result = await service_mod.resolve_school(fake_catalog, "Nonexistent College")
    assert isinstance(result, ResolveNotFound)
    assert "2,710" in result.message
    assert "2,746" not in result.message
