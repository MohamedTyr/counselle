"""The turn graph: ``prepare`` → ``agent`` → END (Phase 4 fixed point).

- ``prepare`` rebuilds the temporal context every turn: today's date, the
  admissions season (``domain.season`` over the ``season_calendar`` asset), and
  the current manifest and profile snapshot dates from the atomic catalog.
  It also rebuilds the student-context block (``app/student_context.py``) —
  profile + documents + memory for the turn's authenticated user, or the
  neutral unauthenticated line — never stale, never cached across turns.
- ``agent`` is one PydanticAI run with the tool loop (``app.agent_node``).
  Agent V1 does not mount a clarify tool; the graph stays ``prepare`` →
  ``agent`` → END.

Convention: ``thread_id = session_id`` — invoke with
``{"configurable": {"thread_id": session_id}}``; the checkpointer makes every
session durable (ADR 0019). Deps (catalog, pools) ride a closure, never state:
state must stay msgpack-plain (``app/state.py``).
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID

import asyncpg
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent_node import run_agent_node
from app.parked_sources import ParkedSourceStore
from app.prompt import render_data_picture
from app.run_handle import RunHandleStore
from app.state import TemporalContext, TurnState
from app.student_context import STUDENT_CONTEXT_UNAUTHENTICATED, build_student_context
from app.turn_persistence import AGENT_NODE
from config.settings import load_yaml_asset
from counselle_db.catalog import Catalog
from domain.season import Season, SeasonWindow, admission_season


@dataclass
class GraphDeps:
    """What the nodes need beyond state — passed via closure, never checkpointed."""

    catalog: Catalog
    app_pool: asyncpg.Pool | None = None  # counselle_app role (sessions, Slice F)
    run_handles: RunHandleStore | None = None
    parked_sources: ParkedSourceStore = field(default_factory=ParkedSourceStore)


def _render_temporal(today: date, season: Season) -> str:
    return f"Today is {today.isoformat()}. {season.cycle_note}"


_NO_CDS_DATA_PICTURE = (
    "Temporary demo mode: the CDS Library database is not connected. Do not use "
    "or claim access to resolve_school, get_school_profile, get_domain, or "
    "query_database. For school-specific facts, use available web search tools "
    "and say that the CDS-backed database is disabled for this demo."
)


async def build_temporal_context(catalog: Catalog, today: date | None = None) -> TemporalContext:
    """Assemble the per-turn temporal context (validated; dict-dumped into state)."""
    today = today or datetime.now().date()
    windows = [SeasonWindow.model_validate(row) for row in load_yaml_asset("season_calendar")]
    season = admission_season(today, windows)
    await catalog.maybe_refresh()
    return TemporalContext(
        today=today.isoformat(),
        season=season,
        context=_render_temporal(today, season),
    )


async def _build_turn_student_context(state: TurnState, app_pool: asyncpg.Pool | None) -> str:
    """The student-context block for this turn, or the neutral unauthenticated line.

    Mirrors the ADR 0013 mount gate agent tools already use: no ``user_id`` or
    no app pool (eval runner/CLI) means no student data is read, not an empty
    fabricated profile.
    """
    user_id = (state.get("turn_ids") or {}).get("user_id")
    if not user_id or app_pool is None:
        return STUDENT_CONTEXT_UNAUTHENTICATED
    return await build_student_context(app_pool, user_id=UUID(user_id))


def build_graph(checkpointer: Any, deps: GraphDeps) -> CompiledStateGraph[TurnState, Any, Any, Any]:
    """Compile the turn graph with the given checkpointer (postgres or memory)."""

    async def prepare(state: TurnState) -> dict[str, Any]:
        temporal = await build_temporal_context(deps.catalog)
        snapshot = getattr(deps.catalog, "snapshot", None)
        data_picture = (
            render_data_picture(snapshot)
            if snapshot is not None
            else (
                _NO_CDS_DATA_PICTURE
                if not getattr(getattr(deps, "settings", None), "cds_data_enabled", True)
                else state.get(
                    "data_picture", "Live data picture unavailable in this test harness."
                )
            )
        )
        student_context = await _build_turn_student_context(state, deps.app_pool)
        return {
            "temporal": temporal.model_dump(mode="json"),
            "student_context": student_context,
            "data_picture": data_picture,
        }

    async def agent(state: TurnState) -> dict[str, Any]:
        return await run_agent_node(state, deps)

    graph = StateGraph(TurnState)
    graph.add_node("prepare", prepare)
    graph.add_node(AGENT_NODE, agent)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", AGENT_NODE)
    graph.add_edge(AGENT_NODE, END)
    return graph.compile(checkpointer=checkpointer)
