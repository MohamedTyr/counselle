"""Unit tests for the turn runner + agent node (Slice F). No DB, no network, no LLM.

Rig: memory checkpointer, ``FunctionModel``/``TestModel`` injected through the
``AppDeps.model_factory`` seam, a fake asyncpg pool for the session row, and
``app.graph.build_temporal_context`` monkeypatched so ``prepare`` never touches
the database (notes-p4-apis §10).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphInterrupt
from langgraph.types import Interrupt
from pydantic_ai import FinalResultEvent
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    PartStartEvent,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)
from pydantic_ai.models.test import TestModel
from pydantic_graph import End

import app.agent_node
import app.graph
import app.skills
import app.viz
from app.deps import AppDeps
from app.graph import build_graph
from app.records import build_turn_record, prose_of
from app.run_handle import RunHandleStore
from app.run_turn import run_turn
from app.sources import SourceRegistry
from app.state import TemporalContext
from app.steps import EmissionRouter
from app.toolset import ToolDeps
from app.transcript import extract_transcript
from app.viz_signature import render_spec_signature, viz_payload_signature
from domain.envelope import Citation, EvidenceItem
from domain.events import Event
from domain.season import Season
from domain.specs import AvailableResolvedCell, RenderSpec, SchoolRef, SourceConfig, VizRow

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSettings:
    """The slice of Settings the runner + node + registry read."""

    model_counselor = "google-vertex:gemini-2.5-pro"
    agent_max_model_requests = 80
    agent_max_total_tokens = 2_000_000
    vertex_api_key = None
    source_web_default = True
    source_reddit_default = True
    source_edu_default = True
    search_max_results = 5
    thinking_stream = True
    thinking_summaries: bool | None = None
    effective_thinking_stream: bool | None = None
    thinking_threshold_chars = 240  # CFG-07: agent_node reads this at router build
    # Turn-registry knobs (CFG-02: the registry reads these directly, no getattr
    # fallback). The existing per-test overrides (settings.agent_stream_buffer_size = 2,
    # etc.) now override a real default instead of a non-existent attribute.
    max_concurrent_turns: int = 50
    agent_stream_buffer_size: int = 100_000
    max_consumers_per_turn: int = 8
    # float-typed so tests can drop it to 0.1 to fire the watchdog fast.
    agent_turn_timeout_s: float = 3600
    agent_mcp_read_timeout_s: float = 60.0
    agent_tool_result_max_chars: int = 8_000
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
    context="Today is 2026-06-10.",
)


_STUDENT_CONTEXT = "## About This Student\nTest student context."


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading in the prompt builder."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    async def fake_student_context(app_pool: Any, *, user_id: Any) -> str:
        return _STUDENT_CONTEXT

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.graph, "build_student_context", fake_student_context)
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
        self,
        session_id: str,
        text: str,
        source_config: SourceConfig | None = None,
        *,
        user_id: str | None = None,
    ) -> list[Event]:
        return [
            event
            async for event in run_turn(
                session_id,
                text,
                source_config,
                deps=self.deps,
                graph=self.graph,
                user_id=user_id,
            )
        ]


async def test_real_graph_interrupt_parks_pending_evidence_and_resume_promotes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    citation = Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256="a" * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.1",
        school_unitid=198419,
    )
    calls = 0

    def interrupting_skill(name: str) -> Any:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {
                "field": "admissions.applicants",
                "label": "Applicants",
                "display": "50,000",
                "available": True,
                "citation": citation.model_dump(mode="json"),
                "evidence": {
                    "eid": "admissions.applicants",
                    "value_display": "50,000",
                    "label": "Applicants",
                    "page": 3,
                    "excerpt": "Applicants total 50,000.",
                },
            }
        raise GraphInterrupt(
            [
                Interrupt(
                    value={
                        "question": "Which year should I use?",
                        "header": "Choose year",
                        "options": [
                            {"label": "2024", "hint": "latest complete year"},
                            {"label": "2023", "hint": "prior year"},
                        ],
                        "multi_select": False,
                    },
                    id="clarify-evidence",
                )
            ]
        )

    monkeypatch.setattr(app.skills, "load_skill", interrupting_skill)

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        prompt = next(
            (
                str(part.content)
                for message in reversed(messages)
                if isinstance(message, ModelRequest)
                for part in message.parts
                if isinstance(part, UserPromptPart)
            ),
            "",
        )
        if "student answered the earlier clarification" in prompt:
            return ModelResponse(
                parts=[
                    TextPart(
                        "There were 50,000 applicants [1][[evidence:1:admissions.applicants]]."
                    )
                ]
            )
        returned = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        return ModelResponse(
            parts=[ToolCallPart(tool_name="load_skill", args={"name": "test"})]
            if len(returned) < 2
            else [TextPart("unreachable")]
        )

    rig = Rig(_fn_model(model))
    session_id = str(uuid4())
    user_id = str(uuid4())
    first = await rig.turn(session_id, "Compare applicants", _ALL_OFF, user_id=user_id)
    assert first[-1].data["status"] == "awaiting_input"
    meta = first[0].data
    assert rig.deps.parked_sources.restore(session_id, meta["message_id"], str(uuid4())) is None
    parked = rig.deps.parked_sources.restore(session_id, meta["message_id"], user_id)
    assert parked is not None
    assert parked.promote_pending_evidence(1, "admissions.applicants")

    resumed = await rig.turn(session_id, "2024", _ALL_OFF, user_id=user_id)
    assert resumed[-1].data["status"] == "complete"
    assert "[[evidence:" not in "".join(
        event.data.get("text", "") for event in resumed if isinstance(event.data, dict)
    )
    source_event = next(event for event in resumed if event.type == "sources")
    assert source_event.data["sources"][0]["evidence"][0]["eid"] == "admissions.applicants"
    assert rig.deps.parked_sources.restore(session_id, meta["message_id"], user_id) is None


async def test_sse_and_transcript_stream_unvalidated_marker_and_promote_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The runtime never inspects or withholds the agent's prose: an unregistered
    marker ([2]) streams verbatim, while the hidden [[evidence]] token still
    strips from view and promotes its exact CDS row into the sources rail."""
    citation = Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256="a" * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.2",
        school_unitid=130794,
    )

    monkeypatch.setattr(
        app.skills,
        "load_skill",
        lambda _name: {
            "field": "enrollment.undergraduate_total",
            "label": "Undergraduate enrollment",
            "display": "6,814",
            "available": True,
            "citation": citation.model_dump(mode="json"),
            "evidence": {
                "eid": "enrollment.undergraduate_total",
                "value_display": "6,814",
                "label": "Undergraduate enrollment",
                "page": 4,
                "excerpt": "Undergraduate enrollment 6,814.",
            },
        },
    )

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        del info
        returned = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if not returned:
            return ModelResponse(
                parts=[ToolCallPart(tool_name="load_skill", args={"name": "test"})]
            )
        return ModelResponse(
            parts=[
                TextPart(
                    "Undergraduate enrollment was 6,814 [2]"
                    "[[evidence:1:enrollment.undergraduate_total]]."
                )
            ]
        )

    rig = Rig(_fn_model(model))
    session_id = str(uuid4())
    events = await rig.turn(session_id, "What is Yale enrollment?", _ALL_OFF)

    assert _text(events) == "Undergraduate enrollment was 6,814 [2]."
    assert "[[evidence:" not in _text(events)
    source_event = next(event for event in events if event.type == "sources")
    assert source_event.data["sources"][0]["index"] == 1
    assert events[-1].type == "done"

    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    transcript = extract_transcript(
        list(snapshot.values.get("messages") or []),
        list(snapshot.values.get("turn_records") or []),
    )
    assert transcript[-1]["text"] == "Undergraduate enrollment was 6,814 [2]."
    assert "[[evidence:" not in str(snapshot.values.get("messages") or [])
    assert transcript[-1]["sources"][0]["index"] == source_event.data["sources"][0]["index"]
    persisted_citation = transcript[-1]["sources"][0]["citation"]
    streamed_citation = source_event.data["sources"][0]["citation"]
    assert persisted_citation["source"] == streamed_citation["source"] == "cds"
    assert persisted_citation["document_sha256"] == streamed_citation["document_sha256"]


