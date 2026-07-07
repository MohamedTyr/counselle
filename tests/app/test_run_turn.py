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
from pydantic_ai import FinalResultEvent
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartStartEvent,
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
import app.viz
from app.deps import AppDeps
from app.graph import build_graph
from app.records import build_turn_record, prose_of
from app.run_turn import run_turn
from app.state import TemporalContext
from app.steps import EmissionRouter
from app.toolset import ToolDeps
from domain.envelope import Citation, CitationEnvelope
from domain.events import Event
from domain.season import Season
from domain.specs import RenderSpec, SchoolRef, SourceConfig, VizRow

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


def _thinking(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "thinking")


def _done_status(events: list[Event]) -> str:
    return str(next(event.data["status"] for event in events if event.type == "done"))


_ALL_OFF = SourceConfig(web=False, reddit=False, edu=False)


def _viz_cell(field: str, raw: int = 42) -> CitationEnvelope:
    return CitationEnvelope(
        field=field,
        label=field,
        display=str(raw),
        raw=raw,
        available=True,
        unit="number",
        citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024", raw_table=field),
    )


def _viz_spec(field: str, *, title: str = "Rendered card") -> RenderSpec:
    return RenderSpec(
        type="comparison_table",
        title=title,
        schools=[SchoolRef(unitid=1, name="A University")],
        rows=[VizRow(label=field, cells=[_viz_cell(field)])],
    )


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


async def test_toolset_lacks_disabled_sources_and_ask_student() -> None:
    seen: list[str] = []

    def record_tools(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.extend(tool.name for tool in info.function_tools)
        return ModelResponse(parts=[TextPart("ok")])

    rig = Rig(_fn_model(record_tools))

    await rig.turn(str(uuid4()), "hi", SourceConfig(web=True, reddit=False, edu=True))

    assert "search_reddit" not in seen
    assert {"search_web", "search_school_site"} <= set(seen)
    assert {"write_plan", "render_viz", "load_skill"} <= set(seen)
    assert "ask_student" not in seen


def _plan_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) and part.tool_name == "write_plan"
        for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I updated the plan and then answered.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="write_plan",
                args={
                    "items": [
                        {"content": "Check the school data", "status": "completed"},
                        {"content": "Draft the recommendation", "status": "in_progress"},
                    ]
                },
            )
        ]
    )


