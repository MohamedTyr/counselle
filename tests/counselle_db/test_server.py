"""Unit tests for the counselle-db MCP server wrapper layer."""

from __future__ import annotations

from counselle_db import service
from counselle_db.server import tool_errors


async def test_tool_errors_returns_d6_error_shape() -> None:
    async def fails() -> None:
        raise service.ServiceError("unknown field key: 'bad.key'")

    result = await tool_errors(fails)()

    assert result["error"] == "tool_error"
    assert result["root_cause"] == "unknown field key: 'bad.key'"
    assert result["safe_retry"]
    assert result["stop_condition"]


async def test_tool_errors_wraps_unexpected_exceptions() -> None:
    async def fails() -> None:
        raise RuntimeError("function similarity(text, unknown) does not exist")

    result = await tool_errors(fails)()

    assert result["error"] == "tool_error"
    assert "database tool failed" in result["root_cause"]
    assert result["safe_retry"]
    assert result["stop_condition"]


async def test_tool_errors_redacts_secret_shaped_root_cause() -> None:
    async def fails() -> None:
        raise RuntimeError("postgresql://user:secret@localhost/db")

    result = await tool_errors(fails)()

    assert "postgresql://" not in result["root_cause"]
    assert "secret" not in result["root_cause"]
    assert result["root_cause"] == "database tool failed without a shareable error message"
