"""The turn graph: ``prepare`` → (route) → ``agent`` → END
OR ``prepare`` → ``research_plan`` → ... → END (deep research subgraph).

Deep research is disabled by default (``settings.deep_research_enabled = False``).
The routing function checks the flag, the arm signal, and falls back to a
lightweight heuristic before routing to normal chat.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import asyncpg
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    UserPromptPart,
)

from app.agent_node import run_agent_node
from app.research.gather_db import research_gather_db_node
from app.research.gather_external import research_gather_external_node
from app.research.plan import research_plan_node
from app.research.routing import explicit_deep_research, looks_like_research
from app.research.synthesize import research_synthesize_node
from app.research.verify import research_verify_node
from app.state import TemporalContext, TurnState
from app.turn_persistence import AGENT_NODE
from config.settings import get_settings, load_yaml_asset
from counselle_db.catalog import CalendarEntry, Catalog
from counselle_db.service import get_data_calendar
from domain.season import Season, SeasonWindow, admission_season

RESEARCH_PLAN_NODE = "research_plan"
RESEARCH_GATHER_DB_NODE = "research_gather_db"
RESEARCH_GATHER_EXTERNAL_NODE = "research_gather_external"
RESEARCH_VERIFY_NODE = "research_verify"
RESEARCH_SYNTHESIZE_NODE = "research_synthesize"


@dataclass
class GraphDeps:
    """What the nodes need beyond state — passed via closure, never checkpointed."""

    catalog: Catalog
    app_pool: asyncpg.Pool | None = None  # counselle_app role (sessions, Slice F)


def _render_temporal(today: date, season: Season, calendar: list[CalendarEntry]) -> str:
    """The prompt block: today + cycle phase + what each source knows (§16)."""
    lines = [f"Today is {today.isoformat()}. {season.cycle_note}", "Data calendar:"]
    lines += [f"- {entry.source}: {entry.vintage} — {entry.cutoff_note}" for entry in calendar]
    return "\n".join(lines)


async def build_temporal_context(catalog: Catalog, today: date | None = None) -> TemporalContext:
    """Assemble the per-turn temporal context (validated; dict-dumped into state)."""
    today = today or datetime.now().date()
    windows = [SeasonWindow.model_validate(row) for row in load_yaml_asset("season_calendar")]
    season = admission_season(today, windows)
    calendar = await get_data_calendar(catalog)
    return TemporalContext(
        today=today.isoformat(),
        season=season,
        data_calendar=calendar,
        context=_render_temporal(today, season, calendar),
    )


def _extract_last_user_text(messages: list[dict[str, Any]]) -> str:
    """Pull the last user prompt text from serialized state messages."""
    try:
        parsed = ModelMessagesTypeAdapter.validate_python(messages)
        for msg in reversed(parsed):
            if not isinstance(msg, ModelRequest):
                continue
            for part in msg.parts:
                if isinstance(part, UserPromptPart):
                    return str(part.content)
    except Exception:
        pass
    return ""


def build_graph(
    checkpointer: Any, deps: GraphDeps
) -> CompiledStateGraph[TurnState, Any, Any, Any]:
    """Compile the turn graph with the given checkpointer (postgres or memory)."""
    settings = get_settings()

    async def prepare(state: TurnState) -> dict[str, Any]:
        temporal = await build_temporal_context(deps.catalog)
        return {"temporal": temporal.model_dump(mode="json")}

    async def agent(state: TurnState) -> dict[str, Any]:
        return await run_agent_node(state, deps)

    async def research_plan(state: TurnState) -> dict[str, Any]:
        return await research_plan_node(state, deps)

    async def research_gather_db(state: TurnState) -> dict[str, Any]:
        return await research_gather_db_node(state, deps)

    async def research_gather_external(state: TurnState) -> dict[str, Any]:
        return await research_gather_external_node(state, deps)

    async def research_verify(state: TurnState) -> dict[str, Any]:
        return await research_verify_node(state, deps)

    async def research_synthesize(state: TurnState) -> dict[str, Any]:
        return await research_synthesize_node(state, deps)

    def _route(state: TurnState) -> str:
        if not settings.deep_research_enabled:
            return "agent"
        if state.get("deep_research_armed"):
            return "research"
        messages = list(state.get("messages") or [])
        if not messages:
            return "agent"
        text = _extract_last_user_text(messages)
        if not text:
            return "agent"
        if explicit_deep_research(text) or looks_like_research(text):
            return "research"
        return "agent"

    def _plan_branch(state: TurnState) -> str:
        return (state.get("research") or {}).get("branch") or "cancel"

    graph = StateGraph(TurnState)
    graph.add_node("prepare", prepare)
    graph.add_node(AGENT_NODE, agent)
    graph.add_node(RESEARCH_PLAN_NODE, research_plan)
    graph.add_node(RESEARCH_GATHER_DB_NODE, research_gather_db)
    graph.add_node(RESEARCH_GATHER_EXTERNAL_NODE, research_gather_external)
    graph.add_node(RESEARCH_VERIFY_NODE, research_verify)
    graph.add_node(RESEARCH_SYNTHESIZE_NODE, research_synthesize)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare",
        _route,
        {"agent": AGENT_NODE, "research": RESEARCH_PLAN_NODE},
    )
    graph.add_conditional_edges(
        RESEARCH_PLAN_NODE,
        _plan_branch,
        {"run": RESEARCH_GATHER_DB_NODE, "cancel": END},
    )
    graph.add_edge(RESEARCH_GATHER_DB_NODE, RESEARCH_GATHER_EXTERNAL_NODE)
    graph.add_edge(RESEARCH_GATHER_EXTERNAL_NODE, RESEARCH_VERIFY_NODE)
    graph.add_edge(RESEARCH_VERIFY_NODE, RESEARCH_SYNTHESIZE_NODE)
    graph.add_edge(RESEARCH_SYNTHESIZE_NODE, END)
    graph.add_edge(AGENT_NODE, END)

    return graph.compile(checkpointer=checkpointer)
