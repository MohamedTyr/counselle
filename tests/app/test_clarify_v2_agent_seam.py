"""Phase 2 lifecycle tests for the v2 ``ask_student`` output-tool seam.

See plans/clarifying-questions.md, "Backend implementation slices" — Phase 2
("agent output and atomic A1 persistence"). Phase 0
(tests/app/test_ask_student_output_tool_seam.py) already proved the raw
PydanticAI mechanics against the pinned runtime with a throwaway draft model;
this file proves the real wiring through the full graph: ``app/agent_node.py``
(the output-tool registration + result branch) and ``app/run_turn.py`` (the
post-commit event order). Rig and helpers are reused verbatim from
tests/app/test_run_turn.py — the established graph-integration test pattern in
this codebase (also reused by tests/app/test_turns.py,
tests/app/test_turn_persistence.py, tests/app/test_protocol_fixtures.py).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo

import app.agent_node
import app.graph
import app.viz
from app.records import prose_of
from app.state import TemporalContext
from tests.app.test_run_turn import (
    _ALL_OFF,
    _TEMPORAL,
    Rig,
    _done_status,
    _fake_render_specs,
    _fn_model,
    _state_values,
    _text,
    _types,
    _viz_spec,
)


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
            "question": "What matters most to you in a school?",
            "selection": "single",
            "options": [
                {"label": "Cost", "hint": "affordability and aid"},
                {"label": "Academics", "hint": "programs and rigor"},
            ],
        }
    ]
}


def _ask_student_only(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="ask_student", args=_DRAFT_ARGS)])


async def test_ask_student_output_produces_normalized_v2_spec_awaiting_input() -> None:
    rig = Rig(_fn_model(_ask_student_only))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Should I apply to NYU?", _ALL_OFF)

    # No final-answer delta: the question IS the output, never synthesized prose.
    assert "delta" not in _types(events)
    assert _text(events) == ""
    assert _done_status(events) == "awaiting_input"

    clarify_events = [e for e in events if e.type == "clarify"]
    assert len(clarify_events) == 1
    assert clarify_events[0].data["v"] == 2
    assert clarify_events[0].data["questions"][0]["question"] == (
        "What matters most to you in a school?"
    )

    # Post-commit order (plan Phase 2): clarify -> sources -> done(awaiting_input).
    types = _types(events)
    assert types.index("clarify") < types.index("sources") < types.index("done")

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "awaiting_input"
    assert prose_of(record["parts"]) == ""
    clarify = record["clarify"]
    assert clarify["response"] is None
    spec = clarify["spec"]
    assert spec["v"] == 2
    assert len(spec["questions"]) == 1
    question = spec["questions"][0]
    # Code-owned positional IDs (domain/clarification.normalize_clarify_draft),
    # never model-authored.
    assert question["id"] == "q1"
    assert question["selection"] == "single"
    assert [o["id"] for o in question["options"]] == ["q1_o1", "q1_o2"]
    assert [o["label"] for o in question["options"]] == ["Cost", "Academics"]


async def test_ask_student_never_appears_as_a_step_or_tool_label() -> None:
    rig = Rig(_fn_model(_ask_student_only))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Should I apply to NYU?", _ALL_OFF)

    step_tools = {
        event.data.get("tool")
        for event in events
        if event.type == "step" and isinstance(event.data, dict)
    }
    assert "ask_student" not in step_tools
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert all(step.get("tool") != "ask_student" for step in record["steps"])


def _ask_student_with_sibling_render_viz(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    return ModelResponse(
        parts=[
            ToolCallPart(tool_name="ask_student", args=_DRAFT_ARGS),
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Should not render",
                },
            ),
        ]
    )


async def test_sibling_workspace_tool_call_is_skipped_under_early_end_strategy(
    monkeypatch: Any,
) -> None:
    calls = {"n": 0}

    async def _counting_render_viz(*args: Any, **kwargs: Any) -> dict[str, Any]:
        calls["n"] += 1
        return {"ok": True}

    monkeypatch.setattr(app.viz, "render_viz", _counting_render_viz)
    rig = Rig(_fn_model(_ask_student_with_sibling_render_viz))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Should I apply to NYU and show a chart?", _ALL_OFF)

    # end_strategy="early": the sibling render_viz call in the same model
    # response is returned as skipped, never executed (Phase 0's proven seam).
    assert calls["n"] == 0
    assert "viz" not in _types(events)
    assert _done_status(events) == "awaiting_input"


def _viz_then_ask_student(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if isinstance(last, ModelRequest) and any(
        isinstance(part, ToolReturnPart) for part in last.parts
    ):
        return ModelResponse(parts=[ToolCallPart(tool_name="ask_student", args=_DRAFT_ARGS)])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "stat_block",
                    "columns": [{"unitid": 1}],
                    "rows": [{"label": "Rate", "cells": [{"metric_ref": "admissions.rate"}]}],
                    "title": "Staged before the question",
                },
            )
        ]
    )


async def test_staged_viz_before_clarify_output_flushes_and_survives_reload(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        app.viz, "render_viz", _fake_render_specs(_viz_spec("admissions.rate", title="Staged card"))
    )
    rig = Rig(_fn_model(_viz_then_ask_student))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Compare a stat then help me decide", _ALL_OFF)

    types = _types(events)
    assert types.count("viz") == 1
    assert types.index("viz") < types.index("clarify")
    assert _done_status(events) == "awaiting_input"

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "awaiting_input"
    viz_parts = [part for part in record["parts"] if part["type"] == "viz"]
    assert len(viz_parts) == 1
    assert viz_parts[0]["spec"]["title"] == "Staged card"
    viz_segments = [segment for segment in record["segments"] if segment["kind"] == "viz"]
    assert len(viz_segments) == 1
    assert record["clarify"]["spec"]["v"] == 2
    assert len(values["viz_emitted"]) == 1


def _text_then_ask_student_probe(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """A control case: a plain-text-only run never advertises ask_student output
    incorrectly nor breaks normal completion (regression guard alongside the
    v2 assertions above)."""
    return ModelResponse(parts=[TextPart("A normal answer, no clarification needed.")])


async def test_normal_completion_is_unaffected_by_the_new_output_type() -> None:
    rig = Rig(_fn_model(_text_then_ask_student_probe))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "Is NYU good?", _ALL_OFF)

    assert _done_status(events) == "complete"
    assert _text(events) == "A normal answer, no clarification needed."
    assert "clarify" not in _types(events)
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "complete"
    assert record["clarify"] is None