class _ImmediateEndRun:
    next_node = End(data=None)
    result = None

    async def __aenter__(self) -> _ImmediateEndRun:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _CapturingAgent:
    captured_model_settings: list[Any] = []

    def __init__(self, *args: Any, model_settings: Any = None, **kwargs: Any) -> None:
        self.captured_model_settings.append(model_settings)

    async def __aenter__(self) -> _CapturingAgent:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def iter(self, *args: Any, **kwargs: Any) -> _ImmediateEndRun:
        return _ImmediateEndRun()

    @staticmethod
    def is_model_request_node(node: Any) -> bool:
        return False

    @staticmethod
    def is_call_tools_node(node: Any) -> bool:
        return False


def _types(events: list[Event]) -> list[str]:
    return [event.type for event in events]


def _text(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "delta")


def _thinking(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "thinking")


def _narration(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "narration")


def _done_status(events: list[Event]) -> str:
    return str(next(event.data["status"] for event in events if event.type == "done"))


_ALL_OFF = SourceConfig(web=False, reddit=False, edu=False)


def _viz_cell(field: str, raw: int = 42) -> AvailableResolvedCell:
    return AvailableResolvedCell(
        field=field,
        label=field,
        display=str(raw),
        raw=raw,
        available=True,
        unit="number",
        citation=Citation(
            source="web",
            tier="official",
            vintage="Retrieved 2026-01-01",
            url=f"https://example.edu/{field}",
        ),
        marker="[1]",
    )


def _viz_spec(field: str, *, title: str = "Rendered card") -> RenderSpec:
    return RenderSpec(
        type="stat_block",
        title=title,
        columns=(SchoolRef(unitid=1, name="A University"),),
        rows=(VizRow(label=field, cells=(_viz_cell(field),)),),
    )


def _fake_render_specs(*specs: RenderSpec) -> Callable[..., Any]:
    queue = list(specs)

    async def fake(
        _catalog: object,
        _registry: object,
        viz_emitted: list[dict[str, Any]],
        _type: str,
        _columns: object,
        _rows: object,
        _title: str | None = None,
        _indexes: object = None,
    ) -> dict[str, Any]:
        spec = queue.pop(0)
        signature = render_spec_signature(spec)
        index = next(
            (
                position
                for position, payload in enumerate(viz_emitted, start=1)
                if viz_payload_signature(payload) == signature
            ),
            None,
        )
        if index is None:
            viz_emitted.append(spec.model_dump(mode="json"))
            index = len(viz_emitted)
        return {
            "ok": True,
            "status": "rendered",
            "placement_marker": f"[[viz:{index}]]",
            "cell_count": 1,
            "available_count": 1,
            "unavailable_count": 0,
            "source_count": 1,
            "sources": ["[1]"],
            "public_receipt": {"viz_type": spec.type, "value_count": 1},
        }

    return fake


def _node_state(prompt: str = "hi") -> dict[str, Any]:
    messages = ModelMessagesTypeAdapter.dump_python(
        [ModelRequest(parts=[UserPromptPart(content=prompt)])],
        mode="json",
    )
    return {
        "messages": messages,
        "source_registry": [],
        "source_config": _ALL_OFF.model_dump(mode="json"),
        "temporal": {"today": _TEMPORAL.today, "context": _TEMPORAL.context},
        "turn_ids": {"message_id": "assistant-1", "user_message_id": "user-1"},
        "turn_records": [],
        "tool_result_store": {},
    }


async def _run_node_capturing_model_settings(
    monkeypatch: pytest.MonkeyPatch,
    settings: FakeSettings,
) -> Any:
    _CapturingAgent.captured_model_settings = []
    monkeypatch.setattr(app.agent_node, "Agent", _CapturingAgent)
    monkeypatch.setattr(app.agent_node, "get_stream_writer", lambda: lambda chunk: None)
    monkeypatch.setattr(app.agent_node, "build_tools", lambda *args, **kwargs: [])

    deps = AppDeps(
        catalog=SimpleNamespace(school_count=0),  # type: ignore[arg-type]
        app_pool=None,
        settings=settings,
        run_handles=None,
        tool_deps=ToolDeps(
            catalog=None,
            search_max_results=5,
            subreddit_menu=[],
            tavily_client_factory=lambda: StubTavilyClient(),
        ),
        mcp_toolset=None,
        model_factory=lambda: cast(Any, object()),
    )

    await app.agent_node.run_agent_node(_node_state(), deps)

    assert len(_CapturingAgent.captured_model_settings) == 1
    return _CapturingAgent.captured_model_settings[0]


def _google_thinking_config(model_settings: Any) -> dict[str, Any] | None:
    if model_settings is None:
        return None
    if isinstance(model_settings, dict):
        value = model_settings.get("google_thinking_config")
        return dict(value) if value is not None else None
    value = getattr(model_settings, "google_thinking_config", None)
    return dict(value) if value is not None else None


# ---------------------------------------------------------------------------
# (a) simple turn
# ---------------------------------------------------------------------------


async def test_agent_node_attaches_gemini_include_thoughts_from_effective_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    default_settings = FakeSettings()
    default_model_settings = await _run_node_capturing_model_settings(
        monkeypatch,
        default_settings,
    )
    assert _google_thinking_config(default_model_settings) == {"include_thoughts": True}

    explicit_off = FakeSettings()
    explicit_off.effective_thinking_stream = False
    explicit_off_model_settings = await _run_node_capturing_model_settings(
        monkeypatch,
        explicit_off,
    )
    assert explicit_off_model_settings is None

    legacy_off = FakeSettings()
    legacy_off.thinking_summaries = False
    legacy_off_model_settings = await _run_node_capturing_model_settings(
        monkeypatch,
        legacy_off,
    )
    assert legacy_off_model_settings is None


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


def test_successful_resolution_cannot_complete_with_empty_prose() -> None:
    emissions: list[tuple[Any, Any]] = [
        (
            "step",
            {
                "step_id": "resolve-1",
                "status": "end",
                "kind": "db_tool",
                "label": "Resolved MIT",
                "detail": {
                    "tool": "resolve_school",
                    "result_count": 1,
                    "schools": ["Massachusetts Institute of Technology"],
                },
            },
        )
    ]

    fallback = app.agent_node._empty_resolve_completion(cast(Any, emissions))

    assert fallback is not None
    assert "Massachusetts Institute of Technology" in fallback
    assert "unavailable, not zero" in fallback
    assert "won't invent" in fallback
    assert (
        app.agent_node._empty_resolve_completion(
            cast(Any, [*emissions, ("delta", "A substantive answer.")])
        )
        is None
    )
    no_name = cast(
        Any,
        [
            (
                "step",
                {
                    "status": "end",
                    "detail": {"tool": "resolve_school", "result_count": 1},
                },
            )
        ],
    )
    assert "requested school" in str(app.agent_node._empty_resolve_completion(no_name))


