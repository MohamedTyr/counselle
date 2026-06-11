"""Unit tests for the turn runner + agent node (Slice F). No DB, no network, no LLM.

Rig: memory checkpointer, ``FunctionModel``/``TestModel`` injected through the
``AppDeps.model_factory`` seam, a fake asyncpg pool for the session row, and
``app.graph.build_temporal_context`` monkeypatched so ``prepare`` never touches
the database (notes-p4-apis §10).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)
from pydantic_ai.models.test import TestModel

import app.agent_node
import app.graph
from app.deps import AppDeps
from app.graph import build_graph
from app.run_turn import run_turn
from app.state import TemporalContext
from app.toolset import ToolDeps
from domain.events import Event
from domain.season import Season
from domain.specs import SourceConfig

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSettings:
    """The slice of Settings the runner + node read."""

    model_counselor = "google-vertex:gemini-2.5-pro"
    max_tool_rounds = 12
    vertex_api_key = None
    source_web_default = True
    source_reddit_default = True
    source_edu_default = True
    search_max_results = 5


class _FakeConn:
    def __init__(self, pool: FakePool) -> None:
        self._pool = pool

    async def fetchrow(self, sql: str, *args: Any) -> dict[str, Any] | None:
        return self._pool.rows.get(args[0])

    async def execute(self, sql: str, *args: Any) -> None:
        verb = sql.strip().split(None, 1)[0].upper()
        self._pool.executed.append((verb, args))
        if verb == "INSERT":
            session_id, source_config = args[0], args[1]
            self._pool.rows.setdefault(
                session_id,
                {
                    "session_id": session_id,
                    "user_id": None,
                    "title": None,
                    "source_config": source_config,
                    "created_at": None,
                    "updated_at": None,
                },
            )


class _Acquire:
    def __init__(self, pool: FakePool) -> None:
        self._pool = pool

    async def __aenter__(self) -> _FakeConn:
        return _FakeConn(self._pool)

    async def __aexit__(self, *exc: Any) -> None:
        return None


class FakePool:
    """Duck-types the two asyncpg.Pool calls the session layer makes."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    def acquire(self) -> _Acquire:
        return _Acquire(self)


class StubTavilyClient:
    """Returns a distinct URL per call so registry indices can be asserted."""

    def __init__(self) -> None:
        self.calls = 0

    async def search(self, query: str, **kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        return {
            "results": [
                {
                    "title": f"Result {self.calls}",
                    "url": f"https://example.com/{self.calls}",
                    "content": "snippet",
                }
            ]
        }


# ---------------------------------------------------------------------------
# Rig
# ---------------------------------------------------------------------------


def _fn_model(fn: Callable[[list[ModelMessage], AgentInfo], ModelResponse]) -> FunctionModel:
    """A FunctionModel that also streams — the node uses ``run_stream_events``,
    and pydantic-ai's ``FunctionModel`` requires an explicit ``stream_function``
    for streamed requests (notes-p4-apis §10)."""

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        response = fn(messages, info)
        for index, part in enumerate(response.parts):
            if isinstance(part, TextPart):
                yield part.content
            elif isinstance(part, ToolCallPart):
                yield {index: DeltaToolCall(name=part.tool_name, json_args=part.args_as_json_str())}

    return FunctionModel(fn, stream_function=stream)


_TEMPORAL = TemporalContext(
    today="2026-06-10",
    season=Season(
        phase="exploration",
        description="Rising seniors research schools.",
        entering_class="Fall 2027",
        cycle_note="It is the exploration phase for the class entering Fall 2027.",
    ),
    data_calendar=[],
    context="Today is 2026-06-10.",
)


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading in the prompt builder."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda ctx: "Test counselor.")


class Rig:
    """One memory-checkpointed graph + fake pool + injected model."""

    def __init__(self, model: Any, settings: Any | None = None) -> None:
        self.pool = FakePool()
        self.tavily = StubTavilyClient()
        self.settings = settings or FakeSettings()
        self.deps = AppDeps(
            catalog=None,  # type: ignore[arg-type]  # never touched: prepare is patched
            app_pool=self.pool,  # duck-typed fake (asyncpg.Pool is Any to mypy)
            settings=self.settings,
            tool_deps=ToolDeps(
                catalog=None,
                search_max_results=5,
                subreddit_menu=["ApplyingToCollege", "{school}"],
                tavily_client_factory=lambda: self.tavily,
            ),
            mcp_toolset=None,
            model_factory=lambda: model,
        )
        self.graph = build_graph(InMemorySaver(), self.deps)

    async def turn(
        self, session_id: str, text: str, source_config: SourceConfig | None = None
    ) -> list[Event]:
        return [
            event
            async for event in run_turn(
                session_id, text, source_config, deps=self.deps, graph=self.graph
            )
        ]


def _types(events: list[Event]) -> list[str]:
    return [event.type for event in events]


def _text(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "delta")


def _done_status(events: list[Event]) -> str:
    return str(next(event.data["status"] for event in events if event.type == "done"))


_ALL_OFF = SourceConfig(web=False, reddit=False, edu=False)


# ---------------------------------------------------------------------------
# (a) simple turn
# ---------------------------------------------------------------------------


async def test_simple_turn_streams_deltas_persists_messages_creates_session() -> None:
    rig = Rig(TestModel(call_tools=[], custom_output_text="Hello! Ask me about any school."))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "hi", _ALL_OFF)

    assert events[0].type == "meta"
    assert events[0].data["session_id"] == session_id
    assert "Hello! Ask me about any school." in _text(events)
    assert _done_status(events) == "complete"
    assert "error" not in _types(events)
    # usage + sources are present on a completed turn
    assert "usage" in _types(events)
    assert "sources" in _types(events)
    # messages persisted in graph state: the user request + the model response
    state = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    assert len(state.values["messages"]) == 2
    # session row created (INSERT ... ON CONFLICT) and touched (UPDATE)
    assert session_id in rig.pool.rows
    assert ("UPDATE", (session_id,)) in rig.pool.executed


