"""Unit tests for the EmissionRouter (app/steps.py) — B1a. No DB, no LLM.

Drives the router with hand-constructed pydantic-ai stream events and asserts
the writer-chunk protocol: final-result-gated answer deltas, pre-final
thinking routing, step pairing on ``tool_call_id`` (parallel calls), the
ask_student exclusion, result-shape error detection, and terminal closure
(``close``) semantics.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any, Literal

import pytest
from pydantic_ai import Agent, FinalResultEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
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
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, DeltaToolCalls, FunctionModel
from pydantic_ai.run import AgentRunResult, AgentRunResultEvent

from app.steps import THINKING_THRESHOLD_CHARS, EmissionRouter, StepMapper
from config.settings import load_yaml_asset

_SCHOOL_NAMES = {198419: "Duke University"}
Chunk = dict[str, Any]


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


def _final() -> FinalResultEvent:
    return FinalResultEvent(tool_name=None, tool_call_id=None)


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


def _marking_writer(chunks: list[Chunk], marks: list[str]) -> Callable[[Chunk], None]:
    def write(chunk: Chunk) -> None:
        chunks.append(chunk)
        marks.append(str(chunk["type"]))

    return write


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
        _final(),
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
    deltas = [chunk["text"] for chunk in rig.of_type("delta")]
    assert deltas == [long_tail, " And more."]


def test_pre_final_long_text_never_streams_as_delta(rig: Rig) -> None:
    pre_final = "x" * (THINKING_THRESHOLD_CHARS + 1)

    rig.feed(_text_start(pre_final))

    assert rig.of_type("delta") == []

    rig.feed(_text_end("tool-call"))

    assert rig.of_type("delta") == []
    assert [chunk["text"] for chunk in rig.of_type("thinking")] == [pre_final]


def test_final_result_event_starts_answer_once_before_first_delta() -> None:
    chunks: list[dict[str, Any]] = []
    marks: list[str] = []
    router = EmissionRouter(
        writer=_marking_writer(chunks, marks),
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        on_final_start=lambda: marks.append("final-start"),
    )

    router.handle(_final())
    router.handle(_text_start("Final answer."))
    router.handle(_text_delta(" More."))
    router.handle(_text_end(None))
    router.handle(_final())

    assert marks == ["final-start", "delta", "delta"]
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "delta"] == [
        "Final answer.",
        " More.",
    ]


def test_final_result_event_waits_for_text_part_end_before_buffered_delta() -> None:
    chunks: list[dict[str, Any]] = []
    marks: list[str] = []
    router = EmissionRouter(
        writer=_marking_writer(chunks, marks),
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        on_final_start=lambda: marks.append("final-start"),
    )

    router.handle(_text_start("First final chunk."))
    assert chunks == []

    router.handle(_final())
    router.handle(_text_delta(" Still final."))
    assert chunks == []

    router.handle(_text_end(None))

    assert marks == ["final-start", "delta"]
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "delta"] == [
        "First final chunk. Still final.",
    ]


def test_late_final_result_event_does_not_duplicate_visible_thinking() -> None:
    chunks: list[dict[str, Any]] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        threshold=10,
    )

    router.handle(_text_start("visible thinking"))
    router.handle(_final())
    router.handle(_text_delta(" final suffix"))
    router.handle(_text_end(None))

    assert [chunk["text"] for chunk in chunks if chunk["type"] == "thinking"] == [
        "visible thinking"
    ]
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "delta"] == [
        " final suffix"
    ]


def test_late_final_result_after_streamed_thinking_keeps_tail_as_thinking() -> None:
    chunks: list[dict[str, Any]] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        threshold=10,
    )

    router.handle(_text_start("visible thinking"))
    router.handle(_text_delta(" tail before final marker"))
    router.handle(_final())
    router.handle(_text_end(None))
    router.handle(_text_start("Actual final answer."))
    router.handle(_text_end(None))
    router.close("complete")

    assert [chunk["text"] for chunk in chunks if chunk["type"] == "thinking"] == [
        "visible thinking",
        "tail before final marker",
    ]
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "delta"] == [
        "Actual final answer."
    ]


def test_agent_run_result_event_fallback_flushes_buffered_final_text_once() -> None:
    chunks: list[dict[str, Any]] = []
    marks: list[str] = []
    router = EmissionRouter(
        writer=_marking_writer(chunks, marks),
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        on_final_start=lambda: marks.append("final-start"),
    )

    router.handle(_text_start("Final answer buffered by a late final marker."))
    router.handle(AgentRunResultEvent(result=AgentRunResult(output="")))

    assert marks == ["final-start", "delta"]
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "delta"] == [
        "Final answer buffered by a late final marker."
    ]


def test_agent_run_result_event_does_not_duplicate_visible_thinking() -> None:
    chunks: list[dict[str, Any]] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        threshold=10,
    )

    router.handle(_text_start("visible thinking"))
    router.handle(AgentRunResultEvent(result=AgentRunResult(output="")))

    assert [chunk["text"] for chunk in chunks if chunk["type"] == "thinking"] == [
        "visible thinking"
    ]
    assert [chunk for chunk in chunks if chunk["type"] == "delta"] == []


def test_router_honors_threshold() -> None:
    chunks: list[dict[str, Any]] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        threshold=10,
    )

    # 5 chars then a tool call → under threshold → thinking, never delta.
    router.handle(_text_start("hi io"))  # 5 chars
    router.handle(_text_end("tool-call"))
    assert [c["text"] for c in chunks if c["type"] == "thinking"] == ["hi io"]
    assert [c for c in chunks if c["type"] == "delta"] == []

    chunks.clear()
    router.handle(_text_start("x" * 12))
    assert [c for c in chunks if c["type"] == "delta"] == []


def test_router_threshold_default_is_module_constant() -> None:
    """The dataclass default stays the module constant (the test-time fallback)."""
    router = EmissionRouter(
        writer=lambda _chunk: None,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
    )
    assert router.threshold == THINKING_THRESHOLD_CHARS


def test_response_end_flushes_held_text_as_delta_not_thinking(rig: Rig) -> None:
    rig.feed(_final(), _text_start("Short final answer."), _text_end(None))

    assert [chunk["text"] for chunk in rig.of_type("delta")] == ["Short final answer."]
    assert rig.of_type("thinking") == []


def test_final_answer_phase_continues_streaming_text(rig: Rig) -> None:
    rig.feed(_final(), _text_start("x" * (THINKING_THRESHOLD_CHARS + 5)), _text_end(None))
    deltas_after_first = len(rig.of_type("delta"))

    rig.feed(_text_start("Short second response."))

    assert len(rig.of_type("delta")) == deltas_after_first + 1

    rig.feed(_text_end(None))

    assert rig.of_type("delta")[-1]["text"] == "Short second response."


@pytest.mark.asyncio
async def test_final_result_event_orders_before_text_delta_with_function_model() -> None:
    def model_fn(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        returned = (
            [part for part in last.parts if isinstance(part, ToolReturnPart)]
            if isinstance(last, ModelRequest)
            else []
        )
        if returned:
            return ModelResponse(parts=[TextPart("Final answer after tool.")])
        return ModelResponse(
            parts=[
                TextPart("I will look this up first."),
                ToolCallPart(tool_name="lookup", args={"query": "Duke"}),
            ]
        )

    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        response = model_fn(messages, info)
        for index, part in enumerate(response.parts):
            if isinstance(part, TextPart):
                yield part.content
            elif isinstance(part, ToolCallPart):
                yield {index: DeltaToolCall(name=part.tool_name, json_args=part.args_as_json_str())}

    async def lookup(query: str) -> str:
        return f"looked up {query}"

    chunks: list[dict[str, Any]] = []
    raw_order: list[str] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
    )
    agent = Agent(FunctionModel(model_fn, stream_function=stream), tools=[lookup])

    async with agent.run_stream_events("compare Duke") as events:
        async for event in events:
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                raw_order.append(f"text:{event.part.content}")
            elif isinstance(event, FinalResultEvent):
                raw_order.append("FinalResultEvent")
            elif isinstance(event, AgentRunResultEvent):
                raw_order.append("AgentRunResultEvent")
            router.handle(event)

    final_text_marker = "text:Final answer after tool."
    final_text_index = raw_order.index(final_text_marker)
    assert "FinalResultEvent" in raw_order[:final_text_index]

    thinking_texts = [chunk["text"] for chunk in chunks if chunk["type"] == "thinking"]
    delta_texts = [chunk["text"] for chunk in chunks if chunk["type"] == "delta"]
    assert "I will look this up first." in thinking_texts
    assert "I will look this up first." not in delta_texts
    assert "Final answer after tool." in delta_texts


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


def test_close_interrupt_ends_open_step_with_original_label_and_flushes_text_as_thinking(
    rig: Rig,
) -> None:
    rig.feed(
        _call("search_web", {"query": "duke dorms"}, "c1"),
        _text_start("Partial answer held in the buffer"),
    )

    rig.router.close("interrupt")

    assert [chunk["text"] for chunk in rig.of_type("thinking")] == [
        "Partial answer held in the buffer"
    ]
    assert rig.of_type("delta") == []
    steps = rig.steps()
    assert [step["status"] for step in steps] == ["start", "end"]
    assert steps[1]["label"] == steps[0]["label"]  # original label, no error suffix
    assert steps[1]["detail"] is None


@pytest.mark.parametrize("reason", ["interrupt", "error", "budget"])
def test_close_before_final_result_never_calls_on_final_start_or_emits_delta(
    reason: Literal["interrupt", "error", "budget"],
) -> None:
    chunks: list[dict[str, Any]] = []
    final_starts: list[str] = []
    router = EmissionRouter(
        writer=chunks.append,
        mapper=StepMapper(load_yaml_asset("step_labels"), _SCHOOL_NAMES.get),
        on_final_start=lambda: final_starts.append("final-start"),
    )

    router.handle(_text_start("Pending pre-final text."))

    router.close(reason)

    assert final_starts == []
    assert [chunk for chunk in chunks if chunk["type"] == "delta"] == []
    assert [chunk["text"] for chunk in chunks if chunk["type"] == "thinking"] == [
        "Pending pre-final text."
    ]


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
