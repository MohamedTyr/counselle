"""Phase 4 regressions: records/transcript/history-rewrite for the v2
clarify -> continuation lifecycle (plans/clarifying-questions.md, "Phase 4 —
records, transcript, title, history rewrite").

Drives the real graph (Rig, reused from tests/app/test_run_turn.py) through a
full A1 -> accept -> A2 cycle for both a widget-origin and a composer-origin
answer, then asserts on the persisted ``turn_records`` and
``extract_transcript`` output — the reload surface. This is the "reload
equivalence" the plan calls for: the same ordered ``emissions`` list drives
both what the live stream would have shown and what ``build_segments``
persists, so pinning the persisted segment order pins both.
"""

from __future__ import annotations

from typing import Any, cast
from uuid import uuid4

import pytest
from langchain_core.runnables import RunnableConfig
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo

import app.agent_node
import app.graph
from app.clarify_lifecycle import accept_clarification
from app.run_turn import run_continuation_turn
from app.sources import SourceRegistry
from app.state import TemporalContext
from app.transcript import extract_transcript
from app.turns import InvalidEditTarget, TurnRegistry, _resolve_edit_target
from domain.envelope import Citation
from tests.app.test_run_turn import _ALL_OFF, _TEMPORAL, Rig, _fn_model, _state_values


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading in the prompt builder (mirrors the
    same fixture in tests/app/test_run_turn.py / tests/app/test_turns.py)."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    async def fake_student_context(app_pool: Any, *, user_id: Any) -> str:
        return "## About This Student\nTest student context."

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.graph, "build_student_context", fake_student_context)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")

_DRAFT_ARGS: dict[str, Any] = {
    "questions": [
        {
            "question": "Which term are you targeting?",
            "selection": "single",
            "options": [
                {"label": "Fall", "hint": "start in the fall"},
                {"label": "Spring", "hint": "start in the spring"},
            ],
        }
    ]
}


def _source_registry_dump() -> list[dict[str, Any]]:
    registry = SourceRegistry()
    registry.register_source(
        Citation(
            source="web",
            tier="official",
            vintage="2026",
            url="https://example.edu/admissions",
        ),
        "Example admissions",
        "Admissions source.",
    )
    return registry.dump_state()


def _ask_then_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """Ask a clarifying question once; once history shows ``ask_student``
    already ran (A2's completed-history continuation), answer normally."""
    for message in messages:
        if isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, ToolCallPart) and part.tool_name == "ask_student":
                    return ModelResponse(parts=[TextPart("Great, Fall it is — here's my answer.")])
    return ModelResponse(parts=[ToolCallPart(tool_name="ask_student", args=_DRAFT_ARGS)])


async def _run_a1(rig: Rig, session_id: str) -> dict[str, Any]:
    events = await rig.turn(session_id, "Should I apply to NYU?", _ALL_OFF)
    assert events[-1].data["status"] == "awaiting_input"
    values = await _state_values(rig, session_id)
    a1 = values["turn_records"][-1]
    assert a1["status"] == "awaiting_input"
    assert a1["clarify"]["spec"]["v"] == 2
    return cast(dict[str, Any], a1)


async def _run_a2(rig: Rig, session_id: str, prepared: Any) -> list[Any]:
    return [
        event
        async for event in run_continuation_turn(
            session_id,
            prepared,
            _ALL_OFF,
            deps=rig.deps,
            graph=rig.graph,
        )
    ]


# ---------------------------------------------------------------------------
# Widget-origin: A1 -> A2, no user bubble in between
# ---------------------------------------------------------------------------