async def test_write_plan_tool_produces_visible_step_receipt() -> None:
    rig = Rig(_fn_model(_plan_then_answer))

    events = await rig.turn(str(uuid4()), "Make a quick plan", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert _text(events) == "I updated the plan and then answered."
    plan_steps = [
        event.data
        for event in events
        if event.type == "step" and event.data["kind"] == "write_plan"
    ]
    assert [step["status"] for step in plan_steps] == ["start", "end"]
    assert all(step["label"] == "Updating the plan" for step in plan_steps)
    detail = plan_steps[-1]["detail"]
    assert detail["completed"] == 1
    assert detail["total"] == 2
    assert detail["items"] == [
        {"content": "Check the school data", "status": "completed"},
        {"content": "Draft the recommendation", "status": "in_progress"},
    ]


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
# (e) Agent V1 does not mount ask_student
# ---------------------------------------------------------------------------


def _ask_student_probe(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    if "ask_student" not in {tool.name for tool in info.function_tools}:
        return ModelResponse(parts=[TextPart("I will proceed without asking first.")])
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


async def test_ask_student_not_mounted_so_agent_continues_without_clarify() -> None:
    rig = Rig(_fn_model(_ask_student_probe))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Is NYU good?", _ALL_OFF)

    assert "clarify" not in _types(events)
    assert _done_status(events) == "complete"
    assert "I will proceed without asking first." in _text(events)
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "complete"
    assert record["clarify"] is None


async def test_legacy_parked_clarify_answer_runs_v1_and_preserves_record_shape() -> None:
    seen_prompts: list[str] = []

    def answer_compat_prompt(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        assert isinstance(last, ModelRequest)
        prompt = next(
            part.content for part in last.parts if getattr(part, "part_kind", None) == "user-prompt"
        )
        seen_prompts.append(str(prompt))
        return ModelResponse(parts=[TextPart("Focusing on cost.")])

    rig = Rig(_fn_model(answer_compat_prompt))
    session_id = str(uuid4())
    config: Any = {"configurable": {"thread_id": session_id}}
    parked = build_turn_record(
        [],
        ids={"message_id": "m-parked", "user_message_id": "u-parked"},
        status="awaiting_input",
        sources=[],
        user_text="Is NYU good?",
        clarify={
            "spec": {
                "v": 1,
                "question": "What matters most to you?",
                "header": "Pick one",
                "multi_select": False,
                "options": [
                    {"label": "Cost", "hint": "affordability and aid"},
                    {"label": "Academics", "hint": "programs and rigor"},
                ],
            },
            "answer": None,
        },
        messages_offset=0,
    )
    await rig.graph.aupdate_state(
        config,
        {
            "messages": _serialized_user_message_for_test("Is NYU good?"),
            "turn_records": [parked],
            "source_registry": [],
        },
        as_node="agent",
    )

    events = await rig.turn(session_id, "cost", _ALL_OFF)

    assert "clarify" not in _types(events)
    assert _done_status(events) == "complete"
    assert seen_prompts
    assert "Is NYU good?" in seen_prompts[-1]
    assert "What matters most to you?" in seen_prompts[-1]
    assert "Pick one" in seen_prompts[-1]
    assert "Cost: affordability and aid" in seen_prompts[-1]
    assert "Academics: programs and rigor" in seen_prompts[-1]
    assert "cost" in seen_prompts[-1]
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert len(values["turn_records"]) == 1
    assert record["message_id"] == "m-parked"
    assert record["user_text"] == "Is NYU good?"
    assert record["clarify"]["answer"] == "cost"
    assert record["clarify"]["spec"]["question"] == "What matters most to you?"
    assert record["synthesized_answer"] is True
    assert prose_of(record["parts"]) == "Focusing on cost."


async def test_legacy_parked_clarify_failure_preserves_accepted_answer() -> None:
    def always_raises(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise RuntimeError("agent node exploded")

    rig = Rig(_fn_model(always_raises))
    session_id = str(uuid4())
    config: Any = {"configurable": {"thread_id": session_id}}
    parked = build_turn_record(
        [],
        ids={"message_id": "m-parked", "user_message_id": "u-parked"},
        status="awaiting_input",
        sources=[],
        user_text="Should I ED to NYU?",
        clarify={
            "spec": {
                "v": 1,
                "question": "Which factor should I optimize for?",
                "header": "Choose focus",
                "multi_select": False,
                "options": [
                    {"label": "Cost", "hint": "aid and net price"},
                    {"label": "Fit", "hint": "campus and academics"},
                ],
            },
            "answer": None,
        },
        messages_offset=0,
    )
    await rig.graph.aupdate_state(
        config,
        {
            "messages": _serialized_user_message_for_test("Should I ED to NYU?"),
            "turn_records": [parked],
            "source_registry": [],
        },
        as_node="agent",
    )

    events = await rig.turn(session_id, "the first one", _ALL_OFF)

    assert "error" in _types(events)
    values = await _state_values(rig, session_id)
    assert len(values["turn_records"]) == 1
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert record["message_id"] == "m-parked"
    assert record["user_text"] == "Should I ED to NYU?"
    assert record["clarify"]["answer"] == "the first one"
    assert record["clarify"]["spec"]["question"] == "Which factor should I optimize for?"
    assert record["synthesized_answer"] is True


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


def _search_unless_ask_student_mounted(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    """Would ask the student if mounted; Agent V1 should search and continue."""
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I checked the available search result.")])
    if "ask_student" not in {tool.name for tool in info.function_tools}:
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "dorms"})])
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


async def test_unmounted_ask_student_produces_no_clarify_and_search_steps_close() -> None:
    rig = Rig(_fn_model(_search_unless_ask_student_mounted))

    events = await rig.turn(str(uuid4()), "Is NYU good?", _WEB_ONLY)

    assert "clarify" not in _types(events)
    assert _done_status(events) == "complete"
    steps = _steps(events)
    assert not any("ask_student" in step["label"] for step in steps)
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


def _two_viz_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("Final answer after the cards.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Card one",
                },
            ),
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["cost.net_price"],
                    "title": "Card two",
                },
            ),
        ]
    )


