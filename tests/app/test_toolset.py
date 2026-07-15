"""Unit tests for app/toolset.py — per-request toolset assembly. No network/LLM.

The Tavily client is a stub; the factory is instrumented so the tests can
assert a disabled source's machinery is NEVER constructed (ADR 0013).
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic_ai import Tool
from pydantic_ai.mcp import MCPToolset

from app.sources import SourceRegistry
from app.tool_specs import build_tool_specs, gateable_tool_names
from app.toolset import (
    _DEFAULT_AGENT_MCP_READ_TIMEOUT_SECONDS,
    GATEABLE_TOOLS,
    ToolDeps,
    _allowed_subreddits,
    annotate_mcp_result,
    build_mcp_toolset,
    build_tools,
)
from domain.envelope import Citation, CitationEnvelope
from domain.events import StepDetail
from domain.specs import SourceConfig

TODAY = date(2026, 6, 10)
MENU = ["ApplyingToCollege", "chanceme", "financialaid", "{school}"]

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class StubTavilyClient:
    """Minimal async stand-in for AsyncTavilyClient — captures call kwargs."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def search(self, query: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"query": query, **kwargs})
        return {
            "query": query,
            "results": [
                {"title": "A result", "url": "https://example.com/a", "content": "snippet"}
            ],
        }


class Rig:
    """One toolset-build fixture: instrumented factory + registry + deps."""

    def __init__(self) -> None:
        self.factory_calls = 0
        self.client = StubTavilyClient()
        self.registry = SourceRegistry()
        self.deps = ToolDeps(
            catalog=None,
            search_max_results=5,
            subreddit_menu=list(MENU),
            tavily_client_factory=self._factory,
        )

    def _factory(self) -> StubTavilyClient:
        self.factory_calls += 1
        return self.client

    def build(self, config: SourceConfig, **kwargs: Any) -> list[Tool[Any]]:
        return build_tools(config, self.deps, self.registry, TODAY, **kwargs)


def _config(**overrides: Any) -> SourceConfig:
    base: dict[str, Any] = {"web": True, "reddit": True, "edu": True}
    base.update(overrides)
    return SourceConfig(**base)


def _names(tools: list[Tool[Any]]) -> set[str]:
    return {tool.name for tool in tools}


def _tool(tools: list[Tool[Any]], name: str) -> Tool[Any]:
    return next(tool for tool in tools if tool.name == name)


def _fn(tools: list[Tool[Any]], name: str) -> Any:
    """The tool's underlying function, untyped so tests can call it with kwargs."""
    return _tool(tools, name).function


def _receipt(
    _tool_name: str, _args: dict[str, Any], _content: Any, _duration_ms: int, _context: Any
) -> StepDetail:
    return StepDetail()


# ---------------------------------------------------------------------------
# Source gating (ADR 0013)
# ---------------------------------------------------------------------------


class TestSourceGating:
    def test_gateable_tools_come_from_tool_specs(self) -> None:
        from config.settings import load_yaml_asset

        specs = build_tool_specs(load_yaml_asset("step_labels"), _receipt)

        assert gateable_tool_names(specs) == GATEABLE_TOOLS

    def test_all_enabled_builds_all_three_tools(self) -> None:
        rig = Rig()
        tools = rig.build(_config())
        assert _names(tools) == {"search_web", "search_school_site", "search_reddit"}
        assert rig.factory_calls == 1  # one shared client

    def test_reddit_disabled_means_no_reddit_tool(self) -> None:
        rig = Rig()
        tools = rig.build(_config(reddit=False))
        assert "search_reddit" not in _names(tools)
        assert _names(tools) == {"search_web", "search_school_site"}

    def test_web_disabled_means_no_search_web(self) -> None:
        rig = Rig()
        tools = rig.build(_config(web=False))
        assert "search_web" not in _names(tools)

    def test_edu_disabled_means_no_school_site_tool(self) -> None:
        rig = Rig()
        tools = rig.build(_config(edu=False))
        assert "search_school_site" not in _names(tools)

    def test_all_disabled_builds_nothing_and_never_touches_tavily(self) -> None:
        rig = Rig()
        tools = rig.build(_config(web=False, reddit=False, edu=False))
        assert tools == []
        assert rig.factory_calls == 0  # disabled → never constructed (ADR 0013)

    def test_extra_tools_are_appended(self) -> None:
        async def render_viz() -> dict[str, Any]:
            """Slice D stand-in."""
            return {"ok": True}

        rig = Rig()
        extra = Tool(render_viz, takes_ctx=False)
        tools = rig.build(_config(web=False, reddit=False, edu=False), extra_tools=[extra])
        assert tools == [extra]


