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

from dataclasses import dataclass
from typing import Any

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
from pydantic_ai.usage import RunUsage

from app.agent_node import _CompactionBeat, compaction_capabilities

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


# ---------------------------------------------------------------------------
# The goal-only summarizing tier (D11, plans/goal-mode-plan.md §4.2)
# ---------------------------------------------------------------------------


@dataclass
class _CompactionSettings:
    """The slice of Settings `compaction_capabilities` reads."""

    compaction_clear_tool_results_after_messages: int = 10
    compaction_clear_tool_keep_pairs: int = 2
    compaction_min_clear_tokens: int = 0
    # Small enough that the cheap tier cannot get under it, so the escalation
    # always reaches the summarizer.
    goal_compaction_target_tokens: int = 100
    goal_compaction_keep_tokens: int = 200


_SUMMARY_MARKER = "<messages>"


def _is_summary_request(messages: list[ModelMessage]) -> bool:
    """A summarization call is the one carrying the library's prompt template."""
    return any(
        _SUMMARY_MARKER in part.content
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, UserPromptPart) and isinstance(part.content, str)
    )


def _summary_beats(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [step for step in steps if str(step["data"]["step_id"]).startswith("compaction-summary")]


async def _run_with_summarizer(
    *,
    summary_fails: bool,
    goal_mode: bool = True,
) -> tuple[list[dict[str, Any]], list[str], RunUsage, Any]:
    """One agent run wired through the real `compaction_capabilities`.

    The summarization model is the run's own model (`model=None` inherits it),
    which here is a deterministic `FunctionModel` — so this never calls a live
    model, and it also *proves* the inheritance: a summary request only ever
    reaches this function if the tier did not resolve a model of its own.
    """
    steps: list[dict[str, Any]] = []
    seen: list[str] = []

    def model_fn(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if _is_summary_request(messages):
            seen.append("summary")
            if summary_fails:
                raise RuntimeError("summarizer unavailable")
            return ModelResponse(parts=[TextPart(content="condensed history")])
        seen.append("agent")
        return ModelResponse(parts=[TextPart(content="done")])

    usage = RunUsage()
    agent = Agent(
        FunctionModel(model_fn),
        capabilities=compaction_capabilities(
            _CompactionSettings(), steps.append, goal_mode=goal_mode
        ),
    )
    result = await agent.run("continue", message_history=_synthetic_history(), usage=usage)
    return steps, seen, usage, result


async def test_goal_turn_summarizes_and_discloses_it() -> None:
    steps, seen, usage, result = await _run_with_summarizer(summary_fails=False)

    # The tier ran, on the agent's own (inherited) model.
    assert seen.count("summary") >= 1
    # C4: the student is told, in its own words — a summarization rewrites
    # earlier turns, which is not the same event as blanking tool results.
    beats = _summary_beats(steps)
    assert beats
    assert beats[0]["data"]["label"] == "Summarized the earlier conversation to keep working"
    # Cost attribution: the summary's request folds into the SAME shared
    # RunUsage the goal loop prices its agent slice from, so it can never be
    # spent off the ledger.
    assert usage.requests == len(seen)
    # The history really was rewritten, and stayed pair-safe.
    assert _tool_call_ids(result.all_messages()) == _tool_return_ids(result.all_messages())


async def test_summarization_failure_does_not_abort_the_run() -> None:
    """A goal run is the long, unattended case: a summary call that dies must
    degrade to the un-summarized history, not kill the turn the student has
    been waiting on. It must also not claim a compaction that never happened.
    """
    steps, seen, _usage, result = await _run_with_summarizer(summary_fails=True)

    assert seen.count("summary") >= 1
    assert result.output == "done"  # the run finished anyway
    assert _summary_beats(steps) == []  # and never said otherwise


async def test_summarizing_tier_is_goal_only() -> None:
    """D11: an ordinary turn gets the cheap tier and nothing else — no model
    call is ever made on its behalf.
    """
    ordinary = compaction_capabilities(_CompactionSettings(), lambda _e: None, goal_mode=False)
    assert [type(cap) for cap in ordinary] == [_CompactionBeat]

    _steps, seen, _usage, _result = await _run_with_summarizer(summary_fails=False, goal_mode=False)
    assert "summary" not in seen
