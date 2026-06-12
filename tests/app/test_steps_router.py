"""Unit tests for the EmissionRouter (app/steps.py) — B1a. No DB, no LLM.

Drives the router with hand-constructed pydantic-ai stream events and asserts
the writer-chunk protocol: thinking routing (the 240-char threshold +
``next_part_kind`` flush signal), step pairing on ``tool_call_id`` (parallel
calls), the ask_student exclusion, result-shape error detection, and terminal
closure (``close``) semantics.
"""

from __future__ import annotations

from typing import Any, Literal

import pytest
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolReturnPart,
)

from app.steps import THINKING_THRESHOLD_CHARS, EmissionRouter, StepMapper
from config.settings import load_yaml_asset

_SCHOOL_NAMES = {198419: "Duke University"}


# ---------------------------------------------------------------------------
# Rig + event builders
# ---------------------------------------------------------------------------


class Rig:
    """One router + a chunk sink."""

    def __init__(self) -> None:
        self.chunks: list[dict[str, Any]] = []
        self.router = EmissionRouter(
            writer=self.chunks.append,
            mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        )

    def feed(self, *events: Any) -> None:
        for event in events:
            self.router.handle(event)

    def steps(self) -> list[dict[str, Any]]:
        return [chunk["data"] for chunk in self.chunks if chunk["type"] == "step"]

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [chunk for chunk in self.chunks if chunk["type"] == kind]


@pytest.fixture
def rig() -> Rig:
    return Rig()


def _text_start(content: str) -> PartStartEvent:
    return PartStartEvent(index=0, part=TextPart(content=content))


def _text_delta(content: str) -> PartDeltaEvent:
    return PartDeltaEvent(index=0, delta=TextPartDelta(content_delta=content))


def _text_end(next_part_kind: Literal['tool-call'] | None) -> PartEndEvent:
    return PartEndEvent(index=0, part=TextPart(content=""), next_part_kind=next_part_kind)


def _call(tool: str, args: dict[str, Any], call_id: str) -> FunctionToolCallEvent:
    return FunctionToolCallEvent(part=ToolCallPart(tool_name=tool, args=args, tool_call_id=call_id))


def _result(tool: str, content: Any, call_id: str) -> FunctionToolResultEvent:
    return FunctionToolResultEvent(
        ToolReturnPart(tool_name=tool, content=content, tool_call_id=call_id)
    )


def _retry_result(
    tool: str, call_id: str, content: Any = "bad arguments"
) -> FunctionToolResultEvent:
    return FunctionToolResultEvent(
        RetryPromptPart(content=content, tool_name=tool, tool_call_id=call_id)
    )


# ---------------------------------------------------------------------------
# The simple flow: narration → step pair → live answer
# ---------------------------------------------------------------------------


def test_simple_flow_narration_step_pair_then_live_answer(rig: Rig) -> None:
    long_tail = "y" * (THINKING_THRESHOLD_CHARS + 10)

    rig.feed(
        _text_start("Let me pull Duke's numbers."),
        _text_end("tool-call"),
        _call("get_values", {"unitid": 198419, "field_keys": ["admissions.sat_25"]}, "c1"),
        _result("get_values", [{"field": "admissions.sat_25"}], "c1"),
        _text_start(long_tail),
        _text_delta(" And more."),
        _text_end(None),
    )

    # The under-threshold pre-tool text became one thinking chunk, never a delta.
    thinking = rig.of_type("thinking")
    assert [chunk["text"] for chunk in thinking] == ["Let me pull Duke's numbers."]
    # One start/end pair, same step_id, the Duke label on both.
    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "end"]
    assert steps[0]["step_id"] == steps[1]["step_id"]
    assert "Duke University" in steps[0]["label"]
    assert steps[1]["detail"]["duration_ms"] >= 0
    # Threshold crossing flushed as delta, then live streaming.
    deltas = [chunk["text"] for chunk in rig.of_type("delta")]
    assert deltas == [long_tail, " And more."]


def test_threshold_one_below_held_one_more_char_flushes_live(rig: Rig) -> None:
    rig.feed(_text_start("x" * (THINKING_THRESHOLD_CHARS - 1)))

    assert rig.of_type("delta") == []  # 239 chars: held

    rig.feed(_text_delta("x"))

    assert [chunk["text"] for chunk in rig.of_type("delta")] == ["x" * THINKING_THRESHOLD_CHARS]
    rig.feed(_text_delta("live now"))
    assert rig.of_type("delta")[-1]["text"] == "live now"  # streamed immediately


