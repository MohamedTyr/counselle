"""Unit tests for Catalog.maybe_refresh thundering-herd fix (FIX 10).

No live DB: the catalog is constructed with a mock pool and the _reload is
monkeypatched to simulate failures after initial load.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest

from counselle_db.catalog import _REFRESH_INTERVAL, Catalog


def _make_catalog_with_data() -> Catalog:
    """Return a Catalog that looks like it has been freshly loaded."""
    pool = MagicMock()
    catalog = Catalog(pool)
    # Populate with a minimal field to verify "stale data is served"
    from domain.normalize import FieldMeta

    catalog.fields_by_key = {
        "test.field": FieldMeta(
            key="test.field",
            label="Test",
            category="test",
            data_type="text",
            source="ipeds",
            raw_table="raw.ipeds_hd2024",
        )
    }
    catalog.loaded_at = datetime.now(UTC)  # fresh
    return catalog


async def test_maybe_refresh_does_not_raise_when_reload_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed periodic _reload must not propagate — stale data is served instead."""
    catalog = _make_catalog_with_data()
    original_fields = dict(catalog.fields_by_key)

    # Expire the catalog so maybe_refresh triggers a reload attempt
    catalog.loaded_at = datetime.now(UTC) - _REFRESH_INTERVAL - timedelta(seconds=1)

    async def broken_reload(self: Any) -> None:
        raise RuntimeError("DB blip")

    monkeypatch.setattr(Catalog, "_reload", broken_reload)

    # Must NOT raise
    await catalog.maybe_refresh()

    # Stale data is still there
    assert catalog.fields_by_key == original_fields


async def test_maybe_refresh_applies_backoff_after_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After a failed refresh, loaded_at is advanced so the next retry is ~10 min away,
    not immediate (thundering herd prevention)."""
    catalog = _make_catalog_with_data()
    catalog.loaded_at = datetime.now(UTC) - _REFRESH_INTERVAL - timedelta(seconds=1)

    async def broken_reload(self: Any) -> None:
        raise RuntimeError("DB blip")

    monkeypatch.setattr(Catalog, "_reload", broken_reload)
    await catalog.maybe_refresh()

    # After the failed refresh, loaded_at should have been set so that the next
    # attempt is ~10 minutes away (i.e. loaded_at is now ~ _REFRESH_INTERVAL - 10min ago).
    next_attempt_in = _REFRESH_INTERVAL - (datetime.now(UTC) - catalog.loaded_at)
    assert next_attempt_in > timedelta(minutes=9), (
        f"next retry in {next_attempt_in} — expected > 9 minutes (backoff not applied)"
    )
    assert next_attempt_in < timedelta(minutes=11), (
        f"next retry in {next_attempt_in} — expected < 11 minutes"
    )


async def test_maybe_refresh_does_not_retry_immediately_on_second_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second call to maybe_refresh right after a failed one must NOT trigger another reload."""
    catalog = _make_catalog_with_data()
    catalog.loaded_at = datetime.now(UTC) - _REFRESH_INTERVAL - timedelta(seconds=1)

    reload_calls: list[int] = [0]

    async def broken_reload(self: Any) -> None:
        reload_calls[0] += 1
        raise RuntimeError("DB blip")

    monkeypatch.setattr(Catalog, "_reload", broken_reload)

    await catalog.maybe_refresh()  # first call — triggers one reload attempt
    await catalog.maybe_refresh()  # second call — should be skipped (backoff in effect)

    assert reload_calls[0] == 1, (
        f"expected exactly 1 reload attempt, got {reload_calls[0]} — backoff not applied"
    )