def _viz_marker_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    returns = (
        [part for part in last.parts if isinstance(part, ToolReturnPart)]
        if isinstance(last, ModelRequest)
        else []
    )
    if returns:
        marker = _placement_marker(returns[0])
        return ModelResponse(parts=[TextPart(f"Intro before card. {marker} Outro after card.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Inline card",
                },
            )
        ]
    )


def _stray_viz_marker_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[TextPart("Plain answer [[viz:1]] with no card.")])


def _split_stray_viz_marker_model() -> FunctionModel:
    def response(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        if isinstance(last, ModelRequest) and any(
            isinstance(part, ToolReturnPart) for part in last.parts
        ):
            return ModelResponse(parts=[TextPart("Plain [[viz:1]] with no card.")])
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "dorms"})])

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        model_response = response(messages, info)
        for index, part in enumerate(model_response.parts):
            if isinstance(part, TextPart):
                yield "Plain [[vi"
                yield "z:1]] with no card."
            elif isinstance(part, ToolCallPart):
                yield {
                    index: DeltaToolCall(
                        name=part.tool_name,
                        json_args=part.args_as_json_str(),
                    )
                }

    return FunctionModel(response, stream_function=stream)


def _split_no_viz_text_model(chunks: list[str]) -> FunctionModel:
    def response(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        if isinstance(last, ModelRequest) and any(
            isinstance(part, ToolReturnPart) for part in last.parts
        ):
            return ModelResponse(parts=[TextPart("".join(chunks))])
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "dorms"})])

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        model_response = response(messages, info)
        for index, part in enumerate(model_response.parts):
            if isinstance(part, TextPart):
                for chunk in chunks:
                    yield chunk
            elif isinstance(part, ToolCallPart):
                yield {
                    index: DeltaToolCall(
                        name=part.tool_name,
                        json_args=part.args_as_json_str(),
                    )
                }

    return FunctionModel(response, stream_function=stream)


def _placement_marker(part: ToolReturnPart) -> str:
    assert isinstance(part.content, dict)
    marker = part.content["placement_marker"]
    assert isinstance(marker, str)
    return marker


async def test_viz_marker_places_card_between_final_text_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Inline card")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_viz_marker_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "place the card inline", _ALL_OFF)

    types = _types(events)
    delta_positions = [index for index, event in enumerate(events) if event.type == "delta"]
    viz_position = types.index("viz")
    assert len(delta_positions) == 2
    assert delta_positions[0] < viz_position < delta_positions[1]
    assert _text(events) == "Intro before card.  Outro after card."
    assert "[[viz:" not in _text(events)

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert [part["type"] for part in record["parts"]] == ["text", "viz", "text"]
    assert record["parts"][0]["text"] == "Intro before card. "
    assert record["parts"][2]["text"] == " Outro after card."
    assert all("[[viz:" not in part.get("text", "") for part in record["parts"])

    from app.transcript import extract_transcript

    transcript = extract_transcript(values["messages"], values["turn_records"])
    assistant = transcript[-1]
    assert assistant["text"] == _text(events)
    assert assistant["parts"] == record["parts"]


