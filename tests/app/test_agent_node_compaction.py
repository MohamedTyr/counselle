"""Phase 1 compaction test (plans/goal-mode-plan.md §6.1).

The one test that earns its place: a long synthetic history shrinks across a
real tool-calling run with zero orphaned ``tool_call_id``s. A provider
rejects an orphaned tool call outright (a hard 4xx, not a soft degradation),
so this is the R6 hard-failure risk, not a reflexive coverage test — see
``_ClearToolResults`` §1.6.4 and CLAUDE.md's "no reflexive tests" rule.

Uses a deterministic ``FunctionModel``, so this costs nothing and needs no
live model/DB (routine suite).
"""

from __future__ import annotations

from pydantic_ai import Agent, Tool
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.agent_node import _CompactionBeat

_BIG_TOOL_RESULT = "x" * 2_000
_HISTORY_PAIRS = 8


def _synthetic_history() -> list[ModelMessage]:
    """8 tool-call/return pairs with an oversized result — comfortably past
    any reasonable ``max_messages``/``min_clear_tokens`` trigger."""
    history: list[ModelMessage] = []
    for i in range(_HISTORY_PAIRS):
        call_id = f"history-call-{i}"
        history.append(ModelRequest(parts=[UserPromptPart(content=f"user msg {i}")]))
        history.append(
            ModelResponse(
                parts=[ToolCallPart(tool_name="lookup", tool_call_id=call_id, args={"value": i})]
            )
        )
        history.append(
            ModelRequest(
                parts=[
                    ToolReturnPart(
                        tool_name="lookup", tool_call_id=call_id, content=_BIG_TOOL_RESULT
                    )
                ]
            )
        )
    return history


async def lookup(value: int) -> str:
    return f"lookup-result-{value}"


def _tool_call_ids(messages: list[ModelMessage]) -> set[str]:
    return {
        part.tool_call_id
        for message in messages
        if isinstance(message, ModelResponse)
        for part in message.parts
        if isinstance(part, ToolCallPart) and part.tool_call_id
    }


def _tool_return_ids(messages: list[ModelMessage]) -> set[str]:
    return {
        part.tool_call_id
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    }


def _tool_result_chars(messages: list[ModelMessage]) -> int:
    return sum(
        len(str(part.content))
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart) and part.tool_name == "lookup"
    )


async def test_clear_tool_results_shrinks_history_with_zero_orphaned_tool_calls() -> None:
    new_calls = {"n": 0}

    def model_fn(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        # Three more real, in-run tool calls on top of the injected history —
        # proves pairing survives compaction firing *during* a live run, not
        # only on a static replay.
        if new_calls["n"] < 3:
            new_calls["n"] += 1
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="lookup",
                        tool_call_id=f"live-call-{new_calls['n']}",
                        args={"value": new_calls["n"]},
                    )
                ]
            )
        return ModelResponse(parts=[TextPart(content="done")])

    clears: list[None] = []
    agent = Agent(
        FunctionModel(model_fn),
        tools=[Tool(lookup, takes_ctx=False)],
        capabilities=[
            _CompactionBeat(
                max_messages=10,
                keep_pairs=2,
                min_clear_tokens=0,
                on_clear=lambda: clears.append(None),
            )
        ],
    )

    history = _synthetic_history()
    result = await agent.run("continue", message_history=history)
    all_messages = result.all_messages()

    # Zero orphaned tool_call_ids (the hard-failure risk a provider 4xxs on).
    call_ids = _tool_call_ids(all_messages)
    return_ids = _tool_return_ids(all_messages)
    assert call_ids == return_ids
    assert call_ids  # sanity: the run actually made tool calls

    # The beat fired at least once, and the history's tool-result payload
    # genuinely shrank (old big results blanked to the placeholder).
    assert clears
    assert _tool_result_chars(all_messages) < _HISTORY_PAIRS * len(_BIG_TOOL_RESULT)
