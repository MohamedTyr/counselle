from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import asyncpg
import pytest

import counselle_db.db as db
from config.settings import DEFAULT_DB_STATEMENT_TIMEOUT_MS


async def test_create_pool_uses_loaded_app_settings_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        db_ro_dsn="postgresql://reader",
        db_pool_min=2,
        db_pool_max=4,
        db_statement_timeout_ms=321,
    )
    captured: dict[str, Any] = {}

    async def fake_create_pool(dsn: str, **kwargs: Any) -> object:
        captured.update(dsn=dsn, **kwargs)
        return object()

    monkeypatch.setattr(db, "get_settings", lambda: settings)
    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    await db.create_pool()

    assert captured["dsn"] == settings.db_ro_dsn
    assert captured["min_size"] == 2
    assert captured["max_size"] == 4
    assert captured["server_settings"] == {"statement_timeout": "321"}


async def test_create_pool_with_explicit_dsn_never_loads_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_create_pool(dsn: str, **kwargs: Any) -> object:
        captured.update(dsn=dsn, **kwargs)
        return object()

    def unexpected_settings() -> None:
        raise AssertionError("an explicit DSN must not construct a settings surface")

    monkeypatch.setattr(db, "get_settings", unexpected_settings)
    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    await db.create_pool("postgresql://explicit")

    assert captured["dsn"] == "postgresql://explicit"
    assert captured["server_settings"] == {
        "statement_timeout": str(DEFAULT_DB_STATEMENT_TIMEOUT_MS)
    }


async def test_create_pool_with_explicit_settings_never_loads_another_surface(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        db_ro_dsn="postgresql://child",
        db_pool_min=1,
        db_pool_max=3,
        db_statement_timeout_ms=456,
    )
    captured: dict[str, Any] = {}

    async def fake_create_pool(dsn: str, **kwargs: Any) -> object:
        captured.update(dsn=dsn, **kwargs)
        return object()

    def unexpected_settings() -> None:
        raise AssertionError("explicit settings must be used as-is")

    monkeypatch.setattr(db, "get_settings", unexpected_settings)
    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    await db.create_pool(settings=settings)

    assert captured["dsn"] == "postgresql://child"
    assert captured["max_size"] == 3
    assert captured["server_settings"] == {"statement_timeout": "456"}
