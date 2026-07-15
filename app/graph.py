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

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from uuid import UUID

import asyncpg
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent_node import run_agent_node
from app.run_handle import RunHandleStore
from app.state import TemporalContext, TurnState
from app.student_context import STUDENT_CONTEXT_UNAUTHENTICATED, build_student_context
from app.turn_persistence import AGENT_NODE
from config.settings import load_yaml_asset
from counselle_db.catalog import CalendarEntry, Catalog
from domain.season import Season, SeasonWindow, admission_season


@dataclass
class GraphDeps:
    """What the nodes need beyond state — passed via closure, never checkpointed."""

    catalog: Catalog
    app_pool: asyncpg.Pool | None = None  # counselle_app role (sessions, Slice F)
    run_handles: RunHandleStore | None = None


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
    await catalog.maybe_refresh()
    snapshot = catalog.snapshot
    calendar = [
        CalendarEntry(
            source="CDS",
            vintage=(
                f"Manifest {snapshot.current_version} (published {snapshot.published_at.date()})"
            ),
            cutoff_note="School values remain pinned to each selected CDS edition.",
        ),
        CalendarEntry(
            source="School profile",
            vintage=(
                f"Snapshots {snapshot.profile_snapshot_min} through {snapshot.profile_snapshot_max}"
            ),
            cutoff_note="Stable identity context only; not current annual institutional data.",
        ),
    ]
    return TemporalContext(
        today=today.isoformat(),
        season=season,
        data_calendar=calendar,
        context=_render_temporal(today, season, calendar),
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
        student_context = await _build_turn_student_context(state, deps.app_pool)
        return {
            "temporal": temporal.model_dump(mode="json"),
            "student_context": student_context,
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