async def test_no_viz_final_answer_strips_stray_marker_text() -> None:
    rig = Rig(_fn_model(_stray_viz_marker_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "answer plainly", _ALL_OFF)

    assert "viz" not in _types(events)
    assert _text(events) == "Plain answer  with no card."
    assert "[[viz:" not in _text(events)

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert [part["type"] for part in record["parts"]] == ["text"]
    assert record["parts"][0]["text"] == "Plain answer  with no card."


async def test_no_viz_final_answer_strips_split_marker_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_feed_text = EmissionRouter._feed_text

    def start_final_before_split_text(router: Any, text: str) -> None:
        if text and not router.final_answer_started:
            router._start_final_answer()
        original_feed_text(router, text)

    monkeypatch.setattr(
        EmissionRouter,
        "_feed_text",
        start_final_before_split_text,
    )
    rig = Rig(_split_stray_viz_marker_model())
    session_id = str(uuid4())

    events = await rig.turn(
        session_id,
        "answer plainly after a search",
        SourceConfig(web=True, reddit=False, edu=False),
    )

    assert "viz" not in _types(events)
    assert _text(events) == "Plain  with no card."
    assert "[[viz:" not in _text(events)
    assert "z:1]]" not in _text(events)


@pytest.mark.parametrize(
    ("chunks", "expected"),
    [
        (["Plain [[viz:1]]", "] with no card."], "Plain  with no card."),
        (["Plain [[viz:abc]]", "] with no card."], "Plain  with no card."),
    ],
)
async def test_no_viz_final_answer_strips_extra_closing_marker_junk(
    monkeypatch: pytest.MonkeyPatch,
    chunks: list[str],
    expected: str,
) -> None:
    original_feed_text = EmissionRouter._feed_text

    def start_final_before_split_text(router: Any, text: str) -> None:
        if text and not router.final_answer_started:
            router._start_final_answer()
        original_feed_text(router, text)

    monkeypatch.setattr(
        EmissionRouter,
        "_feed_text",
        start_final_before_split_text,
    )
    rig = Rig(_split_no_viz_text_model(chunks))
    session_id = str(uuid4())

    events = await rig.turn(
        session_id,
        "answer plainly after a search",
        SourceConfig(web=True, reddit=False, edu=False),
    )

    assert "viz" not in _types(events)
    assert _text(events) == expected
    assert "[[viz:" not in _text(events)
    assert "] with no card." not in _text(events)


def test_final_writer_strips_late_markers_after_early_flush() -> None:
    spec = {"type": "stat_block", "title": "Card"}
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([spec], emitted.append)

    writer.start_final()
    writer.write({"type": "delta", "text": "Intro [[viz:1]]"})
    writer.write({"type": "thinking", "text": "interleaved"})
    writer.write({"type": "delta", "text": " Late [[viz:1]]"})
    writer.write({"type": "delta", "text": "] text with no leaked marker."})
    writer.flush_final()

    assert emitted == [
        {"type": "delta", "text": "Intro "},
        {"type": "viz", "spec": spec},
        {"type": "thinking", "text": "interleaved"},
        {"type": "delta", "text": " Late "},
        {"type": "delta", "text": " text with no leaked marker."},
    ]


async def test_viz_without_marker_falls_back_after_final_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        _viz_spec("admissions.rate", title="Card one"),
        _viz_spec("cost.net_price", title="Card two"),
    ]

    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return specs.pop(0)

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_two_viz_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "compare these", _ALL_OFF)

    types = _types(events)
    step_end_positions = [
        index
        for index, event in enumerate(events)
        if event.type == "step" and event.data["status"] == "end"
    ]
    viz_positions = [index for index, event in enumerate(events) if event.type == "viz"]
    first_delta = types.index("delta")
    assert len(viz_positions) == 2
    assert step_end_positions and max(step_end_positions) < viz_positions[0]
    assert first_delta < viz_positions[0]
    assert _text(events) == "Final answer after the cards."

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert [part["type"] for part in record["parts"]] == ["text", "viz", "viz"]
    assert prose_of(record["parts"]) == "Final answer after the cards."


async def test_event_order_final_answer_streams_staged_cards_after_answer_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await test_viz_without_marker_falls_back_after_final_answer(monkeypatch)


async def test_duplicate_render_viz_final_flush_persists_one_viz_part(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        _viz_spec("admissions.rate", title="First title"),
        _viz_spec("admissions.rate", title="Second title"),
    ]

    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return specs.pop(0)

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_two_viz_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "compare these", _ALL_OFF)

    assert _types(events).count("viz") == 1
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    viz_parts = [part for part in record["parts"] if part["type"] == "viz"]
    assert len(viz_parts) == 1
    assert viz_parts[0]["spec"]["title"] == "First title"
    assert len(values["viz_emitted"]) == 1


