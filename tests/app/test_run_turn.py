"""Unit tests for the turn runner + agent node (Slice F). No DB, no network, no LLM.

Rig: memory checkpointer, ``FunctionModel``/``TestModel`` injected through the
``AppDeps.model_factory`` seam, a fake asyncpg pool for the session row, and
``app.graph.build_temporal_context`` monkeypatched so ``prepare`` never touches
the database (notes-p4-apis §10).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace
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
from app.records import prose_of
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
    """The slice of Settings the runner + node + registry read."""

    model_counselor = "google-vertex:gemini-2.5-pro"
    max_tool_rounds = 12
    vertex_api_key = None
    source_web_default = True
    source_reddit_default = True
    source_edu_default = True
    search_max_results = 5
    thinking_threshold_chars = 240  # CFG-07: agent_node reads this at router build
    # Turn-registry knobs (CFG-02: the registry reads these directly, no getattr
    # fallback). The existing per-test overrides (settings.stream_buffer_size = 2,
    # etc.) now override a real default instead of a non-existent attribute.
    max_concurrent_turns: int = 50
    stream_buffer_size: int = 20_000
    max_consumers_per_turn: int = 8
    # float-typed so tests can drop it to 0.1 to fire the watchdog fast.
    turn_timeout_s: float = 180
    # Phase-1 fields (BC-01 / BC-08) — also read directly after CFG-02 removes
    # their getattr fallbacks; the stub MUST carry them or __init__ /
    # _persist_partial_guarded raise AttributeError.
    stream_buffer_bytes: int = 256 * 1024 * 1024
    persist_partial_timeout_s: float = 5.0


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
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")


class Rig:
    """One memory-checkpointed graph + fake pool + injected model."""

    def __init__(self, model: Any, settings: Any | None = None) -> None:
        self.pool = FakePool()
        self.tavily = StubTavilyClient()
        self.settings = settings or FakeSettings()
        self.deps = AppDeps(
            # A minimal catalog stub: prepare is patched, but agent_node reads
            # `catalog.school_count` for the system prompt (CFG-01). Only the
            # count is needed; school_name/school_domain resolve via getattr.
            catalog=SimpleNamespace(school_count=0),  # type: ignore[arg-type]
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


# ---------------------------------------------------------------------------
# (h) B1a: step/thinking events in the run_turn stream
# ---------------------------------------------------------------------------

_WEB_ONLY = SourceConfig(web=True, reddit=False, edu=False)

_SEARCH_STEP_KINDS = {"web_search", "edu_search", "reddit_search"}


def _steps(events: list[Event]) -> list[dict[str, Any]]:
    return [event.data for event in events if event.type == "step"]


def _assert_every_step_start_has_a_terminal(events: list[Event]) -> None:
    steps = _steps(events)
    started = [step["step_id"] for step in steps if step["status"] == "start"]
    terminal = [step["step_id"] for step in steps if step["status"] in ("end", "error")]
    assert sorted(started) == sorted(terminal), f"orphan steps: {steps}"


async def test_tool_turn_streams_step_pair_in_sane_order() -> None:
    from uuid import UUID

    rig = Rig(_fn_model(_search_then_answer))

    events = await rig.turn(str(uuid4()), "duke dorms?", _WEB_ONLY)

    types = _types(events)
    # meta first (with the G1 identity pair as real UUIDs), done last.
    assert types[0] == "meta"
    assert types[-1] == "done"
    meta = events[0].data
    UUID(meta["message_id"])
    UUID(meta["user_message_id"])
    assert meta["message_id"] != meta["user_message_id"]
    assert _done_status(events) == "complete"
    assert {"sources", "usage", "delta"} <= set(types)
    # One web_search step: start before end, same id, label has no template holes.
    steps = _steps(events)
    assert [step["status"] for step in steps] == ["start", "end"]
    assert steps[0]["step_id"] == steps[1]["step_id"]
    assert steps[0]["kind"] == "web_search"
    assert all("{" not in step["label"] for step in steps)
    # The step pair fully precedes done; the start precedes the end.
    step_positions = [i for i, event in enumerate(events) if event.type == "step"]
    assert step_positions[0] < step_positions[1] < types.index("done")


def _stubborn_web_searcher(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """Tries search_web once; answers as soon as ANY tool response came back
    (a ToolReturnPart or the tool-not-found RetryPromptPart)."""
    from pydantic_ai.messages import RetryPromptPart

    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, (ToolReturnPart, RetryPromptPart)) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I cannot search the web right now.")])
    return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "dorms"})])


async def test_disabled_sources_make_search_step_kinds_impossible() -> None:
    rig = Rig(_fn_model(_stubborn_web_searcher))

    events = await rig.turn(str(uuid4()), "what do dorms look like?", _ALL_OFF)

    assert _done_status(events) == "complete"
    kinds = {step["kind"] for step in _steps(events)}
    assert not (kinds & _SEARCH_STEP_KINDS), f"disabled source surfaced a step: {kinds}"


def _search_then_clarify(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """One sibling tool call alongside ask_student in the same response."""
    return ModelResponse(
        parts=[
            ToolCallPart(tool_name="search_web", args={"query": "dorms"}),
            ToolCallPart(
                tool_name="ask_student",
                args={
                    "question": "Which campus?",
                    "header": "Pick one",
                    "options": [
                        {"label": "Main", "hint": "the flagship"},
                        {"label": "Satellite", "hint": "the branch"},
                    ],
                },
            ),
        ]
    )


async def test_clarify_turn_has_no_ask_student_step_and_siblings_close_clean() -> None:
    rig = Rig(_fn_model(_search_then_clarify))

    events = await rig.turn(str(uuid4()), "Is NYU good?", _WEB_ONLY)

    assert "clarify" in _types(events)
    assert _done_status(events) == "awaiting_input"
    steps = _steps(events)
    # ask_student never surfaces on the timeline (would map to the default row).
    assert not any("ask_student" in step["label"] for step in steps)
    # The sibling step opened before the interrupt is closed — with status end,
    # never error (the work is superseded, not failed) — before the stream ends.
    _assert_every_step_start_has_a_terminal(events)
    terminals = [step for step in steps if step["status"] != "start"]
    assert terminals and all(step["status"] == "end" for step in terminals)


async def test_budget_cutoff_closes_steps_and_streams_the_budget_delta() -> None:
    def endless_searcher(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "x"})])

    settings = FakeSettings()
    settings.max_tool_rounds = 1
    rig = Rig(_fn_model(endless_searcher), settings=settings)

    events = await rig.turn(str(uuid4()), "hi", _WEB_ONLY)

    assert "error" not in _types(events)
    assert "tool budget" in _text(events)
    assert _done_status(events) == "complete"
    # Whatever steps opened, every one of them reached a terminal state.
    assert _steps(events), "the searcher's tool call must surface a step"
    _assert_every_step_start_has_a_terminal(events)


# ---------------------------------------------------------------------------
# (i) B1b: the turn record + the prose invariant
# ---------------------------------------------------------------------------


async def _state_values(rig: Rig, session_id: str) -> dict[str, Any]:
    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    return dict(snapshot.values)


def _turn_prose_from_messages(messages: list[dict[str, Any]], offset: int) -> str:
    """Concatenated ModelResponse text-part contents after the record's offset —
    what the transcript read reconstructs (the prose invariant's other half)."""
    chunks: list[str] = []
    for msg in messages[offset:]:
        if msg.get("kind") != "response":
            continue
        chunks.extend(
            p.get("content", "") for p in msg.get("parts", []) if p.get("part_kind") == "text"
        )
    return "".join(chunks)


async def test_complete_turn_writes_the_node_record() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "duke dorms?", _WEB_ONLY)

    meta = events[0].data
    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    assert len(records) == 1
    record = records[0]
    # G1 ids match what meta streamed.
    assert record["message_id"] == meta["message_id"]
    assert record["user_message_id"] == meta["user_message_id"]
    assert record["status"] == "complete"
    assert record["synthesized_answer"] is False
    assert record["user_text"] == "duke dorms?"
    assert record["ts"]
    assert record["messages_offset"] == 0
    # The record is self-contained: materialized parts carry exactly the
    # streamed prose, which also equals the messages prose (the invariant).
    assert prose_of(record["parts"]) == _text(events)
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == _text(events)
    # Steps are end-state only; receipt per the §7 contract; sources snapshot.
    assert [s["status"] for s in record["steps"]] == ["end"]
    assert record["receipt"] == "1 web search"
    assert record["sources"] == values["source_registry"]
    assert record["usage"]["tool_calls"] >= 1
    assert record["error"] is None and record["clarify"] is None


