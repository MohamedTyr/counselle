"""Unit tests for the StepMapper (app/steps.py) — labels, receipts, errors (B1a).

Table-driven against ``config/assets/step_labels.yaml``: one row per tool the
agent can call, plus exhaustiveness against the live tool surface (the MCP
server's registered names + the function tools), the no-unfilled-templates
net, and the receipts-never-carry-secrets house rule. No DB, no network.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic_ai.messages import RetryPromptPart

import counselle_db.server as db_server
from app.steps import StepMapper
from config.settings import load_yaml_asset

# The function tools mounted directly on the agent (app/toolset.py +
# app/agent_node.py). ask_student is deliberately NOT here — it is
# interrupt-backed and excluded from the timeline.
FUNCTION_TOOLS = {"search_web", "search_school_site", "search_reddit", "render_viz", "load_skill"}

_SCHOOL_NAMES = {198419: "Duke University", 221999: "Vanderbilt University"}


def _resolve(unitid: int) -> str | None:
    return _SCHOOL_NAMES.get(unitid)


@pytest.fixture(scope="module")
def labels() -> dict[str, Any]:
    loaded = load_yaml_asset("step_labels")
    assert isinstance(loaded, dict)
    return loaded


@pytest.fixture(scope="module")
def mapper(labels: dict[str, Any]) -> StepMapper:
    return StepMapper(labels, _resolve)


# ---------------------------------------------------------------------------
# map_call: one row per tool in the asset
# ---------------------------------------------------------------------------

# (tool, representative args, expected kind, expected tier, label must contain)
_MAP_CALL_TABLE: list[tuple[str, dict[str, Any], str, str | None, list[str]]] = [
    ("resolve_school", {"query": "duke"}, "db_tool", "official", ["duke"]),
    (
        "get_values",
        {"unitid": 198419, "field_keys": ["admissions.acceptance_rate", "admissions.sat_25"]},
        "db_tool",
        "official",
        ["Duke University", "admissions"],
    ),
    ("get_dossier", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    (
        "compare_schools",
        {"unitids": [198419, 221999], "field_keys": ["admissions.acceptance_rate"]},
        "db_tool",
        "official",
        ["Duke University", "Vanderbilt University"],
    ),
    ("find_schools", {"criteria": {"state": "NC"}}, "db_tool", "official", ["database"]),
    (
        "national_benchmark",
        {"field_key": "admissions.acceptance_rate"},
        "db_tool",
        "official",
        ["acceptance rate"],
    ),
    ("get_programs", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    ("get_diversity", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    ("get_data_calendar", {}, "db_tool", "official", ["fresh"]),
    ("search_fields", {"query": "early decision"}, "db_tool", "official", ["early decision"]),
    ("query_database", {"sql": "SELECT 1"}, "sql", "official", ["query"]),
    ("search_web", {"query": "duke dorms"}, "web_search", None, ["duke dorms"]),
    (
        "search_school_site",
        {"unitid": 198419, "query": "housing"},
        "edu_search",
        "official",
        ["Duke University", "housing"],
    ),
    (
        "search_reddit",
        {"query": "dorms", "subreddits": ["ApplyingToCollege"]},
        "reddit_search",
        "community",
        ["r/ApplyingToCollege"],
    ),
    (
        "render_viz",
        {"type": "comparison_table", "unitids": [198419, 221999]},
        "viz",
        None,
        ["comparison table"],
    ),
    ("load_skill", {"name": "essay-brainstorm"}, "skill", None, ["essay-brainstorm"]),
]


@pytest.mark.parametrize(
    ("tool", "args", "kind", "tier", "contains"),
    _MAP_CALL_TABLE,
    ids=[row[0] for row in _MAP_CALL_TABLE],
)
def test_map_call_kind_tier_and_label(
    mapper: StepMapper,
    tool: str,
    args: dict[str, Any],
    kind: str,
    tier: str | None,
    contains: list[str],
) -> None:
    mapped = mapper.map_call(tool, args)

    assert mapped.kind == kind
    assert mapped.tier == tier
    for needle in contains:
        assert needle in mapped.label, f"{tool}: {needle!r} not in {mapped.label!r}"
    assert "{" not in mapped.label and "}" not in mapped.label


def test_map_call_table_covers_every_yaml_row(labels: dict[str, Any]) -> None:
    """The parametrized table above exercises every tool row in the asset."""
    assert {row[0] for row in _MAP_CALL_TABLE} == set(labels["tools"])


# ---------------------------------------------------------------------------
# Exhaustiveness against the live tool surface
# ---------------------------------------------------------------------------


def test_yaml_covers_every_agent_tool(labels: dict[str, Any]) -> None:
    """Every tool the agent can call has a label row — no step ever falls to
    the generic default in production (the asset and the surface move together)."""
    mcp_tools = {tool.name for tool in db_server.mcp._tool_manager.list_tools()}
    assert mcp_tools, "MCP tool registry introspection returned nothing"

    surface = mcp_tools | FUNCTION_TOOLS
    missing = surface - set(labels["tools"])
    assert not missing, f"tools with no step_labels row: {sorted(missing)}"


def test_ask_student_is_not_in_the_asset(labels: dict[str, Any]) -> None:
    """ask_student is interrupt-backed: excluded from the timeline, so no row."""
    assert "ask_student" not in labels["tools"]


def test_unknown_tool_maps_to_default_row_without_braces(mapper: StepMapper) -> None:
    mapped = mapper.map_call("some_future_tool", {})

    assert mapped.kind == "db_tool"
    assert "some_future_tool" in mapped.label
    assert "{" not in mapped.label and "}" not in mapped.label


# ---------------------------------------------------------------------------
# No unfilled templates: empty args never leak `{key}` to the student
# ---------------------------------------------------------------------------


def test_every_row_with_empty_args_has_no_braces(
    labels: dict[str, Any], mapper: StepMapper
) -> None:
    for tool in [*labels["tools"], "totally_unknown_tool"]:
        label = mapper.map_call(tool, {}).label
        assert "{" not in label and "}" not in label, f"{tool}: unfilled template {label!r}"


# ---------------------------------------------------------------------------
# error_label: the three failure classes
# ---------------------------------------------------------------------------


def test_error_label_retry_class(mapper: StepMapper) -> None:
    mapped = mapper.map_call("get_values", {"unitid": 198419})

    label = mapper.error_label(mapped, retry=True)

    assert label == f"{mapped.label} — the request needed a correction"


def test_error_label_search_failed_class(mapper: StepMapper) -> None:
    for tool in ("search_web", "search_school_site", "search_reddit"):
        mapped = mapper.map_call(tool, {"query": "dorms"})

        label = mapper.error_label(mapped, retry=False)

        assert label == f"{mapped.label} — source unavailable"


def test_error_label_tool_failed_class(mapper: StepMapper) -> None:
    for tool in ("get_values", "query_database", "render_viz", "load_skill"):
        mapped = mapper.map_call(tool, {})

        label = mapper.error_label(mapped, retry=False)

        assert label == f"{mapped.label} — failed"


# ---------------------------------------------------------------------------
# result_is_error: result-shape detection
# ---------------------------------------------------------------------------


def test_result_is_error_retry_prompt_part() -> None:
    part = RetryPromptPart(content="bad args", tool_name="get_values", tool_call_id="c1")

    assert StepMapper.result_is_error(part, None) is True


def test_result_is_error_error_dict() -> None:
    assert StepMapper.result_is_error(object(), {"error": "rate limited"}) is True


def test_result_is_error_normal_shapes_are_fine() -> None:
    assert StepMapper.result_is_error(object(), {"results": []}) is False
    assert StepMapper.result_is_error(object(), [{"value": 1}]) is False
    assert StepMapper.result_is_error(object(), None) is False


# ---------------------------------------------------------------------------
# detail_for: the expandable receipts
# ---------------------------------------------------------------------------


def test_detail_for_search_kind_counts_and_domains(mapper: StepMapper) -> None:
    content = {
        "results": [
            {"url": "https://www.niche.com/x"},
            {"url": "https://reddit.com/y"},
            {"url": "https://www.niche.com/z"},  # dupe domain — deduped
        ]
    }

    detail = mapper.detail_for("search_web", {"query": "duke dorms"}, content, 120)

    assert detail.query == "duke dorms"
    assert detail.result_count == 3
    assert detail.domains == ["niche.com", "reddit.com"]
    assert detail.duration_ms == 120


def test_detail_for_sql_kind_carries_statement_and_row_count(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "query_database",
        {"sql": "SELECT unitid FROM schools WHERE state = $1"},
        {"rows": [[1], [2], [3]]},
        45,
    )

    assert detail.query == "SELECT unitid FROM schools WHERE state = $1"
    assert detail.row_count == 3
    assert detail.tool == "query_database"


def test_detail_for_db_tool_kind(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "get_values",
        {"unitid": 198419, "field_keys": ["admissions.acceptance_rate", "admissions.sat_25"]},
        [{"field": "a"}, {"field": "b"}],
        80,
    )

    assert detail.tool == "get_values"
    assert detail.field_keys == ["admissions.acceptance_rate", "admissions.sat_25"]
    assert detail.row_count == 2
    assert detail.schools == ["Duke University"]


def test_detail_for_viz_kind(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "render_viz", {"type": "score_band", "unitids": [221999]}, {"ok": True}, 10
    )

    assert detail.viz_type == "score_band"
    assert detail.schools == ["Vanderbilt University"]


def test_receipts_never_carry_secrets(mapper: StepMapper, labels: dict[str, Any]) -> None:
    """Every kind's receipt, built from realistic args AND a content payload that
    deliberately contains secret-shaped junk, must serialize none of it."""
    poisoned_content = {
        "results": [{"url": "https://www.niche.com/x"}],
        "rows": [[1]],
        "dsn": "postgresql://counselle_ro:password@localhost:5432/pipeline",
        "api_key": "tvly-dev-abcdef1234567890",
        "password": "hunter2",
    }
    forbidden = ("postgresql://", "dsn", "password", "api_key", "tvly-")
    for tool, args, _kind, _tier, _contains in _MAP_CALL_TABLE:
        detail = mapper.detail_for(tool, args, poisoned_content, 5)

        serialized = json.dumps(detail.model_dump())
        for needle in forbidden:
            assert needle not in serialized, f"{tool}: receipt leaked {needle!r}: {serialized}"


def test_receipts_never_carry_error_message_dsn(mapper: StepMapper) -> None:
    """An ``{"error": …}`` result whose message embeds a DSN must not reach any
    detail field — error text is for labels (via error_label), never receipts."""
    error_content = {"error": "postgresql://counselle_ro:secret@localhost/pipeline"}
    for tool, args, _kind, _tier, _contains in _MAP_CALL_TABLE:
        detail = mapper.detail_for(tool, args, error_content, 5)

        serialized = json.dumps(detail.model_dump())
        for needle in ("postgresql://", "counselle_ro", "secret"):
            assert needle not in serialized, f"{tool}: receipt leaked {needle!r}: {serialized}"