async def test_record_exact_final_content_stream_record_and_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        _viz_spec("admissions.rate", title="First title"),
        _viz_spec("admissions.rate", title="Second title"),
    ]

    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return specs.pop(0)

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_two_viz_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "compare these", _ALL_OFF)

    stream_viz = [event.data for event in events if event.type == "viz"]
    assert len(stream_viz) == 1
    assert _text(events) == "Final answer after the cards."

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["parts"] == [
        {"type": "text", "text": "Final answer after the cards."},
        {"type": "viz", "spec": stream_viz[0]},
    ]
    assert prose_of(record["parts"]) == _text(events)

    from app.transcript import extract_transcript

    transcript = extract_transcript(values["messages"], values["turn_records"])
    assistant = transcript[-1]
    assert assistant["text"] == _text(events)
    assert assistant["parts"] == record["parts"]
    assert [part["type"] for part in assistant["parts"]] == ["text", "viz"]


def _render_then_continue_without_clarify(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    last = messages[-1]
    returns = (
        [part for part in last.parts if isinstance(part, ToolReturnPart)]
        if isinstance(last, ModelRequest)
        else []
    )
    if returns:
        if "ask_student" not in {tool.name for tool in info.function_tools}:
            return ModelResponse(parts=[TextPart("Final answer after the early card.")])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="ask_student",
                    args={
                        "question": "Which comparison matters?",
                        "header": "Pick one",
                        "options": [
                            {"label": "Cost", "hint": "net price and aid"},
                            {"label": "Admissions", "hint": "selectivity"},
                        ],
                    },
                )
            ]
        )
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Early card",
                },
            )
        ]
    )


async def test_unmounted_ask_student_allows_staged_viz_to_flush_with_final_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Early card")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_render_then_continue_without_clarify))

    session_id = str(uuid4())
    events = await rig.turn(session_id, "show me a comparison", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert "clarify" not in _types(events)
    assert "viz" in _types(events)
    assert _text(events) == "Final answer after the early card."
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "complete"
    assert record["clarify"] is None
    assert [part["type"] for part in record["parts"]] == ["text", "viz"]


def _narrate_render_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("Final answer only.")])
    return ModelResponse(
        parts=[
            TextPart("I will check the cited data before answering."),
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Card",
                },
            ),
        ]
    )


async def test_no_early_answer_persists_only_final_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Card")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_narrate_render_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "show me a comparison", _ALL_OFF)

    assert "I will check the cited data before answering." in _thinking(events)
    assert _text(events) == "Final answer only."
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert prose_of(record["parts"]) == "Final answer only."


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


def _render_then_hit_budget(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "x"})])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Hidden until final",
                },
            )
        ]
    )


async def test_budget_before_final_staged_viz_does_not_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Hidden until final")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    settings = FakeSettings()
    settings.max_tool_rounds = 1
    rig = Rig(_fn_model(_render_then_hit_budget), settings=settings)
    session_id = str(uuid4())

    events = await rig.turn(session_id, "show me a comparison", _WEB_ONLY)

    assert _types(events).count("viz") == 0
    assert _text(events).count("tool budget") == 1
    assert _done_status(events) == "complete"
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert [part["type"] for part in record["parts"]] == ["text"]
    assert prose_of(record["parts"]).count("tool budget") == 1
    assert values["viz_emitted"] == []


class _BudgetAfterFinalStream:
    def __init__(self, tools: dict[str, Any]) -> None:
        self._tools = tools

    async def __aenter__(self) -> _BudgetAfterFinalStream:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def __aiter__(self) -> AsyncIterator[Any]:
        call = ToolCallPart(
            tool_name="render_viz",
            args={
                "type": "comparison_table",
                "unitids": [1],
                "field_keys": ["admissions.rate"],
                "title": "Visible card",
            },
            tool_call_id="viz-after-final",
        )
        yield FunctionToolCallEvent(part=call)
        result = await self._tools["render_viz"].function(
            "comparison_table", [1], ["admissions.rate"], "Visible card"
        )
        yield FunctionToolResultEvent(
            ToolReturnPart(
                tool_name="render_viz",
                content=result,
                tool_call_id="viz-after-final",
            )
        )
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartStartEvent(index=0, part=TextPart(content="Partial final answer."))
        raise UsageLimitExceeded("forced budget after final start")