def test_empty_completion_fallback_replaces_empty_provider_response() -> None:
    messages = ModelMessagesTypeAdapter.dump_python(
        [
            ModelRequest(parts=[UserPromptPart(content="MIT enrollment?")]),
            ModelResponse(parts=[]),
        ],
        mode="json",
    )

    updated = app.agent_node._replace_empty_final_response(messages, "Safe fallback.")

    assert updated[-1]["kind"] == "response"
    assert updated[-1]["parts"][0]["content"] == "Safe fallback."
    assert updated[-1]["parts"][0]["part_kind"] == "text"


# ---------------------------------------------------------------------------
# (a2) identity plumbing: user_id threads into turn_ids (Phase 2 of
# plans/agent-task-tools.md — the mount-gate signal a later phase reads)
# ---------------------------------------------------------------------------


async def test_run_turn_threads_user_id_into_turn_ids() -> None:
    rig = Rig(TestModel(call_tools=[], custom_output_text="Hi there."))
    session_id = str(uuid4())
    user_id = str(uuid4())

    events = await rig.turn(session_id, "hi", _ALL_OFF, user_id=user_id)

    assert _done_status(events) == "complete"
    state = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    assert state.values["turn_ids"]["user_id"] == user_id


async def test_run_turn_without_user_id_defaults_to_none_in_turn_ids() -> None:
    """The eval runner / CLI call run_turn with no user_id — the unmounted
    agent-tools path (ADR 0013) must see None, not a missing key or a mint."""
    rig = Rig(TestModel(call_tools=[], custom_output_text="Hi there."))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "hi", _ALL_OFF)

    assert _done_status(events) == "complete"
    state = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    assert state.values["turn_ids"]["user_id"] is None


async def test_parked_resume_carries_user_id_through_the_prewrite() -> None:
    """A clarify resume rebuilds turn_ids via _prepare_turn_input's parked
    branch (app/run_turn.py) — user_id must survive that branch too, not
    just the fresh-turn branch."""

    def _answer_cost(messages: Any, info: Any) -> ModelResponse:
        return ModelResponse(parts=[TextPart("Focusing on cost.")])

    rig = Rig(_fn_model(_answer_cost))
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
                "options": [{"label": "Cost", "hint": "affordability and aid"}],
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

    user_id = str(uuid4())
    events = await rig.turn(session_id, "cost", _ALL_OFF, user_id=user_id)

    assert _done_status(events) == "complete"
    state = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    assert state.values["turn_ids"]["user_id"] == user_id


def test_agent_node_turn_ids_helper_reads_user_id() -> None:
    """Pins app.agent_node._turn_ids surfacing user_id — the hoisted call site
    (ahead of the toolset block) reads this exact dict, so a future mount gate
    (Phase 3/4) sees a real value instead of a stale/missing key."""
    ids = app.agent_node._turn_ids(
        {"turn_ids": {"message_id": "m-1", "user_message_id": "u-1", "user_id": "user-7"}}
    )
    assert ids["user_id"] == "user-7"

    unauthenticated_ids = app.agent_node._turn_ids(
        {"turn_ids": {"message_id": "m-1", "user_message_id": "u-1", "user_id": None}}
    )
    assert unauthenticated_ids["user_id"] is None

    missing_ids = app.agent_node._turn_ids({"turn_ids": {}})
    assert missing_ids.get("user_id") is None


# ---------------------------------------------------------------------------
# (a3) workspace task tools: mount gate (Phase 4 of plans/agent-task-tools.md)
# ---------------------------------------------------------------------------

_WORKSPACE_TOOL_NAMES = {
    "view_tasks",
    "search_tasks",
    "create_tasks",
    "update_task",
    "archive_tasks",
    "restore_task",
}


def _record_tools(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    del messages
    _record_tools.seen = {tool.name for tool in info.function_tools}  # type: ignore[attr-defined]
    return ModelResponse(parts=[TextPart("ok")])


async def test_workspace_tools_mount_when_authenticated_with_pool_and_bus() -> None:
    from app.workspace.changes import WorkspaceEventBus

    rig = Rig(_fn_model(_record_tools))
    rig.deps.workspace_events = WorkspaceEventBus()

    await rig.turn(str(uuid4()), "hi", _ALL_OFF, user_id=str(uuid4()))

    assert _record_tools.seen >= _WORKSPACE_TOOL_NAMES  # type: ignore[attr-defined]


async def test_workspace_tools_stay_unmounted_without_user_id() -> None:
    from app.workspace.changes import WorkspaceEventBus

    rig = Rig(_fn_model(_record_tools))
    rig.deps.workspace_events = WorkspaceEventBus()

    await rig.turn(str(uuid4()), "hi", _ALL_OFF)  # no user_id: eval/CLI shape

    assert not (_WORKSPACE_TOOL_NAMES & _record_tools.seen)  # type: ignore[attr-defined]


async def test_workspace_tools_stay_unmounted_without_event_bus() -> None:
    rig = Rig(_fn_model(_record_tools))
    rig.deps.workspace_events = None

    await rig.turn(str(uuid4()), "hi", _ALL_OFF, user_id=str(uuid4()))

    assert not (_WORKSPACE_TOOL_NAMES & _record_tools.seen)  # type: ignore[attr-defined]


def _hallucinate_create_tasks_then_answer(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    from pydantic_ai.messages import RetryPromptPart

    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, (ToolReturnPart, RetryPromptPart)) for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I cannot manage tasks right now.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="create_tasks",
                args={"tasks": [{"title": "Request transcript"}]},
            )
        ]
    )


async def test_hallucinated_create_tasks_while_unmounted_paints_no_step() -> None:
    """Mirrors the ask_student unmounted-hallucination test: a call to a
    gated-but-unmounted tool must never paint a timeline step (ADR 0013)."""
    rig = Rig(_fn_model(_hallucinate_create_tasks_then_answer))

    events = await rig.turn(str(uuid4()), "add a task", _ALL_OFF)  # no user_id

    assert _done_status(events) == "complete"
    steps = _steps(events)
    assert not any(step["kind"] == "workspace" for step in steps)
    _assert_every_step_start_has_a_terminal(events)


def _create_one_task_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) and part.tool_name == "create_tasks" for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("Added the task to your board.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="create_tasks",
                args={"tasks": [{"title": "Request transcript"}]},
            )
        ]
    )