# ---------------------------------------------------------------------------
# Tool behavior: annotation through the registry
# ---------------------------------------------------------------------------


class TestToolAnnotation:
    async def test_search_web_results_carry_markers_and_fill_registry(self) -> None:
        rig = Rig()
        search_web = _fn(rig.build(_config()), "search_web")

        payload = await search_web(query="duke dorms")

        assert payload["results"][0]["marker"] == "[1]"
        assert len(rig.registry) == 1
        assert rig.registry.entries[0].label == "A result"
        assert rig.registry.entries[0].citation.tier == "official"

    async def test_search_reddit_passes_allowlisted_domains(self) -> None:
        rig = Rig()
        search_reddit = _fn(rig.build(_config()), "search_reddit")

        payload = await search_reddit(query="dorms", subreddits=["chanceme"])

        assert payload["results"][0]["marker"] == "[1]"
        assert rig.client.calls[0]["include_domains"] == ["reddit.com/r/chanceme"]
        assert rig.registry.entries[0].citation.source == "reddit"

    async def test_search_web_excludes_reddit_when_reddit_source_disabled(self) -> None:
        # Reddit off must mean NO reddit content anywhere — the open web search
        # excludes reddit.com in code, not prompt (ADR 0013; live test 5).
        rig = Rig()
        search_web = _fn(rig.build(_config(reddit=False)), "search_web")

        await search_web(query="pitzer dorms reddit")

        assert rig.client.calls[0]["exclude_domains"] == ["reddit.com"]

    async def test_search_web_does_not_exclude_reddit_when_enabled(self) -> None:
        rig = Rig()
        search_web = _fn(rig.build(_config()), "search_web")

        await search_web(query="pitzer dorms")

        assert rig.client.calls[0]["exclude_domains"] is None


# ---------------------------------------------------------------------------
# Reddit allowlist filtering
# ---------------------------------------------------------------------------


class TestRedditAllowlist:
    def test_no_filter_means_full_menu(self) -> None:
        assert _allowed_subreddits(MENU, None) == MENU

    def test_filter_keeps_only_requested_menu_subs(self) -> None:
        assert _allowed_subreddits(MENU, ["chanceme", "NotOnMenu"]) == ["chanceme"]

    def test_filter_is_case_insensitive(self) -> None:
        assert _allowed_subreddits(MENU, ["CHANCEME"]) == ["chanceme"]

    def test_filter_drops_the_school_slot_unless_named(self) -> None:
        assert "{school}" not in _allowed_subreddits(MENU, ["chanceme"])
        assert "{school}" in _allowed_subreddits(MENU, ["{school}"])

    async def test_out_of_allowlist_sub_is_rejected_by_the_tool(self) -> None:
        rig = Rig()
        config = _config(reddit_subreddits=["chanceme"])
        search_reddit = _fn(rig.build(config), "search_reddit")

        payload = await search_reddit(query="dorms", subreddits=["ApplyingToCollege"])

        assert "error" in payload
        assert rig.client.calls == []  # rejected before any search
        assert len(rig.registry) == 0

    async def test_allowlisted_sub_goes_through(self) -> None:
        rig = Rig()
        config = _config(reddit_subreddits=["chanceme"])
        search_reddit = _fn(rig.build(config), "search_reddit")

        payload = await search_reddit(query="dorms", subreddits=["chanceme"])

        assert payload["results"][0]["marker"] == "[1]"


# ---------------------------------------------------------------------------
# The counselle-db MCP toolset wiring
# ---------------------------------------------------------------------------


