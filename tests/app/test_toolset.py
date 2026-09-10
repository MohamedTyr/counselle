"""Unit tests for app/toolset.py — per-request toolset assembly. No network/LLM.

The Tavily client is a stub; the factory is instrumented so the tests can
assert a disabled source's machinery is NEVER constructed (ADR 0013).
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any

from pydantic_ai import Tool

from app.sources import SourceRegistry
from app.tool_specs import build_tool_specs, gateable_tool_names
from app.toolset import (
    ESSAY_SURFACE_DENIED_DB_TOOLS,
    GATEABLE_TOOLS,
    ToolDeps,
    _allowed_subreddits,
    build_db_tools,
    build_tools,
)
from domain.events import StepDetail
from domain.specs import SourceConfig
from domain.surface import Surface

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
        include_domains = kwargs.get("include_domains") or []
        url = (
            f"https://{include_domains[0]}/a"
            if include_domains and str(include_domains[0]).startswith("reddit.com/r/")
            else "https://example.com/a"
        )
        return {
            "query": query,
            "results": [{"title": "A result", "url": url, "content": "snippet"}],
        }


class Rig:
    """One toolset-build fixture: instrumented factory + registry + deps."""

    def __init__(self) -> None:
        self.factory_calls = 0
        self.client = StubTavilyClient()
        self.registry = SourceRegistry()
        self.deps = ToolDeps(
            catalog=SimpleNamespace(school_count=1),
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
        assert rig.registry.entries[0].citation.tier == "community"

    async def test_search_reddit_passes_allowlisted_domains(self) -> None:
        rig = Rig()
        search_reddit = _fn(rig.build(_config()), "search_reddit")

        payload = await search_reddit(query="dorms", subreddits=["chanceme"])

        assert payload["results"][0]["marker"] == "[1]"
        assert rig.client.calls[0]["include_domains"] == ["reddit.com/r/chanceme"]
        assert rig.registry.entries[0].citation.source == "reddit"

    async def test_search_web_excludes_reddit_when_reddit_source_disabled(self) -> None:
        # Reddit off must mean NO reddit content anywhere — the open web search
        # excludes Reddit-owned domains in code, not prompt (ADR 0013; live test 5).
        rig = Rig()
        search_web = _fn(rig.build(_config(reddit=False)), "search_web")

        await search_web(query="pitzer dorms reddit")

        assert rig.client.calls[0]["exclude_domains"] == ["reddit.com", "redd.it"]

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
# get_facts argument contract
# ---------------------------------------------------------------------------


class TestGetFactsArgumentContract:
    async def test_sections_and_keys_together_is_a_clear_tool_error(self) -> None:
        # get_facts documents "at most one of sections or keys" -- passing
        # both must never silently prefer sections and drop keys.
        get_facts = _fn(build_db_tools(catalog=None), "get_facts")

        payload = await get_facts(unitid=1, sections=["getting-in"], keys=["identity.address"])

        assert payload["error"] == "tool_error"
        assert "not both" in payload["root_cause"]


# ---------------------------------------------------------------------------
# Essay surface DB-tool narrowing (ADR 0037 Part 0 C7 / ADR 0013)
# ---------------------------------------------------------------------------


class TestEssaySurfaceDbToolNarrowing:
    def test_chat_surface_gets_all_four_db_tools(self) -> None:
        tools = build_db_tools(catalog=None, surface=Surface.CHAT)

        names = {tool.name for tool in tools}
        assert names == {
            "resolve_school",
            "get_school_profile",
            "get_facts",
            "query_database",
        }

    def test_essay_surface_never_constructs_the_metric_heavy_tools(self) -> None:
        """Unmounted, not hidden (ADR 0013): the essay surface must not even
        construct get_facts/query_database, never mind deny them at call time."""
        tools = build_db_tools(catalog=None, surface=Surface.ESSAY)

        names = {tool.name for tool in tools}
        assert names == {"resolve_school", "get_school_profile"}
        assert names.isdisjoint(ESSAY_SURFACE_DENIED_DB_TOOLS)