async def test_widget_origin_transcript_order_is_u1_a1_a2_no_extra_bubble() -> None:
    rig = Rig(_fn_model(_ask_then_answer))
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    prepared = await accept_clarification(
        rig.graph,
        session_id,
        in_reply_to=a1["message_id"],
        widget_response_payload={
            "mode": "widget",
            "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
        },
    )
    assert prepared.origin == "widget"
    a2_events = await _run_a2(rig, session_id, prepared)
    assert a2_events[-1].data["status"] == "complete"
    assert [event.type for event in a2_events[:2]] == ["meta", "clarify_response"]
    assert a2_events[0].data["continuation_of"] == a1["message_id"]
    assert a2_events[0].data["response_origin"] == "widget"
    assert a2_events[0].data["project_user"] is False
    assert a2_events[1].data["clarify_message_id"] == a1["message_id"]
    assert a2_events[1].data["continuation_message_id"] == prepared.continuation_message_id
    assert a2_events[1].data["response"]["mode"] == "widget"

    values = await _state_values(rig, session_id)
    transcript = extract_transcript(values["messages"], values["turn_records"])

    assert [e["role"] for e in transcript] == ["user", "assistant", "assistant"]
    u1, a1_entry, a2_entry = transcript
    assert u1["text"] == "Should I apply to NYU?"
    assert a1_entry["clarify"]["response"]["mode"] == "widget"
    assert a1_entry["segments"][-1] == {"kind": "clarify"}
    assert a2_entry["continuation_of"] == a1["message_id"]
    assert a2_entry["response_origin"] == "widget"
    assert a2_entry["project_user"] is False
    assert a2_entry["trigger_request_id"] == prepared.trigger_request_id
    assert a2_entry["text"] == "Great, Fall it is — here's my answer."
    # A1 remains answered regardless of A2 — independent records.
    assert a1_entry["status"] == "complete"


# ---------------------------------------------------------------------------
# Composer-origin: A1 -> U2 -> A2, exactly one extra user bubble
# ---------------------------------------------------------------------------


async def test_composer_origin_transcript_order_is_u1_a1_u2_a2() -> None:
    rig = Rig(_fn_model(_ask_then_answer))
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    prepared = await accept_clarification(
        rig.graph,
        session_id,
        in_reply_to=a1["message_id"],
        composer_text="Let's go with Fall.",
    )
    assert prepared.origin == "reply"
    a2_events = await _run_a2(rig, session_id, prepared)
    assert a2_events[-1].data["status"] == "complete"

    values = await _state_values(rig, session_id)
    transcript = extract_transcript(values["messages"], values["turn_records"])

    assert [e["role"] for e in transcript] == ["user", "assistant", "user", "assistant"]
    u1, a1_entry, u2, a2_entry = transcript
    assert u1["text"] == "Should I apply to NYU?"
    assert a1_entry["clarify"]["response"]["mode"] == "reply"
    assert u2["text"] == "Let's go with Fall."
    assert u2["message_id"] == prepared.user_message_id
    assert u2["clarification_reply"] is True
    assert u2["in_reply_to"] == a1["message_id"]
    assert a2_entry["continuation_of"] == a1["message_id"]
    assert a2_entry["response_origin"] == "reply"
    assert a2_entry["project_user"] is True
    assert a2_entry["trigger_request_id"] == prepared.trigger_request_id
    assert a2_entry["text"] == "Great, Fall it is — here's my answer."


# ---------------------------------------------------------------------------
# editable_root_message_id: named identically by A1 and A2
# ---------------------------------------------------------------------------


async def test_editable_root_message_id_matches_on_a1_and_a2() -> None:
    rig = Rig(_fn_model(_ask_then_answer))
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    prepared = await accept_clarification(
        rig.graph,
        session_id,
        in_reply_to=a1["message_id"],
        composer_text="Let's go with Fall.",
    )
    await _run_a2(rig, session_id, prepared)

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    a1_record, a2_record = records[-2], records[-1]
    assert a1_record["editable_root_message_id"] == a1_record["user_message_id"]
    assert a2_record["editable_root_message_id"] == a1_record["user_message_id"]
    assert a2_record["trigger_request_id"] == prepared.trigger_request_id
    assert a2_record["response_origin"] == "reply"
    assert a2_record["project_user"] is True
    assert a2_record["clarification_reply"] is True


async def test_a2_sources_start_from_a1s_stored_registry_snapshot() -> None:
    rig = Rig(_fn_model(_ask_then_answer))
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    source_registry = _source_registry_dump()
    config: RunnableConfig = {"configurable": {"thread_id": session_id}}
    snapshot = await rig.graph.aget_state(config)
    await rig.graph.aupdate_state(config, {"source_registry": source_registry})

    prepared = await accept_clarification(
        rig.graph,
        session_id,
        in_reply_to=a1["message_id"],
        widget_response_payload={
            "mode": "widget",
            "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
        },
    )
    await _run_a2(rig, session_id, prepared)

    values = await _state_values(rig, session_id)
    a2_record = values["turn_records"][-1]
    assert a2_record["sources"][0]["index"] == 1
    assert a2_record["sources"][0]["label"] == "Example admissions"
    # The update above was additive state setup only; A1 itself remains the
    # same answered record accept_clarification wrote, and A2 independently
    # snapshots the applicable registry it inherited for rendering.
    assert snapshot.values["turn_records"][-1]["message_id"] == a1["message_id"]