@pytest.mark.live_db
async def test_create_tasks_tool_streams_workspace_step_with_task_added_ui() -> None:
    """End-to-end through the graph against a real pool (create_tasks writes a
    row via service_tasks); mirrors test_write_plan_tool_produces_visible_step_receipt
    but needs a live DB because the tool isn't monkeypatched."""
    from app.workspace.changes import WorkspaceEventBus
    from config.settings import get_settings
    from counselle_db.db import create_pool

    pool = await create_pool(dsn=get_settings().db_app_dsn)
    user_id = uuid4()
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.users
                  (id, email, hashed_password, is_active, is_superuser, is_verified)
                VALUES ($1, $2, $3, true, false, false)
                """,
                user_id,
                f"{user_id}@workspace.test",
                "not-a-real-password-hash",
            )

        rig = Rig(_fn_model(_create_one_task_then_answer))
        rig.deps.app_pool = pool
        rig.deps.workspace_events = WorkspaceEventBus()

        events = await rig.turn(str(uuid4()), "add a task", _ALL_OFF, user_id=str(user_id))

        assert _done_status(events) == "complete"
        workspace_steps = [
            event.data
            for event in events
            if event.type == "step" and event.data["kind"] == "workspace"
        ]
        assert [step["status"] for step in workspace_steps] == ["start", "end"]
        end_step = workspace_steps[-1]
        assert end_step["ui"]["widget"] == "task_added"
        assert end_step["ui"]["data"]["count"] == 1
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", user_id)
        await pool.close()


# ---------------------------------------------------------------------------
# (b) tool-loop bound (settings.agent_max_model_requests)
# ---------------------------------------------------------------------------


async def test_endless_tool_caller_is_cut_off_with_a_clean_error_delta() -> None:
    def endless(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="load_skill", args={"name": "x"})])

    settings = FakeSettings()
    settings.agent_max_model_requests = 2
    rig = Rig(_fn_model(endless), settings=settings)

    events = await rig.turn(str(uuid4()), "hi", _ALL_OFF)

    assert "error" not in _types(events)  # clean delta, not a crash
    assert "tool budget" in _text(events)
    assert _done_status(events) == "complete"


async def test_token_budget_is_wired_to_the_same_budget_path() -> None:
    def answers(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart("ok")])

    settings = FakeSettings()
    settings.agent_max_total_tokens = 1
    rig = Rig(_fn_model(answers), settings=settings)

    events = await rig.turn(str(uuid4()), "hi", _ALL_OFF)

    assert "error" not in _types(events)
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
    assert {"write_plan", "render_viz", "load_skill", "read_tool_result"} <= set(seen)
    assert "ask_student" not in seen


def _plan_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) and part.tool_name == "write_plan" for part in last.parts
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


def _two_plans_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    returns = [
        part
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart) and part.tool_name == "write_plan"
    ]
    if len(returns) >= 2:
        return ModelResponse(parts=[TextPart("I made two plan updates and answered.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="write_plan",
                args={
                    "items": [
                        {
                            "content": f"Plan checkpoint {len(returns) + 1}",
                            "status": "completed",
                        }
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


async def test_iter_run_handle_records_replay_safe_tool_snapshots() -> None:
    store = RunHandleStore()
    rig = Rig(_fn_model(_two_plans_then_answer))
    rig.deps.run_handles = store
    session_id = str(uuid4())
    handle = store.register(session_id)

    events = await rig.turn(session_id, "Make two quick plans", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert handle.snapshot_seq >= 1
    assert app.agent_node.is_provider_replayable(handle.messages_snapshot)
    tool_calls = [
        part
        for message in handle.messages_snapshot
        for part in message["parts"]
        if part.get("part_kind") == "tool-call"
    ]
    tool_returns = [
        part
        for message in handle.messages_snapshot
        for part in message["parts"]
        if part.get("part_kind") == "tool-return"
    ]
    assert len(tool_calls) == 2
    assert len(tool_returns) == 2


def test_replay_snapshot_validator_rejects_dangling_tool_call() -> None:
    messages = ModelMessagesTypeAdapter.dump_python(
        [
            ModelRequest(parts=[UserPromptPart(content="hi")]),
            ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="write_plan",
                        args={"items": []},
                        tool_call_id="dangling-call",
                    )
                ]
            ),
        ],
        mode="json",
    )

    assert not app.agent_node.is_provider_replayable(messages)


class _GoldenModelRequestNode:
    def __init__(self, *, final: bool = False) -> None:
        self.final = final

    def stream(self, ctx: Any) -> _GoldenModelRequestNode:
        return self

    async def __aenter__(self) -> _GoldenModelRequestNode:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def __aiter__(self) -> AsyncIterator[Any]:
        if self.final:
            yield FinalResultEvent(tool_name=None, tool_call_id=None)
            yield PartStartEvent(index=0, part=TextPart(content="Here is the final answer."))
            return
        yield PartStartEvent(index=0, part=TextPart(content="I'll check the plan first."))
        yield FunctionToolCallEvent(
            part=ToolCallPart(
                tool_name="write_plan",
                args={
                    "items": [
                        {"content": "Check school facts", "status": "completed"},
                        {"content": "Answer the student", "status": "in_progress"},
                    ]
                },
                tool_call_id="plan-call",
            )
        )


class _GoldenCallToolsNode:
    def stream(self, ctx: Any) -> _GoldenCallToolsNode:
        return self

    async def __aenter__(self) -> _GoldenCallToolsNode:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def __aiter__(self) -> AsyncIterator[FunctionToolResultEvent]:
        yield FunctionToolResultEvent(
            part=ToolReturnPart(
                tool_name="write_plan",
                content={
                    "status": "success",
                    "summary": "Plan updated.",
                    "rendered_plan": "1. [x] Check school facts",
                    "public_receipt": {
                        "items": [
                            {"content": "Check school facts", "status": "completed"},
                            {"content": "Answer the student", "status": "in_progress"},
                        ],
                        "completed": 1,
                        "total": 2,
                    },
                    "next_actions": ["Continue with the in-progress step."],
                },
                tool_call_id="plan-call",
            )
        )


class _GoldenIterResult:
    @property
    def usage(self) -> SimpleNamespace:
        return SimpleNamespace(input_tokens=3, output_tokens=4, tool_calls=1)

    def all_messages(self) -> list[ModelMessage]:
        return [
            ModelRequest(parts=[UserPromptPart(content="Make a plan")]),
            ModelResponse(parts=[TextPart(content="Here is the final answer.")]),
        ]


class _GoldenIterRun:
    def __init__(self) -> None:
        self.ctx = object()
        self.next_node: Any = _GoldenModelRequestNode()
        self.result: _GoldenIterResult | None = None

    async def __aenter__(self) -> _GoldenIterRun:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def next(self, node: Any) -> Any:
        if isinstance(node, _GoldenModelRequestNode) and not node.final:
            return _GoldenCallToolsNode()
        if isinstance(node, _GoldenCallToolsNode):
            return _GoldenModelRequestNode(final=True)
        if isinstance(node, _GoldenModelRequestNode) and node.final:
            self.result = _GoldenIterResult()
            return End(self.result)
        raise AssertionError(f"unexpected golden iter node: {node!r}")

    def all_messages(self) -> list[ModelMessage]:
        return self.result.all_messages() if self.result is not None else []


class _GoldenIterContext:
    async def __aenter__(self) -> _GoldenIterRun:
        return _GoldenIterRun()

    async def __aexit__(self, *exc: Any) -> bool:
        return False


class _GoldenIterAgent:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> _GoldenIterAgent:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def iter(self, *args: Any, **kwargs: Any) -> _GoldenIterContext:
        return _GoldenIterContext()

    @staticmethod
    def is_model_request_node(node: Any) -> bool:
        return isinstance(node, _GoldenModelRequestNode)

    @staticmethod
    def is_call_tools_node(node: Any) -> bool:
        return isinstance(node, _GoldenCallToolsNode)


def _event_order_signature(events: list[Event]) -> list[dict[str, Any]]:
    signature: list[dict[str, Any]] = []
    for event in events:
        data = dict(event.data)
        if event.type == "meta":
            data = {"model": data["model"]}
        elif event.type == "step":
            data = {
                key: value
                for key, value in data.items()
                if key in {"status", "kind", "label", "detail"} and value is not None
            }
            detail = data.get("detail")
            if isinstance(detail, dict):
                data["detail"] = {**detail, "duration_ms": 0}
        signature.append({"type": event.type, "data": data})
    return signature


async def test_iter_loop_matches_run_stream_events_golden_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app.agent_node, "Agent", _GoldenIterAgent)
    rig = Rig(TestModel(call_tools=[], custom_output_text="unused"))

    events = await rig.turn(str(uuid4()), "Make a plan", _ALL_OFF)

    assert _event_order_signature(events) == [
        {"type": "meta", "data": {"model": "google-vertex:gemini-2.5-pro"}},
        {"type": "narration", "data": {"text": "I'll check the plan first."}},
        {
            "type": "step",
            "data": {"status": "start", "kind": "write_plan", "label": "Updating the plan"},
        },
        {
            "type": "step",
            "data": {
                "status": "end",
                "kind": "write_plan",
                "label": "Updating the plan",
                "detail": {
                    "duration_ms": 0,
                    "items": [
                        {"content": "Check school facts", "status": "completed"},
                        {"content": "Answer the student", "status": "in_progress"},
                    ],
                    "completed": 1,
                    "total": 2,
                },
            },
        },
        {"type": "delta", "data": {"text": "Here is the final answer."}},
        {"type": "sources", "data": {"sources": []}},
        {
            "type": "usage",
            "data": {
                "input_tokens": 3,
                "output_tokens": 4,
                "est_cost_usd": None,
                "tool_calls": 1,
            },
        },
        {"type": "done", "data": {"status": "complete"}},
    ]


def _overflow_then_read_back(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest):
        returns = [part for part in last.parts if isinstance(part, ToolReturnPart)]
        if returns and returns[-1].tool_name == "read_tool_result":
            return ModelResponse(parts=[TextPart("I read the full spilled result.")])
        if returns and returns[-1].tool_name == "load_skill":
            content = returns[-1].content
            assert isinstance(content, dict)
            handle = content["result_for_agent"]["handle"]
            return ModelResponse(
                parts=[ToolCallPart(tool_name="read_tool_result", args={"handle": handle})]
            )
    return ModelResponse(parts=[ToolCallPart(tool_name="load_skill", args={"name": "huge"})])


def _overflow_without_read_back(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) and part.tool_name == "load_skill" for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I stored the large result.")])
    return ModelResponse(parts=[ToolCallPart(tool_name="load_skill", args={"name": "huge"})])


def _read_known_handle(handle: str) -> Callable[[list[ModelMessage], AgentInfo], ModelResponse]:
    def read_known_handle(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        if isinstance(last, ModelRequest) and any(
            isinstance(part, ToolReturnPart) and part.tool_name == "read_tool_result"
            for part in last.parts
        ):
            return ModelResponse(parts=[TextPart("I read the old spilled result.")])
        return ModelResponse(
            parts=[ToolCallPart(tool_name="read_tool_result", args={"handle": handle})]
        )

    return read_known_handle


def _read_missing_handle(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) and part.tool_name == "read_tool_result"
        for part in last.parts
    ):
        return ModelResponse(parts=[TextPart("I handled the missing result.")])
    return ModelResponse(
        parts=[ToolCallPart(tool_name="read_tool_result", args={"handle": "missing"})]
    )


async def test_oversized_tool_result_is_reduced_and_read_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    huge = "Admissions detail. " * 1_000
    monkeypatch.setattr(app.skills, "load_skill", lambda name: huge)
    settings = FakeSettings()
    settings.agent_tool_result_max_chars = 300
    rig = Rig(_fn_model(_overflow_then_read_back), settings=settings)
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Use a large skill", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert _text(events) == "I read the full spilled result."
    step_labels = [event.data["label"] for event in events if event.type == "step"]
    assert "Consulting the “huge” playbook" in step_labels
    assert "Reading an oversized tool result" not in step_labels
    usage = next(event.data for event in events if event.type == "usage")
    assert usage["tool_calls"] == 2
    values = await _state_values(rig, session_id)
    persisted_steps = values["turn_records"][0]["steps"]
    assert [step["label"] for step in persisted_steps] == ["Consulting the “huge” playbook"]
    tool_returns = [
        part
        for message in values["messages"]
        if message["kind"] == "request"
        for part in message.get("parts", [])
        if part.get("part_kind") == "tool-return"
    ]
    load_return = next(part for part in tool_returns if part["tool_name"] == "load_skill")
    read_return = next(part for part in tool_returns if part["tool_name"] == "read_tool_result")
    assert load_return["content"]["status"] == "overflow"
    assert huge not in str(load_return["content"])
    assert read_return["content"] == huge


async def test_oversized_tool_result_handle_survives_later_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    huge = "Admissions detail. " * 1_000
    monkeypatch.setattr(app.skills, "load_skill", lambda name: huge)
    settings = FakeSettings()
    settings.agent_tool_result_max_chars = 300
    rig = Rig(_fn_model(_overflow_without_read_back), settings=settings)
    session_id = str(uuid4())

    first_events = await rig.turn(session_id, "Load a large skill", _ALL_OFF)

    assert _done_status(first_events) == "complete"
    first_values = await _state_values(rig, session_id)
    tool_returns = [
        part
        for message in first_values["messages"]
        if message["kind"] == "request"
        for part in message.get("parts", [])
        if part.get("part_kind") == "tool-return"
    ]
    load_return = next(part for part in tool_returns if part["tool_name"] == "load_skill")
    handle = load_return["content"]["result_for_agent"]["handle"]
    assert handle in first_values["tool_result_store"]

    rig.deps.model_factory = lambda: _fn_model(_read_known_handle(handle))
    second_events = await rig.turn(session_id, "Read the prior spill", _ALL_OFF)

    assert _done_status(second_events) == "complete"
    assert _text(second_events) == "I read the old spilled result."
    second_values = await _state_values(rig, session_id)
    second_tool_returns = [
        part
        for message in second_values["messages"]
        if message["kind"] == "request"
        for part in message.get("parts", [])
        if part.get("part_kind") == "tool-return"
    ]
    read_return = next(
        part for part in reversed(second_tool_returns) if part["tool_name"] == "read_tool_result"
    )
    assert read_return["content"] == huge


async def test_missing_tool_result_handle_stays_out_of_public_steps() -> None:
    rig = Rig(_fn_model(_read_missing_handle))

    events = await rig.turn(str(uuid4()), "Read a missing spill", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert [event for event in events if event.type == "step"] == []
    assert _text(events) == "I handled the missing result."
    usage = next(event.data for event in events if event.type == "usage")
    assert usage["tool_calls"] == 1


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


async def test_registry_resets_for_each_completed_answer() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())
    config = SourceConfig(web=True, reddit=False, edu=False)

    events_1 = await rig.turn(session_id, "duke dorms?", config)
    events_2 = await rig.turn(session_id, "and harvard?", config)

    sources_1 = next(e.data["sources"] for e in events_1 if e.type == "sources")
    sources_2 = next(e.data["sources"] for e in events_2 if e.type == "sources")
    assert [entry["index"] for entry in sources_1] == [1]
    assert [entry["index"] for entry in sources_2] == [1]
    assert sources_2[0]["citation"]["url"] == "https://example.com/2"


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
    assert record["segments"] == [{"kind": "delta", "text": "Focusing on cost."}]


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


def _profile_only_when_external_sources_are_disabled(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    del messages
    instructions = info.instructions or ""
    tools = {tool.name for tool in info.function_tools}
    assert "Broad web (`search_web`): disabled and not mounted" in instructions
    assert "Official school sites (`search_school_site`): disabled and not mounted" in instructions
    assert "Reddit community search (`search_reddit`): disabled and not mounted" in instructions
    assert not ({"search_web", "search_school_site", "search_reddit"} & tools)
    return ModelResponse(
        parts=[
            TextPart(
                "Counselle's first-party data does not have this value. "
                "The available school profile can establish the school's identity, "
                "but I can't verify the requested current fact while external sources "
                "are disabled."
            )
        ]
    )


async def test_all_off_profile_only_fallback_preserves_gap_without_unknown_tool() -> None:
    rig = Rig(_fn_model(_profile_only_when_external_sources_are_disabled))

    events = await rig.turn(str(uuid4()), "What is this school's current deadline?", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert "error" not in _types(events)
    assert _steps(events) == []
    assert "Counselle's first-party data does not have this value." in _text(events)
    assert "available school profile" in _text(events)


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
    settings.agent_max_model_requests = 1
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
    assert record["sources"][0]["citation"] == values["source_registry"][0]["citation"]
    assert "evidence_seen_eids" not in record["sources"][0]
    assert record["sources"][0]["evidence_omitted_count"] == 0
    assert record["usage"]["tool_calls"] >= 1
    assert record["error"] is None and record["clarify"] is None
    assert [segment["kind"] for segment in record["segments"]] == ["step", "delta"]
    assert record["segments"][0]["data"]["status"] == "end"
    assert record["segments"][1]["text"] == _text(events)


async def test_explicit_skill_is_preloaded_once_persisted_and_not_leaked() -> None:
    """A selected workflow stays turn-scoped while clean user prose is unchanged."""
    seen_prompts: list[str] = []

    def answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_prompts.append(str(messages))
        return ModelResponse(parts=[TextPart("Comparison complete.")])

    rig = Rig(_fn_model(answer))
    session_id = str(uuid4())
    events = [
        event
        async for event in run_turn(
            session_id,
            "Compare Duke and Northwestern.",
            _ALL_OFF,
            deps=rig.deps,
            graph=rig.graph,
            selected_skills=["school-comparison"],
        )
    ]

    assert _done_status(events) == "complete"
    assert any("## Explicitly selected workflows" in prompt for prompt in seen_prompts)
    values = await _state_values(rig, session_id)
    assert values["turn_records"][-1]["skills"] == ["school-comparison"]
    assert values["turn_records"][-1]["user_text"] == "Compare Duke and Northwestern."

    await rig.turn(session_id, "Now focus on campus life.", _ALL_OFF)
    values = await _state_values(rig, session_id)
    assert values["turn_records"][-1]["skills"] == []


async def test_selected_response_mode_is_injected_once_with_precedence() -> None:
    """Runtime prompt assembly carries the trusted mode marker and body once."""
    seen_prompts: list[str] = []

    def answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_prompts.append(str(messages))
        return ModelResponse(parts=[TextPart("Focused complete.")])

    rig = Rig(_fn_model(answer))
    session_id = str(uuid4())
    events = [
        event
        async for event in run_turn(
            session_id,
            "Should I submit a 1490 to Duke?",
            _ALL_OFF,
            deps=rig.deps,
            graph=rig.graph,
            selected_skills=["focused-answer"],
        )
    ]

    assert _done_status(events) == "complete"
    prompt = "\n".join(seen_prompts)
    assert prompt.count("Selection group: response-mode") == 1
    assert prompt.count("### Selected skill: focused-answer") == 1
    assert prompt.count("Use the smallest evidence set that changes the decision.") == 1


async def test_malformed_restored_selection_fails_before_meta_or_record_write() -> None:
    rig = Rig(_fn_model(lambda _messages, _info: ModelResponse(parts=[TextPart("unused")])))
    session_id = str(uuid4())
    parked = build_turn_record(
        [],
        ids={"message_id": "parked", "user_message_id": "question"},
        status="awaiting_input",
        sources=[],
        user_text="Compare schools.",
        messages_offset=0,
        clarify={"spec": {"question": "Which matters?"}, "answer": None},
        selected_skills=["not-a-public-skill"],
    )
    messages = ModelMessagesTypeAdapter.dump_python(
        [ModelRequest(parts=[UserPromptPart(content="Compare schools.")])], mode="json"
    )
    await rig.graph.aupdate_state(
        {"configurable": {"thread_id": session_id}},
        {"messages": messages, "turn_records": [parked]},
    )

    events = [
        event
        async for event in run_turn(session_id, "Cost.", _ALL_OFF, deps=rig.deps, graph=rig.graph)
    ]

    assert _types(events) == ["error"]
    values = await _state_values(rig, session_id)
    assert values["turn_records"] == [parked]


async def test_direct_clarify_resume_rejects_matching_nonempty_selection() -> None:
    """Only the registry's server-owned inheritance flag may carry a skill."""
    rig = Rig(_fn_model(lambda _messages, _info: ModelResponse(parts=[TextPart("unused")])))
    session_id = str(uuid4())
    parked = build_turn_record(
        [],
        ids={"message_id": "parked", "user_message_id": "question"},
        status="awaiting_input",
        sources=[],
        user_text="Compare schools.",
        messages_offset=0,
        clarify={"spec": {"question": "Which matters?"}, "answer": None},
        selected_skills=["school-comparison"],
    )
    messages = ModelMessagesTypeAdapter.dump_python(
        [ModelRequest(parts=[UserPromptPart(content="Compare schools.")])], mode="json"
    )
    await rig.graph.aupdate_state(
        {"configurable": {"thread_id": session_id}},
        {"messages": messages, "turn_records": [parked]},
    )

    events = [
        event
        async for event in run_turn(
            session_id,
            "Cost.",
            _ALL_OFF,
            deps=rig.deps,
            graph=rig.graph,
            selected_skills=["school-comparison"],
        )
    ]

    assert _types(events) == ["error"]
    values = await _state_values(rig, session_id)
    assert values["turn_records"] == [parked]


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
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Card one",
                },
            ),
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Net price", "cells": [{"metric_ref": "cost.net_price"}]}],
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
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
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
    monkeypatch.setattr(
        app.viz, "render_viz", _fake_render_specs(_viz_spec("admissions.rate", title="Inline card"))
    )
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


