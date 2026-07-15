"""Eng-review D6: checkpointed agent turns survive instance disposal (ADR 0019).

The regression test behind the manual kill-the-process demo: graph instance A
on the REAL Postgres checkpointer completes an Agent V1 turn without
``ask_student`` mounted; A is disposed (checkpointer connection closed); a
FRESH instance B on the same DSN continues the same ``thread_id`` and the model
can see the persisted prior turn.

Hermetic everywhere except the thing under test: the LLM is a ``FunctionModel``,
``prepare``'s temporal context and the prompt builder are patched (no catalog,
no RO pool) — only the checkpointer is live (which also exercises the D3
schema assertion inside ``build_checkpointer``).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, DeltaToolCalls, FunctionModel

import app.agent_node
import app.graph
from app.deps import AppDeps
from app.graph import build_graph
from app.run_turn import run_turn
from app.state import TemporalContext
from app.toolset import ToolDeps
from config.settings import get_settings
from domain.events import Event
from domain.season import Season
from domain.specs import SourceConfig

pytestmark = pytest.mark.live_db

_ALL_OFF = SourceConfig(web=False, reddit=False, edu=False)

_TEMPORAL = TemporalContext(
    today="2026-06-10",
    season=Season(
        phase="exploration",
        description="Rising seniors research schools.",
        entering_class="Fall 2027",
        cycle_note="It is the exploration phase for the class entering Fall 2027.",
    ),
    context="Today is 2026-06-10.",
)


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No RO DB in prepare, no asset loading in the prompt builder."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")


def _ask_student_probe_then_continue(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    """Would ask one clarify question if mounted; otherwise continue normally."""
    if "ask_student" not in {tool.name for tool in info.function_tools}:
        prior_text = [
            part.content
            for message in messages[:-1]
            for part in getattr(message, "parts", [])
            if isinstance(part, TextPart)
        ]
        if "Initial answer without clarify." in prior_text:
            return ModelResponse(parts=[TextPart("Continuing after restart.")])
        return ModelResponse(parts=[TextPart("Initial answer without clarify.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="ask_student",
                args={
                    "question": "What matters most to you?",
                    "header": "Pick one",
                    "options": [
                        {"label": "Cost", "hint": "affordability and aid"},
                        {"label": "Academics", "hint": "programs and rigor"},
                    ],
                },
            )
        ]
    )


def _fn_model() -> FunctionModel:
    """The probe FunctionModel with the stream variant the node's
    ``run_stream_events`` requires (notes-p4-apis §10)."""

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        response = _ask_student_probe_then_continue(messages, info)
        for index, part in enumerate(response.parts):
            if isinstance(part, TextPart):
                yield part.content
            elif isinstance(part, ToolCallPart):
                yield {index: DeltaToolCall(name=part.tool_name, json_args=part.args_as_json_str())}

    return FunctionModel(_ask_student_probe_then_continue, stream_function=stream)


async def _make_instance(settings: Any) -> tuple[Any, AppDeps, AsyncPostgresSaver]:
    """One independent runtime instance: fresh saver connection, fresh graph."""
    from app.checkpointer import build_checkpointer

    saver = await build_checkpointer(settings)
    assert isinstance(saver, AsyncPostgresSaver)  # the test IS the postgres path
    deps = AppDeps(
        # prepare is patched; agent_node reads catalog.school_count (CFG-01).
        catalog=SimpleNamespace(school_count=0),  # type: ignore[arg-type]
        app_pool=None,  # session rows are not under test
        settings=settings,
        tool_deps=ToolDeps(
            catalog=None,
            search_max_results=1,
            subreddit_menu=[],
            tavily_client_factory=lambda: pytest.fail("no external source is enabled"),
        ),
        mcp_toolset=None,
        model_factory=_fn_model,
    )
    return build_graph(saver, deps), deps, saver


async def _collect(graph: Any, deps: AppDeps, session_id: str, text: str) -> list[Event]:
    return [event async for event in run_turn(session_id, text, _ALL_OFF, deps=deps, graph=graph)]


def _text(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "delta")


def _done_status(events: list[Event]) -> str:
    return str(next(event.data["status"] for event in events if event.type == "done"))


async def _delete_thread(conn: Any, thread_id: str) -> None:
    """Hygiene: drop the test thread's checkpoint rows (psycopg %s params)."""
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        await conn.execute(  # table names are a fixed allowlist, not input
            f"DELETE FROM counselle.{table} WHERE thread_id = %s", (thread_id,)
        )


async def test_agent_turn_survives_instance_disposal_without_ask_student() -> None:
    settings = get_settings()
    assert settings.checkpointer == "postgres"
    session_id = str(uuid4())

    # --- instance A: complete an Agent V1 turn, then dispose ---
    graph_a, deps_a, saver_a = await _make_instance(settings)
    try:
        events_1 = await _collect(graph_a, deps_a, session_id, "Is NYU good?")
    finally:
        await saver_a.conn.close()  # dispose A: the connection is gone

    assert "clarify" not in [event.type for event in events_1]
    assert _done_status(events_1) == "complete"
    assert "Initial answer without clarify." in _text(events_1)

    # --- instance B: FRESH saver + graph on the same DSN continues the thread ---
    graph_b, deps_b, saver_b = await _make_instance(settings)
    try:
        events_2 = await _collect(graph_b, deps_b, session_id, "continue")

        assert "error" not in [event.type for event in events_2]
        assert _done_status(events_2) == "complete"
        assert "Continuing after restart." in _text(events_2)
        state = await graph_b.aget_state({"configurable": {"thread_id": session_id}})
        returns = [
            part
            for message in state.values["messages"]
            for part in message.get("parts", [])
            if part.get("part_kind") == "tool-return" and part.get("tool_name") == "ask_student"
        ]
        assert returns == []
        # Sanity: the reply with the marker-free prose still carries no stray markers.
        assert not re.findall(r"\[\d+\]", _text(events_2))
    finally:
        await _delete_thread(saver_b.conn, session_id)
        await saver_b.conn.close()