class _BudgetAfterFinalAgent:
    def __init__(self, *args: Any, tools: list[Any], **kwargs: Any) -> None:
        self._tools = {tool.name: tool for tool in tools}

    async def __aenter__(self) -> _BudgetAfterFinalAgent:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def run_stream_events(self, *args: Any, **kwargs: Any) -> _BudgetAfterFinalStream:
        return _BudgetAfterFinalStream(self._tools)


async def test_budget_after_final_partial_preserves_visible_viz_and_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Visible card")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    monkeypatch.setattr(app.agent_node, "Agent", _BudgetAfterFinalAgent)
    rig = Rig(TestModel(call_tools=[], custom_output_text="unused"))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "show me a comparison", _ALL_OFF)

    types = _types(events)
    assert types.count("viz") == 1
    assert types.index("delta") < types.index("viz")
    assert _text(events).count("Partial final answer.") == 1
    assert _text(events).count("tool budget") == 1
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert [part["type"] for part in record["parts"]] == ["text", "viz", "text"]
    assert prose_of(record["parts"]) == _text(events)
    assert len(values["viz_emitted"]) == 1


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


async def test_ask_student_absence_writes_complete_non_clarify_record() -> None:
    rig = Rig(_fn_model(_ask_student_probe))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Is NYU good?", _ALL_OFF)
    meta = events[0].data

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    assert len(records) == 1
    record = records[0]
    assert record["status"] == "complete"
    assert record["message_id"] == meta["message_id"]
    assert record["user_message_id"] == meta["user_message_id"]
    assert record["clarify"] is None
    assert record["synthesized_answer"] is False
    assert record["user_text"] == "Is NYU good?"
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == _text(events)


async def test_error_turn_writes_record_without_streamed_pre_final_prose() -> None:
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
    thinking = "".join(event.data["text"] for event in events if event.type == "thinking")
    assert long_prose.strip() in thinking
    assert streamed == ""

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert record["error"]["trace_id"] == trace_id
    assert record["error"]["message"]
    assert record["message_id"] == events[0].data["message_id"]
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == streamed
    assert long_prose.strip() in "".join(record["thinking"])
    assert all(message["kind"] == "request" for message in values["messages"])


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
    """_prepare_turn_input (audit M3) yields an Agent V1 compatibility prompt
    when the prior records show a parked (awaiting_input) tail and reuses the
    parked message_id's offset; it yields a new-turn dict input when not parked."""
    from app.run_turn import _prepare_turn_input, _ResumePrewriteError
    from app.turn_persistence import parked_record

    rig = Rig(_fn_model(_ask_student_probe))

    # --- parked branch: a parked record at the tail → V1 compatibility prompt ---
    parked_rec: dict[str, Any] = {
        "message_id": "m-parked",
        "user_message_id": "u-0",
        "status": "awaiting_input",
        "user_text": "Is NYU good?",
        "messages_offset": 1,
    }
    parked_records: list[dict[str, Any]] = [parked_rec]

    class _Snap:
        values: dict[str, Any] = {
            "messages": [{"kind": "request", "parts": []}, {"kind": "request", "parts": []}],
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
    assert isinstance(resume_input.graph_input, dict)
    # The answer is fed back to Agent V1 explicitly; no legacy Command resume.
    compat_prompt = resume_input.graph_input["messages"][-1]["parts"][0]["content"]
    assert "Is NYU good?" in compat_prompt
    assert "cost" in compat_prompt
    assert "Do not ask another clarifying question" in compat_prompt
    # The parked record's offset is carried forward (the original question index).
    assert resume_input.messages_offset == 1
    assert resume_input.graph_input["messages"][0] == _Snap.values["messages"][0]

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