def test_response_end_flushes_held_text_as_delta_not_thinking(rig: Rig) -> None:
    rig.feed(_text_start("Short final answer."), _text_end(None))

    assert [chunk["text"] for chunk in rig.of_type("delta")] == ["Short final answer."]
    assert rig.of_type("thinking") == []


def test_live_streaming_resets_per_model_response(rig: Rig) -> None:
    """The threshold buffer applies per model response: a second response's
    under-threshold text is held again, not streamed live because the prior
    response crossed the threshold."""
    rig.feed(_text_start("x" * (THINKING_THRESHOLD_CHARS + 5)), _text_end(None))
    deltas_after_first = len(rig.of_type("delta"))

    rig.feed(_text_start("Short second response."))

    assert len(rig.of_type("delta")) == deltas_after_first  # held, not live

    rig.feed(_text_end(None))

    assert rig.of_type("delta")[-1]["text"] == "Short second response."


# ---------------------------------------------------------------------------
# Step pairing: parallel calls, results out of order
# ---------------------------------------------------------------------------


def test_parallel_calls_pair_results_by_tool_call_id(rig: Rig) -> None:
    rig.feed(
        _call("get_values", {"unitid": 198419, "field_keys": ["admissions.sat_25"]}, "A"),
        _call("search_web", {"query": "duke dorms"}, "B"),
        _result("search_web", {"results": [{"url": "https://reddit.com/x"}]}, "B"),
        _result("get_values", [{"field": "admissions.sat_25"}], "A"),
    )

    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "start", "end", "end"]
    start_a, start_b, end_b, end_a = steps
    # B's result (first to land) closed B's step, not A's.
    assert end_b["step_id"] == start_b["step_id"]
    assert end_b["kind"] == "web_search"
    assert end_a["step_id"] == start_a["step_id"]
    assert end_a["kind"] == "db_tool"
    assert start_a["step_id"] != start_b["step_id"]
    # Durations are computed independently per step.
    assert end_b["detail"]["duration_ms"] >= 0
    assert end_a["detail"]["duration_ms"] >= 0


def test_unmounted_tool_call_paints_no_step() -> None:
    """Story 17: a hallucinated call to a source-gated tool that is NOT mounted
    this turn must emit nothing — no search happened, so no step may paint."""
    chunks: list[dict[str, Any]] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        unmounted=frozenset({"search_web"}),
    )

    router.handle(_call("search_web", {"query": "duke dorms"}, "c1"))
    router.handle(_result("search_web", "tool not found", "c1"))

    assert chunks == []
    assert router.step_records == []


def test_ask_student_call_emits_no_step_and_orphan_result_is_ignored(rig: Rig) -> None:
    rig.feed(_call("ask_student", {"question": "What matters most?"}, "c1"))

    assert rig.chunks == []

    rig.feed(_result("ask_student", "cost", "c1"))  # unmatched: never opened

    assert rig.chunks == []
    assert rig.router.step_records == []


# ---------------------------------------------------------------------------
# Error shapes: a failed tool never gets a green check
# ---------------------------------------------------------------------------


def test_error_dict_result_gives_error_status_and_search_failed_label(rig: Rig) -> None:
    rig.feed(
        _call("search_web", {"query": "duke dorms"}, "c1"),
        _result("search_web", {"error": "rate limited"}, "c1"),
    )

    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "error"]
    assert "source unavailable" in steps[1]["label"]
    assert not any(step["status"] == "end" for step in steps)  # never a green check


def test_retry_prompt_result_gives_error_status_and_retry_label(rig: Rig) -> None:
    rig.feed(
        _call("get_values", {"unitid": 198419, "field_keys": []}, "c1"),
        _retry_result("get_values", "c1"),
    )

    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "error"]
    assert "needed a correction" in steps[1]["label"]


def test_retry_result_leaves_row_count_unset(rig: Rig) -> None:
    """A retry's content is a validation-error list — it must never be read as
    a row count in the receipt."""
    rig.feed(
        _call("get_values", {"unitid": 198419, "field_keys": []}, "c1"),
        _retry_result(
            "get_values",
            "c1",
            content=[{"type": "missing", "loc": ("field_keys",), "msg": "Field required"}],
        ),
    )

    detail = rig.steps()[1]["detail"]
    assert "row_count" not in detail


