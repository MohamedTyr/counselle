"""Checkpointer factory + the eng-review D3 schema assertion (ADR 0019)."""

from types import SimpleNamespace
from typing import Any

import psycopg
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.checkpointer import assert_checkpoint_schema, build_checkpointer, dsn_with_search_path

_OPTIONS = "options=-csearch_path%3Dcounselle,public"


# ---------------------------------------------------------------------------
# DSN handling
# ---------------------------------------------------------------------------


def test_dsn_without_query_gets_question_mark() -> None:
    dsn = "postgresql://app:pw@localhost:5432/ascensia"

    assert dsn_with_search_path(dsn) == f"{dsn}?{_OPTIONS}"


def test_dsn_with_existing_query_gets_ampersand() -> None:
    dsn = "postgresql://app:pw@localhost:5432/ascensia?sslmode=require"

    assert dsn_with_search_path(dsn) == f"{dsn}&{_OPTIONS}"


# ---------------------------------------------------------------------------
# D3 fail-fast assertion (fake connection — failure messages are the contract)
# ---------------------------------------------------------------------------


class _FakeCursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    async def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class _FakeConn:
    """Duck-types psycopg AsyncConnection.execute() with dict_row output."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    async def execute(self, sql: str) -> _FakeCursor:
        return _FakeCursor(self._rows)


def _row(schema: str, name: str) -> dict[str, Any]:
    return {"table_schema": schema, "table_name": name}


async def test_assertion_passes_when_all_tables_in_counselle() -> None:
    conn = _FakeConn([_row("counselle", "checkpoints"), _row("counselle", "checkpoint_writes")])

    await assert_checkpoint_schema(conn)  # must not raise


async def test_assertion_rejects_stray_table_outside_counselle() -> None:
    conn = _FakeConn([_row("counselle", "checkpoints"), _row("public", "checkpoints")])

    with pytest.raises(RuntimeError, match="outside the counselle schema") as exc:
        await assert_checkpoint_schema(conn)
    assert "public.checkpoints" in str(exc.value)


async def test_assertion_rejects_when_no_checkpoint_tables_exist() -> None:
    conn = _FakeConn([])

    with pytest.raises(RuntimeError, match="no checkpoint tables found in the counselle schema"):
        await assert_checkpoint_schema(conn)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


async def test_memory_mode_returns_in_memory_saver() -> None:
    settings = SimpleNamespace(checkpointer="memory", db_app_dsn="postgresql://unused")

    saver = await build_checkpointer(settings)

    assert isinstance(saver, InMemorySaver)


@pytest.mark.live_db
async def test_postgres_mode_sets_up_in_counselle_and_assertion_passes() -> None:
    # Arrange: the real app DSN from .env; postgres is the Settings default.
    from config.settings import get_settings

    settings = get_settings()
    assert settings.checkpointer == "postgres"

    # Act: the real saver setup runs (idempotent migrations) + the D3 assertion.
    saver = await build_checkpointer(settings)

    # Assert: postgres saver, and the checkpoint tables live in counselle.*.
    assert isinstance(saver, AsyncPostgresSaver)
    conn = saver.conn
    assert isinstance(conn, psycopg.AsyncConnection)
    try:
        cursor = await conn.execute(
            "SELECT table_schema FROM information_schema.tables WHERE table_name = 'checkpoints'"
        )
        schemas = [row["table_schema"] for row in await cursor.fetchall()]
        assert schemas == ["counselle"]
    finally:
        await conn.close()