def test_final_writer_streams_staged_viz_answer_deltas_incrementally() -> None:
    spec = {"type": "stat_block", "title": "Card"}
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([spec], emitted.append)

    writer.start_final()
    writer.write({"type": "delta", "text": "First final chunk. "})
    assert emitted == [{"type": "delta", "text": "First final chunk. "}]

    writer.write({"type": "delta", "text": "Second final chunk."})
    assert emitted == [
        {"type": "delta", "text": "First final chunk. "},
        {"type": "delta", "text": "Second final chunk."},
    ]

    writer.flush_final()
    assert emitted == [
        {"type": "delta", "text": "First final chunk. "},
        {"type": "delta", "text": "Second final chunk."},
        {"type": "viz", "spec": spec},
    ]


def test_final_writer_strips_evidence_token_and_promotes_row_while_marker_streams() -> None:
    """Provenance display only: the hidden [[evidence]] token is scrubbed from the
    visible stream and promotes its exact CDS row to the sources rail, while the
    visible [n] marker streams unchanged. The writer never inspects the prose."""
    citation = Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256="a" * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.2",
        school_unitid=130794,
    )
    evidence = EvidenceItem(
        eid="enrollment.undergraduate_total",
        value_display="6,814",
        label="Undergraduate enrollment",
        page=4,
        excerpt="Undergraduate enrollment 6,814.",
    )
    registry = SourceRegistry()
    marker = registry.register_source(citation, "Yale — Common Data Set 2024-25")
    registry.register_pending_evidence(marker, evidence)
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([], emitted.append, registry)

    writer.start_final()
    writer.write({"type": "delta", "text": "Enrollment was 6,814 [1][[evidence:1:"})
    writer.write({"type": "delta", "text": "enrollment.undergraduate_total]]. "})
    writer.flush_final()

    prose = "".join(chunk["text"] for chunk in emitted)
    assert prose == "Enrollment was 6,814 [1]. "
    assert "[[evidence:" not in prose
    assert registry.entries_for_wire()[0].evidence == (evidence,)


