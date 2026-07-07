"""Tests for the ToolSpec registry (Phase 4 D14)."""

from __future__ import annotations

from typing import Any

import counselle_db.server as db_server
from app.tool_specs import build_tool_specs, gateable_tool_names
from config.settings import load_yaml_asset
from domain.events import StepDetail

FUNCTION_TOOLS = {
    "search_web",
    "search_school_site",
    "search_reddit",
    "render_viz",
    "load_skill",
    "write_plan",
    "read_tool_result",
}


def _receipt(
    _tool_name: str, _args: dict[str, Any], _content: Any, _duration_ms: int, _context: Any
) -> StepDetail:
    return StepDetail()


def test_registry_covers_the_agent_tool_surface() -> None:
    labels = load_yaml_asset("step_labels")
    specs = build_tool_specs(labels, _receipt)
    mcp_tools = {tool.name for tool in db_server.mcp._tool_manager.list_tools()}

    assert set(specs) == mcp_tools | FUNCTION_TOOLS
    assert "ask_student" not in specs


def test_registry_labels_resolve_and_gated_set_is_derived() -> None:
    labels = load_yaml_asset("step_labels")
    specs = build_tool_specs(labels, _receipt)

    assert all(spec.label == labels["tools"][name]["label"] for name, spec in specs.items())
    assert gateable_tool_names(specs) == {
        "search_web",
        "search_school_site",
        "search_reddit",
    }