class TestMcpToolset:
    def test_build_mcp_toolset_wires_stdio_child_and_registry_hook(self) -> None:
        settings = SimpleNamespace(
            db_ro_dsn="postgresql://ro@localhost:5432/pipeline",
            db_app_dsn="postgresql://app@localhost:5432/pipeline",
            agent_mcp_read_timeout_s=60.0,
        )

        toolset = build_mcp_toolset(settings)

        assert isinstance(toolset, MCPToolset)
        assert toolset.id == "counselle-db"
        assert toolset.process_tool_call is annotate_mcp_result
        transport = toolset.client.transport
        assert transport.command == "uv"
        assert transport.args == ["run", "python", "-m", "counselle_db.server"]
        # The child env does NOT inherit the parent env (notes §2) — the DSNs
        # must be passed explicitly.
        assert transport.env["COUNSELLE_DB_RO_DSN"] == settings.db_ro_dsn
        assert transport.env["COUNSELLE_SETTINGS_NO_ENV_FILE"] == "1"
        assert "COUNSELLE_DB_APP_DSN" not in transport.env

    def test_build_mcp_toolset_carries_bounded_read_timeout(self) -> None:
        """A dead MCP child must not hang tool calls forever (fix 2).

        MCPToolset passes read_timeout to the FastMCP Client as ``timeout``,
        which is normalized to a timedelta and stored in
        ``client._session_kwargs["read_timeout_seconds"]``.
        """
        from datetime import timedelta

        settings = SimpleNamespace(
            db_ro_dsn="postgresql://ro@localhost:5432/pipeline",
            db_app_dsn="postgresql://app@localhost:5432/pipeline",
            agent_mcp_read_timeout_s=60.0,
        )

        toolset = build_mcp_toolset(settings)

        # FastMCP Client normalizes the float to a timedelta in _session_kwargs.
        read_timeout_val = toolset.client._session_kwargs.get("read_timeout_seconds")
        assert read_timeout_val is not None, "_session_kwargs must carry read_timeout_seconds"
        # Accept either float or timedelta (depends on fastmcp version).
        if isinstance(read_timeout_val, timedelta):
            assert read_timeout_val.total_seconds() == _DEFAULT_AGENT_MCP_READ_TIMEOUT_SECONDS
        else:
            assert float(read_timeout_val) == _DEFAULT_AGENT_MCP_READ_TIMEOUT_SECONDS

    def test_build_mcp_toolset_does_not_forward_tavily_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The Tavily key must NEVER reach the MCP child (fix 5)."""
        monkeypatch.setenv("COUNSELLE_TAVILY_API_KEY", "tvly-secret")
        monkeypatch.setenv("COUNSELLE_DB_RO_DSN", "postgresql://ro@localhost/pipeline")
        settings = SimpleNamespace(
            db_ro_dsn="postgresql://ro@localhost:5432/pipeline",
            db_app_dsn="postgresql://app@localhost:5432/pipeline",
            agent_mcp_read_timeout_s=60.0,
        )

        toolset = build_mcp_toolset(settings)
        env = toolset.client.transport.env

        assert "COUNSELLE_TAVILY_API_KEY" not in env
        # DSNs must still be there
        assert env["COUNSELLE_DB_RO_DSN"] == settings.db_ro_dsn
        assert "COUNSELLE_DB_APP_DSN" not in env

    async def test_annotate_mcp_result_routes_through_the_deps_registry(self) -> None:
        registry = SourceRegistry()
        ctx = SimpleNamespace(deps=SimpleNamespace(registry=registry))
        envelope = CitationEnvelope(
            field="admissions.acceptance_rate",
            label="Acceptance rate",
            display="6%",
            raw=0.06,
            available=True,
            unit="percent",
            citation=Citation(
                source="web",
                tier="official",
                vintage="Retrieved 2026-01-01",
                url="https://example.edu/admissions",
            ),
        ).model_dump(mode="json")

        async def call_tool(name: str, args: dict[str, Any], *, metadata: Any = None) -> Any:
            return [envelope]

        result: Any = await annotate_mcp_result(ctx, call_tool, "get_values", {})  # type: ignore[arg-type]

        assert result[0]["marker"] == "[1]"
        assert len(registry) == 1

    async def test_annotate_mcp_result_without_registry_passes_through(self) -> None:
        ctx = SimpleNamespace(deps=SimpleNamespace())

        async def call_tool(name: str, args: dict[str, Any], *, metadata: Any = None) -> Any:
            return {"ok": True}

        result = await annotate_mcp_result(ctx, call_tool, "get_data_calendar", {})  # type: ignore[arg-type]

        assert result == {"ok": True}
