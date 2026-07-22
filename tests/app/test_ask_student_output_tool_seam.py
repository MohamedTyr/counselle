"""Phase 0 characterization test for the `ask_student` output-tool seam.

See plans/clarifying-questions.md, "Architecture decision" §1 (`ask_student` is
an output tool, not an interrupt or function tool) and "Phase 0 — prove the
runtime seam". Before writing any production code for the v2 clarification
lifecycle, the plan requires proving the following against the pinned
``pydantic-ai==1.107.0`` runtime, using ``FunctionModel`` (no live LLM):

1. an ``Agent`` configured with
   ``output_type=[str, ToolOutput(SomeDraftModel, name="ask_student")]`` and
   ``end_strategy="early"`` turns a valid ``ask_student`` tool call into a
   typed model instance, and SKIPS a sibling ordinary function-tool call in
   the same model response instead of executing it;
2. invalid/malformed ``ask_student`` args cause a model retry (PydanticAI's
   built-in retry-on-validation-failure for output tools), not a hard failure;
3. ``result.all_messages()`` after the run contains the ``ask_student`` tool
   call followed by the synthesized ``ToolReturnPart``, this shape survives
   the pinned Google model's offline message mapper (no network), and the
   message list can seed a second, distinct ``Agent`` run that produces a
   plain ``str`` output without re-executing any first-run function tool.

Gate (plan): do not implement the v2 ask_student lifecycle until this passes.
If pinned pydantic-ai behavior differs from what is asserted here, stop that
implementation slice and update the ADR — do not fall back to LangGraph
``interrupt()``.
"""

from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.output import ToolOutput
from pydantic_ai.providers.google import GoogleProvider


class _DraftV2(BaseModel):
    """Minimal stand-in for the plan's ``ClarifyDraftV2`` (domain contracts are
    Phase 1 — this only needs a small model with a required, validatable
    field)."""

    question: str = Field(min_length=1)
    count: int = Field(ge=1, le=3)


def _make_agent(
    model_fn: Callable[[list[ModelMessage], AgentInfo], ModelResponse],
) -> Agent[None, str | _DraftV2]:
    return Agent(
        FunctionModel(model_fn),
        output_type=[str, ToolOutput(_DraftV2, name="ask_student")],
        end_strategy="early",
    )


async def test_valid_ask_student_becomes_typed_output_and_skips_sibling_tool() -> None:
    executed: list[str] = []
    calls = {"n": 0}

    def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        calls["n"] += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="ask_student",
                    args={"question": "Which program interests you?", "count": 1},
                ),
                ToolCallPart(tool_name="write_marker", args={"value": "should-not-run"}),
            ]
        )

    agent = _make_agent(model_fn)

    @agent.tool_plain
    def write_marker(value: str) -> str:
        executed.append(value)
        return "recorded"

    result = await agent.run("Help me pick a school")

    assert isinstance(result.output, _DraftV2)
    assert result.output.question == "Which program interests you?"

    # end_strategy="early" skips the sibling function-tool call entirely.
    assert executed == []
    assert calls["n"] == 1

    final_request = result.all_messages()[-1]
    assert isinstance(final_request, ModelRequest)
    returns = {
        part.tool_name: part.content
        for part in final_request.parts
        if isinstance(part, ToolReturnPart)
    }
    assert returns["ask_student"] == "Final result processed."
    assert returns["write_marker"] == "Tool not executed - a final result was already processed."


async def test_invalid_ask_student_args_trigger_a_model_retry() -> None:
    attempts = {"n": 0}

    def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        attempts["n"] += 1
        if attempts["n"] == 1:
            # Blank question + out-of-range count both violate _DraftV2's
            # validators, forcing PydanticAI to retry the output tool.
            return ModelResponse(
                parts=[ToolCallPart(tool_name="ask_student", args={"question": "", "count": 0})]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="ask_student",
                    args={"question": "Which program interests you?", "count": 1},
                )
            ]
        )

    agent = _make_agent(model_fn)

    result = await agent.run("Help me pick a school")

    assert attempts["n"] == 2
    assert isinstance(result.output, _DraftV2)
    assert result.output.count == 1

    messages = result.all_messages()
    retry_request = messages[2]
    assert isinstance(retry_request, ModelRequest)
    retry_parts = [part for part in retry_request.parts if isinstance(part, RetryPromptPart)]
    assert len(retry_parts) == 1
    assert retry_parts[0].tool_name == "ask_student"


async def test_all_messages_seed_a_continuation_run_with_no_first_run_tool_replay() -> None:
    executed_first_run_tool: list[str] = []

    def first_model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="ask_student",
                    args={"question": "Which program interests you?", "count": 1},
                )
            ]
        )

    first_agent = _make_agent(first_model_fn)

    @first_agent.tool_plain
    def write_marker(value: str) -> str:
        executed_first_run_tool.append(value)
        return "recorded"

    first_result = await first_agent.run("Help me pick a school")
    history = first_result.all_messages()

    # Shape: user prompt -> ask_student call -> synthesized ToolReturnPart.
    assert len(history) == 3
    assert isinstance(history[1], ModelResponse)
    call_names = [part.tool_name for part in history[1].parts if isinstance(part, ToolCallPart)]
    assert call_names == ["ask_student"]
    assert isinstance(history[2], ModelRequest)
    assert any(
        isinstance(part, ToolReturnPart) and part.tool_name == "ask_student"
        for part in history[2].parts
    )

    # The completed history maps cleanly through the pinned Google model's
    # offline message mapper (no network call — this only builds the request
    # payload) so a real gemini continuation would not choke on a dangling
    # tool call or malformed turn.
    google_model = GoogleModel(
        "gemini-2.5-flash", provider=GoogleProvider(api_key="offline-test-key")
    )
    # noqa: SLF001 - Phase 0 characterization only; proves the pinned Google
    # request mapper accepts this exact message shape.
    _system_instruction, contents = await google_model._map_messages(
        history, ModelRequestParameters()
    )
    assert len(contents) == 3

    second_calls = {"n": 0}

    def second_model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        second_calls["n"] += 1
        return ModelResponse(parts=[TextPart("Great, focusing on your major then.")])

    second_agent: Agent[None, str] = Agent(FunctionModel(second_model_fn), output_type=str)

    @second_agent.tool_plain
    def second_agent_write_marker(value: str) -> str:
        executed_first_run_tool.append("SHOULD-NOT-HAPPEN")
        return "recorded"

    second_result = await second_agent.run("My intended major", message_history=history)

    assert second_result.output == "Great, focusing on your major then."
    assert second_calls["n"] == 1
    # No tool from the first run (nor its second-agent namesake) re-executed.
    assert executed_first_run_tool == []