# ---------------------------------------------------------------------------
# (b) tool-loop bound (settings.max_tool_rounds)
# ---------------------------------------------------------------------------


async def test_endless_tool_caller_is_cut_off_with_a_clean_error_delta() -> None:
    def endless(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="load_skill", args={"name": "x"})])

    settings = FakeSettings()
    settings.max_tool_rounds = 2
    rig = Rig(_fn_model(endless), settings=settings)

    events = await rig.turn(str(uuid4()), "hi", _ALL_OFF)

    assert "error" not in _types(events)  # clean delta, not a crash
    assert "tool budget" in _text(events)
    assert _done_status(events) == "complete"


# ---------------------------------------------------------------------------
# (c) source gating reaches the model (ADR 0013)
# ---------------------------------------------------------------------------


async def test_reddit_disabled_toolset_lacks_search_reddit() -> None:
    seen: list[str] = []

    def record_tools(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.extend(tool.name for tool in info.function_tools)
        return ModelResponse(parts=[TextPart("ok")])

    rig = Rig(_fn_model(record_tools))

    await rig.turn(str(uuid4()), "hi", SourceConfig(web=True, reddit=False, edu=True))

    assert "search_reddit" not in seen
    assert {"search_web", "search_school_site"} <= set(seen)
    assert {"render_viz", "ask_student", "load_skill"} <= set(seen)


# ---------------------------------------------------------------------------
# (d) registry indices stable across two turns in one session
# ---------------------------------------------------------------------------


def _search_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("Here is what I found [1].")])
    return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "dorms"})])


async def test_registry_indices_stable_across_two_turns() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())
    config = SourceConfig(web=True, reddit=False, edu=False)

    events_1 = await rig.turn(session_id, "duke dorms?", config)
    events_2 = await rig.turn(session_id, "and harvard?", config)

    sources_1 = next(e.data["sources"] for e in events_1 if e.type == "sources")
    sources_2 = next(e.data["sources"] for e in events_2 if e.type == "sources")
    assert [entry["index"] for entry in sources_1] == [1]
    assert [entry["index"] for entry in sources_2] == [1, 2]
    # turn 2 never renumbered turn 1's source
    assert sources_2[0] == sources_1[0]
    assert sources_2[1]["citation"]["url"] == "https://example.com/2"