# ---------------------------------------------------------------------------
# Terminal closure
# ---------------------------------------------------------------------------


def test_close_interrupt_ends_open_step_with_original_label_and_flushes_text(rig: Rig) -> None:
    rig.feed(
        _call("search_web", {"query": "duke dorms"}, "c1"),
        _text_start("Partial answer held in the buffer"),
    )

    rig.router.close("interrupt")

    # The pending under-threshold text flushed as delta (final-answer prose).
    assert [chunk["text"] for chunk in rig.of_type("delta")] == [
        "Partial answer held in the buffer"
    ]
    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "end"]
    assert steps[1]["label"] == steps[0]["label"]  # original label, no error suffix
    assert steps[1]["detail"] is None


@pytest.mark.parametrize("reason", ["error", "budget"])
def test_close_error_and_budget_close_open_steps_as_error(rig: Rig, reason: str) -> None:
    rig.feed(_call("get_values", {"unitid": 198419, "field_keys": ["x"]}, "c1"))

    rig.router.close(reason)  # type: ignore[arg-type]

    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "error"]
    assert steps[1]["label"].endswith("— failed")  # the tool_failed template
    assert not rig.router._open  # nothing shimmers forever


def test_close_is_idempotent_and_handle_is_noop_after_close(rig: Rig) -> None:
    rig.feed(_call("get_values", {"unitid": 198419, "field_keys": ["x"]}, "c1"))
    rig.router.close("error")
    chunks_after_close = len(rig.chunks)

    rig.router.close("complete")  # second close: no re-emission
    rig.feed(  # late events: must never write to a closed stream
        _text_start("late text"),
        _text_end(None),
        _call("search_web", {"query": "late"}, "c2"),
    )

    assert len(rig.chunks) == chunks_after_close
    assert [step["status"] for step in rig.steps()] == ["start", "error"]


def test_close_flushes_pending_thinking_paragraph(rig: Rig) -> None:
    rig.feed(PartStartEvent(index=0, part=ThinkingPart(content="half a paragraph")))

    rig.router.close("complete")

    assert [chunk["text"] for chunk in rig.of_type("thinking")] == ["half a paragraph"]


# ---------------------------------------------------------------------------
# Native thinking feed (Gemini thought summaries)
# ---------------------------------------------------------------------------


def test_thinking_part_emits_per_paragraph_then_flushes_at_part_end(rig: Rig) -> None:
    rig.feed(PartStartEvent(index=0, part=ThinkingPart(content="A\n\nB")))

    # The complete paragraph is emitted immediately; the tail is buffered.
    assert [chunk["text"] for chunk in rig.of_type("thinking")] == ["A"]

    rig.feed(PartEndEvent(index=0, part=ThinkingPart(content=""), next_part_kind=None))

    assert [chunk["text"] for chunk in rig.of_type("thinking")] == ["A", "B"]


def test_thinking_deltas_accumulate_into_paragraphs(rig: Rig) -> None:
    rig.feed(
        PartStartEvent(index=0, part=ThinkingPart(content="First ")),
        PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="thought.\n\nSec")),
        PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="ond thought.\n\n")),
    )

    assert [chunk["text"] for chunk in rig.of_type("thinking")] == [
        "First thought.",
        "Second thought.",
    ]


# ---------------------------------------------------------------------------
# Post-run records
# ---------------------------------------------------------------------------


def test_step_records_hold_terminal_states_only_and_thinking_lines_accumulate(rig: Rig) -> None:
    rig.feed(
        _text_start("Checking the database."),
        _text_end("tool-call"),
        _call("get_values", {"unitid": 198419, "field_keys": ["x"]}, "c1"),
        _result("get_values", [{"field": "x"}], "c1"),
        _call("search_web", {"query": "dorms"}, "c2"),
        _result("search_web", {"error": "down"}, "c2"),
    )
    rig.router.close("complete")

    statuses = [record["status"] for record in rig.router.step_records]
    assert statuses == ["end", "error"]  # no 'start' entries
    assert rig.router.thinking_lines == ["Checking the database."]