def _final_guard_citation(*, school_unitid: int = 130794, sha: str = "a") -> Citation:
    return Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256=sha * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.2",
        school_unitid=school_unitid,
    )


def _final_guard_evidence(eid: str, display: str) -> EvidenceItem:
    return EvidenceItem(
        eid=eid,
        value_display=display,
        label=eid,
        page=4,
        excerpt=f"{eid} {display}",
    )


def _write_guarded_final(registry: SourceRegistry, text: str) -> tuple[str, SourceRegistry]:
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([], emitted.append, registry)
    writer.start_final()
    writer.write({"type": "delta", "text": text})
    writer.flush_final()
    return "".join(chunk["text"] for chunk in emitted), registry


def test_final_writer_streams_derived_value_without_redaction() -> None:
    """Anti-regression: a derived number (a rate computed from two cited values)
    is no longer inspected or withheld. The agent's inline [n] citation is the
    only honesty gate — the runtime never second-guesses the arithmetic."""
    registry = SourceRegistry()
    marker = registry.register_source(_final_guard_citation(), "Yale CDS")
    registry.register_pending_evidence(
        marker, _final_guard_evidence("admissions.applicants", "47,893")
    )
    registry.register_pending_evidence(marker, _final_guard_evidence("admissions.admits", "2,003"))

    text = "Yale admitted 2,003 of 47,893 applicants, or 4.2% [1]."
    prose, _ = _write_guarded_final(registry, text)

    assert prose == text