# ---------------------------------------------------------------------------
# (e) clarify interrupt round-trip (memory checkpointer)
# ---------------------------------------------------------------------------


def _clarify_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    returns = (
        [part for part in last.parts if isinstance(part, ToolReturnPart)]
        if isinstance(last, ModelRequest)
        else []
    )
    if returns:
        return ModelResponse(parts=[TextPart(f"Focusing on {returns[0].content}.")])
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


async def test_clarify_parks_then_resume_feeds_answer_to_the_model() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    session_id = str(uuid4())

    events_1 = await rig.turn(session_id, "Is NYU good?", _ALL_OFF)

    clarify = next(e for e in events_1 if e.type == "clarify")
    assert clarify.data["question"] == "What matters most to you?"
    assert len(clarify.data["options"]) == 2
    assert _done_status(events_1) == "awaiting_input"
    assert "sources" not in _types(events_1)  # parked turn ends right after done

    events_2 = await rig.turn(session_id, "cost", _ALL_OFF)

    assert _done_status(events_2) == "complete"
    assert "Focusing on cost." in _text(events_2)  # the answer reached the model
    assert (
        next(e for e in events_1 if e.type == "meta").data["trace_id"]
        != next(e for e in events_2 if e.type == "meta").data["trace_id"]
    )


# ---------------------------------------------------------------------------
# (f) FIX 2: post-run aget_state failure falls back to in-stream registry dump
# ---------------------------------------------------------------------------


async def test_post_run_aget_state_failure_falls_back_to_stream_registry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the post-run aget_state raises, sources event still carries the
    registry entries captured from the updates stream (FIX 2)."""
    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())
    config = SourceConfig(web=True, reddit=False, edu=False)

    # Run a first turn to warm up the graph and get the real graph reference
    events = await rig.turn(session_id, "duke dorms?", config)

    # All events should be present (meta, delta, sources, usage, done)
    assert "sources" in _types(events)
    sources = next(e.data["sources"] for e in events if e.type == "sources")
    assert len(sources) == 1, "expected exactly one source from the search tool"

    # Now simulate a second turn where the post-run aget_state fails.
    # We monkeypatch the graph's aget_state to fail ONLY on the second call
    # (the first call is the pre-run interrupt check).
    original_aget_state = rig.graph.aget_state
    call_count: list[int] = [0]

    async def patched_aget_state(cfg: Any, *args: Any, **kwargs: Any) -> Any:
        call_count[0] += 1
        if call_count[0] >= 2:
            raise RuntimeError("checkpointer blip on post-run state fetch")
        return await original_aget_state(cfg, *args, **kwargs)

    monkeypatch.setattr(rig.graph, "aget_state", patched_aget_state)

    events2 = await rig.turn(session_id, "and harvard?", config)

    # Must still end with sources and done(complete), not error
    assert "sources" in _types(events2), "sources event missing when post-run aget_state fails"
    assert _done_status(events2) == "complete"
    assert "error" not in _types(events2)

    # Sources should contain registry entries from the updates stream fallback
    sources2 = next(e.data["sources"] for e in events2 if e.type == "sources")
    assert len(sources2) >= 1, "fallback registry was empty — FIX 2 not working"


# ---------------------------------------------------------------------------
# (g) FIX 3: on_failure hook is called when the agent node raises
# ---------------------------------------------------------------------------


async def test_on_failure_hook_called_when_turn_fails() -> None:
    """When the graph raises an unexpected exception, deps.on_failure is invoked."""
    hook_calls: list[int] = [0]

    def on_failure() -> None:
        hook_calls[0] += 1

    # A model that always raises to force run_turn's outer exception handler
    def always_raises(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise RuntimeError("agent node exploded")

    rig = Rig(_fn_model(always_raises))
    # Inject the hook into deps
    rig.deps.on_failure = on_failure

    events = await rig.turn(str(uuid4()), "hi", _ALL_OFF)

    # The turn must yield an error event (not propagate the exception)
    assert "error" in _types(events)
    # And the hook must have been called once
    assert hook_calls[0] == 1, f"on_failure called {hook_calls[0]} times, expected 1"