async def test_budget_turn_record_and_prose_invariant() -> None:
    def endless_searcher(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "x"})])

    settings = FakeSettings()
    settings.max_tool_rounds = 1
    rig = Rig(_fn_model(endless_searcher), settings=settings)
    session_id = str(uuid4())

    events = await rig.turn(session_id, "hi", _WEB_ONLY)

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "complete"
    # The prose invariant: messages carry exactly what streamed (the budget
    # message included) — pre-B1b this prose was lost entirely.
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == _text(events)
    assert "tool budget" in prose
    assert "web search" in record["receipt"]


async def test_empty_prose_budget_turn_appends_no_model_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The empty-partial rule: no prose streamed → no ModelResponse append
    (an empty-content response corrupts the provider history)."""

    def endless_searcher(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "x"})])

    monkeypatch.setattr(app.agent_node, "_TOOL_BUDGET_MESSAGE", "")
    settings = FakeSettings()
    settings.max_tool_rounds = 1
    rig = Rig(_fn_model(endless_searcher), settings=settings)
    session_id = str(uuid4())

    await rig.turn(session_id, "hi", _WEB_ONLY)

    values = await _state_values(rig, session_id)
    # Only the user tail — no empty partial response was appended.
    assert [m["kind"] for m in values["messages"]] == ["request"]
    assert values["turn_records"][-1]["status"] == "complete"


async def test_clarify_park_writes_record_and_resume_replaces_it() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    session_id = str(uuid4())

    events_1 = await rig.turn(session_id, "Is NYU good?", _ALL_OFF)
    meta_1 = events_1[0].data

    values = await _state_values(rig, session_id)
    parked = values["turn_records"][-1]
    assert parked["status"] == "awaiting_input"
    assert parked["message_id"] == meta_1["message_id"]
    assert parked["clarify"]["spec"]["question"] == "What matters most to you?"
    assert parked["clarify"]["answer"] is None
    assert parked["user_text"] == "Is NYU good?"  # the parked record anchors the question
    assert parked["usage"] is None
    # Every persisted step is terminal — nothing parked mid-shimmer.
    assert all(s["status"] in ("end", "error") for s in parked["steps"])

    events_2 = await rig.turn(session_id, "cost", _ALL_OFF)
    meta_2 = events_2[0].data

    # meta on resume reuses the parked assistant message_id (G1/G4)…
    assert meta_2["message_id"] == meta_1["message_id"]
    # …with a fresh user_message_id for the answer bubble.
    assert meta_2["user_message_id"] != meta_1["user_message_id"]
    assert _done_status(events_2) == "complete"

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    # The resumed record REPLACED the parked one — same id, one record.
    assert len(records) == 1
    record = records[0]
    assert record["status"] == "complete"
    assert record["message_id"] == meta_1["message_id"]
    assert record["user_message_id"] == meta_2["user_message_id"]
    assert record["clarify"]["answer"] == "cost"
    assert record["clarify"]["spec"]["question"] == "What matters most to you?"
    assert record["synthesized_answer"] is True
    # The replacement record stays self-contained: the ORIGINAL question (the
    # answer rides clarify.answer, never the user bubble).
    assert record["user_text"] == "Is NYU good?"
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == _text(events_2)


async def test_error_turn_writes_record_and_preserves_streamed_prose() -> None:
    """A model that streams >threshold prose then dies mid-run: the error
    record persists AND messages keep exactly the streamed prose."""
    long_prose = "Duke's engineering program is excellent. " * 8  # > 240 chars

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise RuntimeError("never called — streaming only")

    async def stream(messages: Any, info: AgentInfo) -> AsyncIterator[str]:
        yield long_prose
        raise RuntimeError("model died mid-stream")

    rig = Rig(FunctionModel(fn, stream_function=stream))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "tell me about duke", _ALL_OFF)

    assert "error" in _types(events)
    trace_id = events[0].data["trace_id"]
    streamed = _text(events)
    assert streamed  # prose crossed the threshold and streamed live

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert record["error"]["trace_id"] == trace_id
    assert record["error"]["message"]
    assert record["message_id"] == events[0].data["message_id"]
    # The prose invariant on the error path.
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == streamed


async def test_error_turn_without_prose_appends_no_partial_response() -> None:
    def always_raises(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise RuntimeError("agent node exploded")

    rig = Rig(_fn_model(always_raises))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "hi", _ALL_OFF)

    assert "error" in _types(events)
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    # Record only — no empty partial ModelResponse.
    assert all(m["kind"] == "request" for m in values["messages"])


# ---------------------------------------------------------------------------
# (j) H1 / M3: _write_failure_record fallback restore + _prepare_turn_input
#     (direct unit tests over the real signatures, with a fake graph)
# ---------------------------------------------------------------------------


class _CapturingGraph:
    """Captures the aupdate_state payload; returns a fixed snapshot from
    aget_state. Duck-types the two graph calls _write_failure_record makes."""

    def __init__(self, snapshot_values: dict[str, Any]) -> None:
        self._snapshot_values = snapshot_values
        self.updates: list[dict[str, Any]] = []

    async def aget_state(self, config: Any, *args: Any, **kwargs: Any) -> Any:
        class _Snap:
            values = self._snapshot_values

        return _Snap()

    async def aupdate_state(self, config: Any, values: Any = None, *a: Any, **k: Any) -> Any:
        self.updates.append(values)
        return None


async def test_write_failure_record_fallback_restore_writes_messages() -> None:
    """The fallback-restore equivalence subtlety (audit H1): when the input
    checkpoint never landed (fallback_messages LONGER than the snapshot's
    messages) AND no prose streamed, build_terminal_update appends nothing — yet
    the restored messages MUST still be persisted (update.setdefault fired). The
    aupdate_state payload carries the restored "messages" key regardless."""
    from app.run_turn import _write_failure_record

    # Snapshot is EMPTY (the user-message checkpoint never landed); the fallback
    # carries the turn's input (one user request) — longer than the snapshot.
    fallback = _serialized_user_message_for_test("tell me about duke")
    graph = _CapturingGraph({"messages": [], "turn_records": []})

    await _write_failure_record(
        graph,
        {"configurable": {"thread_id": "s-restore"}},
        emissions=[],  # NO prose streamed → empty-partial rule appends nothing
        ids={"message_id": "m-1", "user_message_id": "u-1"},
        user_text="tell me about duke",
        trace_id="t-1",
        messages_offset=None,
        fallback_messages=fallback,
        registry_dump=[],
    )

    assert len(graph.updates) == 1
    payload = graph.updates[0]
    # The error record was written…
    assert payload["turn_records"][-1]["status"] == "error"
    # …AND despite no partial append, the restored messages were persisted.
    assert "messages" in payload, "fallback restore must persist messages even with no partial"
    assert payload["messages"] == fallback


def _serialized_user_message_for_test(text: str) -> list[dict[str, Any]]:
    from pydantic_ai.messages import ModelMessagesTypeAdapter, UserPromptPart

    req = ModelRequest(parts=[UserPromptPart(content=text)])
    return list(ModelMessagesTypeAdapter.dump_python([req], mode="json"))


async def test_prepare_turn_input_resume_when_parked_new_turn_when_not() -> None:
    """_prepare_turn_input (audit M3) yields a resume Command(resume=…) graph
    input when the prior records show a parked (awaiting_input) tail and reuses
    the parked message_id's offset; it yields a new-turn dict input when not
    parked."""
    from langgraph.types import Command

    from app.run_turn import _prepare_turn_input, _ResumePrewriteError
    from app.turn_persistence import parked_record

    rig = Rig(_fn_model(_clarify_then_answer))

    # --- parked branch: a parked record at the tail → resume Command ---
    parked_rec: dict[str, Any] = {
        "message_id": "m-parked",
        "user_message_id": "u-0",
        "status": "awaiting_input",
        "user_text": "Is NYU good?",
        "messages_offset": 3,
    }
    parked_records: list[dict[str, Any]] = [parked_rec]

    class _Snap:
        values: dict[str, Any] = {
            "messages": [{"kind": "request"}],
            "turn_records": parked_records,
        }

    parked = parked_record(parked_records)
    assert parked is not None
    turn_ids = {"message_id": "m-parked", "user_message_id": "u-1"}
    resume_input = await _prepare_turn_input(
        rig.graph,
        rig.deps,
        rig.settings,
        session_id="prep-resume",
        user_text="cost",
        source_config=_ALL_OFF,
        snapshot=_Snap(),
        parked=parked,
        turn_ids=turn_ids,
    )
    assert isinstance(resume_input.graph_input, Command)
    # The answer rides Command(resume=…), never the messages list.
    assert resume_input.graph_input.resume == "cost"
    # The parked record's offset is carried forward (the original question index).
    assert resume_input.messages_offset == 3

    # --- new-turn branch: no parked record → a new-turn dict input ---
    class _SnapNew:
        values = {"messages": [{"kind": "response"}], "turn_records": []}

    new_input = await _prepare_turn_input(
        rig.graph,
        rig.deps,
        rig.settings,
        session_id="prep-new",
        user_text="hi",
        source_config=_ALL_OFF,
        snapshot=_SnapNew(),
        parked=None,
        turn_ids={"message_id": "m-new", "user_message_id": "u-new"},
    )
    assert not isinstance(new_input.graph_input, Command)
    assert isinstance(new_input.graph_input, dict)
    # The new turn appends the serialized user ModelRequest to the prior messages.
    assert new_input.graph_input["messages"][-1]["kind"] == "request"
    assert new_input.messages_offset == 1  # appended after the one prior message

    # Reference the imported sentinel so the import is not flagged as unused; it
    # is the BC-11 raise path exercised by test_turn_persistence's integration test.
    assert issubclass(_ResumePrewriteError, Exception)


async def test_record_state_carries_no_secrets() -> None:
    """Receipts-no-secrets sweep over the persisted record: nothing from the
    settings/credentials surface may reach the checkpointed turn record."""
    import json

    settings = FakeSettings()
    settings.vertex_api_key = "sk-super-secret-test-key"  # type: ignore[assignment]
    rig = Rig(_fn_model(_search_then_answer), settings=settings)
    session_id = str(uuid4())

    await rig.turn(session_id, "duke dorms?", _WEB_ONLY)

    values = await _state_values(rig, session_id)
    blob = json.dumps(values["turn_records"])
    assert "sk-super-secret-test-key" not in blob
    assert "postgresql://" not in blob
    assert "password" not in blob.lower()