async def test_cancel_pending_v2_a1_freezes_unanswered_without_a2() -> None:
    rig = Rig(_fn_model(_ask_then_answer))
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    assert await registry.cancel(session_id) == "unparked"

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    assert len(records) == 1
    assert records[0]["message_id"] == a1["message_id"]
    assert records[0]["status"] == "cancelled"
    assert records[0]["clarify"]["response"] is None

    transcript = extract_transcript(values["messages"], records)
    assert [entry["role"] for entry in transcript] == ["user", "assistant"]
    assert transcript[-1]["status"] == "cancelled"
    assert transcript[-1]["clarify"]["response"] is None
    assert transcript[-1]["segments"][-1] == {"kind": "clarify"}


# ---------------------------------------------------------------------------
# A2 error preserves an already-answered A1 (record-level, transcript-level)
# ---------------------------------------------------------------------------


def _boom_after_ask_student(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    for message in messages:
        if isinstance(message, ModelResponse):
            for part in message.parts:
                if isinstance(part, ToolCallPart) and part.tool_name == "ask_student":
                    raise RuntimeError("boom mid-continuation")
    return ModelResponse(parts=[ToolCallPart(tool_name="ask_student", args=_DRAFT_ARGS)])


async def test_a2_failure_preserves_answered_a1_in_transcript() -> None:
    rig = Rig(_fn_model(_boom_after_ask_student))
    session_id = str(uuid4())
    a1 = await _run_a1(rig, session_id)

    prepared = await accept_clarification(
        rig.graph,
        session_id,
        in_reply_to=a1["message_id"],
        widget_response_payload={
            "mode": "widget",
            "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
        },
    )
    a2_events = await _run_a2(rig, session_id, prepared)
    assert a2_events[-1].type == "error"

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    a1_record = next(r for r in records if r["message_id"] == a1["message_id"])
    assert a1_record["status"] == "complete"
    assert a1_record["clarify"]["response"]["mode"] == "widget"

    transcript = extract_transcript(values["messages"], values["turn_records"])
    roles_and_status = [(e["role"], e.get("status")) for e in transcript]
    # U1, A1(complete, answered), A2(error) — widget origin adds no user bubble.
    assert roles_and_status == [("user", None), ("assistant", "complete"), ("assistant", "error")]


# ---------------------------------------------------------------------------
# History rewrite: editing U1 truncates both A1 and its linked A2
# ---------------------------------------------------------------------------


def test_resolve_edit_target_on_u1_truncates_through_a1_and_a2() -> None:
    records = [
        {
            "user_message_id": "u1",
            "message_id": "a1-msg",
            "messages_offset": 0,
            "continuation_of": None,
        },
        {
            "user_message_id": "u-trigger",
            "message_id": "a2-msg",
            "messages_offset": 3,
            "continuation_of": "a1-msg",
        },
    ]
    messages: list[dict[str, Any]] = [{}, {}, {}, {}]
    index, offset = _resolve_edit_target(records, messages, "u1", "sess-1")
    assert index == 0
    assert offset == 0
    # Slicing at `index` drops A1 AND its linked A2 in one cut.
    assert records[:index] == []


def test_resolve_edit_target_rejects_a2_continuation_record() -> None:
    records = [
        {
            "user_message_id": "u1",
            "message_id": "a1-msg",
            "messages_offset": 0,
            "continuation_of": None,
        },
        {
            "user_message_id": "u2",
            "message_id": "a2-msg",
            "messages_offset": 3,
            "continuation_of": "a1-msg",
        },
    ]
    messages: list[dict[str, Any]] = [{}, {}, {}, {}]
    with pytest.raises(InvalidEditTarget):
        _resolve_edit_target(records, messages, "u2", "sess-1")


def test_resolve_edit_target_rejects_widget_origin_a2_internal_id() -> None:
    """A widget-origin A2's own ``user_message_id`` is an internal trigger id,
    never surfaced as a real message — still must never become an edit target."""
    records = [
        {
            "user_message_id": "u1",
            "message_id": "a1-msg",
            "messages_offset": 0,
            "continuation_of": None,
        },
        {
            "user_message_id": "trigger-uuid",
            "message_id": "a2-msg",
            "messages_offset": 3,
            "continuation_of": "a1-msg",
        },
    ]
    messages: list[dict[str, Any]] = [{}, {}, {}, {}]
    with pytest.raises(InvalidEditTarget):
        _resolve_edit_target(records, messages, "trigger-uuid", "sess-1")