def test_final_writer_streams_unregistered_marker_verbatim() -> None:
    """An unregistered/hallucinated marker is never validated or stripped — it
    reaches the student exactly as written. The registry maps what it knows and
    stays silent about the rest."""
    registry = SourceRegistry()
    prose, _ = _write_guarded_final(registry, "Tuition was $69,900 [9].")

    assert prose == "Tuition was $69,900 [9]."


def test_final_writer_promotes_evidence_only_via_token_not_a_bare_value() -> None:
    """Provenance is agent-declared, never inferred: a bare number in prose does
    NOT promote a pending row; only the explicit hidden [[evidence]] token does."""
    registry = SourceRegistry()
    marker = registry.register_source(_final_guard_citation(), "Yale CDS")
    registry.register_pending_evidence(
        marker, _final_guard_evidence("enrollment.undergraduate_total", "6,814")
    )

    prose, _ = _write_guarded_final(registry, "Enrollment was 6,814 [1].")

    assert prose == "Enrollment was 6,814 [1]."
    assert registry.entries_for_wire()[0].evidence == ()


def test_final_writer_allows_document_level_cds_marker_without_value_evidence() -> None:
    citation = Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256="a" * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.2",
        school_unitid=130794,
    )
    registry = SourceRegistry()
    registry.register_source(citation, "Yale — Common Data Set 2024-25")
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([], emitted.append, registry)

    writer.start_final()
    writer.write(
        {
            "type": "delta",
            "text": "Yale's CDS 2024-25 provides the document context [1].",
        }
    )
    writer.flush_final()

    assert emitted == [
        {
            "type": "delta",
            "text": "Yale's CDS 2024-25 provides the document context [1].",
        }
    ]


def test_final_writer_streams_text_before_split_viz_marker_immediately() -> None:
    spec = {"type": "stat_block", "title": "Card"}
    emitted: list[dict[str, Any]] = []
    writer = app.agent_node._FinalContentPlacementWriter([spec], emitted.append)

    writer.start_final()
    writer.write({"type": "delta", "text": "Intro before card. [["})
    assert emitted == [{"type": "delta", "text": "Intro before card. "}]

    writer.write({"type": "delta", "text": "viz:1]] Outro after card."})
    writer.flush_final()

    assert emitted == [
        {"type": "delta", "text": "Intro before card. "},
        {"type": "viz", "spec": spec},
        {"type": "delta", "text": " Outro after card."},
    ]


async def test_viz_without_marker_falls_back_after_final_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        _viz_spec("admissions.rate", title="Card one"),
        _viz_spec("cost.net_price", title="Card two"),
    ]

    monkeypatch.setattr(app.viz, "render_viz", _fake_render_specs(*specs))
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

    monkeypatch.setattr(app.viz, "render_viz", _fake_render_specs(*specs))
    rig = Rig(_fn_model(_two_viz_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "compare these", _ALL_OFF)

    assert _types(events).count("viz") == 1
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    viz_parts = [part for part in record["parts"] if part["type"] == "viz"]
    assert len(viz_parts) == 1
    assert viz_parts[0]["spec"]["title"] == "First title"
    viz_segments = [segment for segment in record["segments"] if segment["kind"] == "viz"]
    assert len(viz_segments) == 1
    assert viz_segments[0]["spec"]["title"] == "First title"
    assert len(values["viz_emitted"]) == 1


async def test_record_exact_final_content_stream_record_and_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        _viz_spec("admissions.rate", title="First title"),
        _viz_spec("admissions.rate", title="Second title"),
    ]

    monkeypatch.setattr(app.viz, "render_viz", _fake_render_specs(*specs))
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
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Early card",
                },
            )
        ]
    )


async def test_unmounted_ask_student_allows_staged_viz_to_flush_with_final_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        app.viz, "render_viz", _fake_render_specs(_viz_spec("admissions.rate", title="Early card"))
    )
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
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Card",
                },
            ),
        ]
    )


async def test_no_early_answer_persists_only_final_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        app.viz, "render_viz", _fake_render_specs(_viz_spec("admissions.rate", title="Card"))
    )
    rig = Rig(_fn_model(_narrate_render_then_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "show me a comparison", _ALL_OFF)

    assert "I will check the cited data before answering." in _narration(events)
    assert _text(events) == "Final answer only."
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert prose_of(record["parts"]) == "Final answer only."


async def test_budget_turn_record_and_prose_invariant() -> None:
    def endless_searcher(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(tool_name="search_web", args={"query": "x"})])

    settings = FakeSettings()
    settings.agent_max_model_requests = 1
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
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Hidden until final",
                },
            )
        ]
    )


async def test_budget_before_final_staged_viz_does_not_leak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        app.viz,
        "render_viz",
        _fake_render_specs(_viz_spec("admissions.rate", title="Hidden until final")),
    )
    settings = FakeSettings()
    settings.agent_max_model_requests = 1
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
                "type": "stat_block",
                "columns": [{"unitid": 1}],
                "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
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


class _BudgetToolStream:
    def __init__(self, tools: dict[str, Any]) -> None:
        self._tools = tools

    async def __aenter__(self) -> _BudgetToolStream:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def __aiter__(self) -> AsyncIterator[FunctionToolCallEvent | FunctionToolResultEvent]:
        call = ToolCallPart(
            tool_name="render_viz",
            args={
                "type": "comparison_table",
                "columns": [{"unitid": 1}],
                "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
            },
            tool_call_id="viz-after-final",
        )
        yield FunctionToolCallEvent(part=call)
        result = await self._tools["render_viz"].function(
            "comparison", [1], ["admissions.rate"], None
        )
        yield FunctionToolResultEvent(
            part=ToolReturnPart(
                tool_name="render_viz",
                content=result,
                tool_call_id="viz-after-final",
            )
        )


class _BudgetCallToolsNode:
    def __init__(self, tools: dict[str, Any]) -> None:
        self._tools = tools

    def stream(self, ctx: Any) -> _BudgetToolStream:
        return _BudgetToolStream(self._tools)


class _BudgetModelNode:
    async def __aenter__(self) -> _BudgetModelNode:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def __aiter__(self) -> AsyncIterator[Any]:
        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartStartEvent(index=0, part=TextPart(content="Partial final answer."))
        raise UsageLimitExceeded("forced budget after final start")

    def stream(self, ctx: Any) -> _BudgetModelNode:
        return self


