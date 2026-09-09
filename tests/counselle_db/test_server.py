"""Unit tests for `tool_errors` (the D6 safe-error formatter).

Moved here from the retired `counselle_db/server.py` MCP shell
(school-data-v3 Phase 3): `tool_errors` itself lives in
`counselle_db.service` and is what `app/toolset.py`'s in-process tools use,
so these behavioral tests still describe live code even though the MCP
server they used to import through is gone.
"""

from __future__ import annotations

from counselle_db import service
from counselle_db.service import tool_errors


async def test_tool_errors_returns_d6_error_shape() -> None:
    async def fails() -> None:
        raise service.ServiceError("unknown field key: 'bad.key'")

    result = await tool_errors(fails)()

    assert result["error"] == "tool_error"
    assert result["root_cause"] == "unknown field key: 'bad.key'"
    assert result["safe_retry"]
    assert "db-recipes" not in result["safe_retry"]
    assert result["stop_condition"]


async def test_tool_errors_gives_manifest_rejections_the_canonical_recovery() -> None:
    messages = (
        (
            "Manifest metric references require exact structural JSON membership, "
            "not a text substring search."
        ),
        "Only exact bound manifest metric membership JSONPath is allowed.",
        "Manifest JSON helper functions are restricted to exact membership.",
    )
    for message in messages:
        async def fails(message: str = message) -> None:
            raise service.ServiceError(message)

        result = await tool_errors(fails)()

        assert "db-recipes" in result["safe_retry"]
        assert "exact structural manifest membership query" in result["safe_retry"]
        assert "bound parameter" in result["safe_retry"]
        assert "SELECT" not in result["safe_retry"]


async def test_tool_errors_gives_ranking_rejections_the_selected_document_recipe() -> None:
    async def fails() -> None:
        raise service.ServiceError(
            "Cross-school packet rankings require canonical selected-document semantics: "
            "use the db-recipes DISTINCT ON selected-per-school CTE."
        )

    result = await tool_errors(fails)()

    assert "db-recipes" in result["safe_retry"]
    assert "selected-per-school ranking CTE" in result["safe_retry"]
    assert "school_id + document_id" in result["safe_retry"]
    assert "manifest" not in result["safe_retry"]


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