class _BudgetIterRun:
    def __init__(self, tools: dict[str, Any]) -> None:
        self.ctx = object()
        self.next_node: Any = _BudgetCallToolsNode(tools)
        self.result = None

    async def __aenter__(self) -> _BudgetIterRun:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def next(self, node: Any) -> Any:
        if isinstance(node, _BudgetCallToolsNode):
            return _BudgetModelNode()
        raise AssertionError("budget test should raise before advancing final model node")

    def all_messages(self) -> list[Any]:
        return []


class _BudgetIterContext:
    def __init__(self, tools: dict[str, Any]) -> None:
        self._tools = tools

    async def __aenter__(self) -> _BudgetIterRun:
        return _BudgetIterRun(self._tools)

    async def __aexit__(self, *exc: Any) -> bool:
        return False


class _BudgetAfterFinalAgent:
    def __init__(self, *args: Any, tools: list[Any], **kwargs: Any) -> None:
        self._tools = {tool.name: tool for tool in tools}

    async def __aenter__(self) -> _BudgetAfterFinalAgent:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def run_stream_events(self, *args: Any, **kwargs: Any) -> _BudgetAfterFinalStream:
        return _BudgetAfterFinalStream(self._tools)

    def iter(self, *args: Any, **kwargs: Any) -> _BudgetIterContext:
        return _BudgetIterContext(self._tools)

    @staticmethod
    def is_model_request_node(node: Any) -> bool:
        return isinstance(node, _BudgetModelNode)

    @staticmethod
    def is_call_tools_node(node: Any) -> bool:
        return isinstance(node, _BudgetCallToolsNode)


async def test_budget_after_final_partial_preserves_visible_viz_and_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        app.viz,
        "render_viz",
        _fake_render_specs(_viz_spec("admissions.rate", title="Visible card")),
    )
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
    assert [segment["kind"] for segment in record["segments"]] == [
        "step",
        "delta",
        "viz",
        "delta",
    ]
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
    settings.agent_max_model_requests = 1
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
    assert long_prose.strip() in _narration(events)
    assert streamed == ""

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert record["error"]["trace_id"] == trace_id
    assert record["error"]["message"]
    assert record["message_id"] == events[0].data["message_id"]
    prose = _turn_prose_from_messages(values["messages"], record["messages_offset"])
    assert prose == streamed
    assert long_prose.strip() in "".join(record["narration"])
    assert record["segments"] == [{"kind": "narration", "text": long_prose.strip()}]
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


async def test_write_failure_record_uses_partial_history_snapshot() -> None:
    from app.run_turn import _write_failure_record

    original = _serialized_user_message_for_test("tell me about duke")
    snapshot_messages = original + [
        ModelMessagesTypeAdapter.dump_python(
            [ModelResponse(parts=[TextPart(content="snapshot answer")])],
            mode="json",
        )[0]
    ]
    graph = _CapturingGraph({"messages": original, "turn_records": []})

    await _write_failure_record(
        graph,
        {"configurable": {"thread_id": "s-error-snapshot"}},
        emissions=[("delta", "live prose")],
        ids={"message_id": "m-1", "user_message_id": "u-1"},
        user_text="tell me about duke",
        trace_id="t-1",
        messages_offset=0,
        fallback_messages=original,
        registry_dump=[],
        partial_history=snapshot_messages,
        emissions_len_at_snapshot=0,
    )

    payload = graph.updates[0]
    assert payload["messages"] == snapshot_messages
    assert payload["turn_records"][-1]["status"] == "error"
    assert payload["turn_records"][-1]["partial_history"] == "snapshot"


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

    # Snapshot-backed interrupted history gets an explicit continuation marker
    # in the next user prompt; ordinary prior history does not.
    prior = _serialized_user_message_for_test("first question") + [
        ModelMessagesTypeAdapter.dump_python(
            [ModelResponse(parts=[TextPart(content="completed partial work")])],
            mode="json",
        )[0]
    ]

    class _SnapCancelled:
        values = {
            "messages": prior,
            "turn_records": [
                {
                    "message_id": "m-old",
                    "user_message_id": "u-old",
                    "status": "cancelled",
                    "messages_offset": 0,
                    "partial_history": "snapshot",
                }
            ],
        }

    continued = await _prepare_turn_input(
        rig.graph,
        rig.deps,
        rig.settings,
        session_id="prep-continue",
        user_text="now compare cost",
        source_config=_ALL_OFF,
        snapshot=_SnapCancelled(),
        parked=None,
        turn_ids={"message_id": "m-cont", "user_message_id": "u-cont"},
    )
    prompt = continued.graph_input["messages"][-1]["parts"][0]["content"]
    assert prompt.startswith(
        "[Request interrupted by user - the previous run was stopped; "
        "its completed steps above are real.]"
    )
    assert prompt.endswith("now compare cost")

    # Reference the imported sentinel so the import is not flagged as unused; it
    # is the BC-11 raise path exercised by test_turn_persistence's integration test.
    assert issubclass(_ResumePrewriteError, Exception)


@pytest.mark.parametrize(
    "record",
    [
        {
            "message_id": "m-complete",
            "user_message_id": "u-complete",
            "status": "complete",
            "messages_offset": 0,
            "partial_history": "snapshot",
        },
        {
            "message_id": "m-cancelled",
            "user_message_id": "u-cancelled",
            "status": "cancelled",
            "messages_offset": 0,
        },
    ],
)
async def test_prepare_turn_input_does_not_mark_normal_or_non_snapshot_history(
    record: dict[str, Any],
) -> None:
    from app.run_turn import _prepare_turn_input

    rig = Rig(_fn_model(_ask_student_probe))
    prior = _serialized_user_message_for_test("first question") + [
        ModelMessagesTypeAdapter.dump_python(
            [ModelResponse(parts=[TextPart(content="prior assistant content")])],
            mode="json",
        )[0]
    ]

    class _Snap:
        values = {"messages": prior, "turn_records": [record]}

    prepared = await _prepare_turn_input(
        rig.graph,
        rig.deps,
        rig.settings,
        session_id="prep-no-marker",
        user_text="now compare cost",
        source_config=_ALL_OFF,
        snapshot=_Snap(),
        parked=None,
        turn_ids={"message_id": "m-new", "user_message_id": "u-new"},
    )

    prompt = prepared.graph_input["messages"][-1]["parts"][0]["content"]
    assert prompt == "now compare cost"
    assert "Request interrupted by user" not in prompt
    assert "Previous run ended early" not in prompt


async def test_prepare_turn_input_does_not_mark_snapshot_without_assistant_content() -> None:
    from app.run_turn import _prepare_turn_input

    rig = Rig(_fn_model(_ask_student_probe))
    prior = _serialized_user_message_for_test("first question")

    class _Snap:
        values = {
            "messages": prior,
            "turn_records": [
                {
                    "message_id": "m-snapshot-empty",
                    "user_message_id": "u-snapshot-empty",
                    "status": "error",
                    "messages_offset": 0,
                    "partial_history": "snapshot",
                }
            ],
        }

    prepared = await _prepare_turn_input(
        rig.graph,
        rig.deps,
        rig.settings,
        session_id="prep-no-marker-empty-snapshot",
        user_text="now compare cost",
        source_config=_ALL_OFF,
        snapshot=_Snap(),
        parked=None,
        turn_ids={"message_id": "m-new", "user_message_id": "u-new"},
    )

    prompt = prepared.graph_input["messages"][-1]["parts"][0]["content"]
    assert prompt == "now compare cost"
    assert "Previous run ended early" not in prompt


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
