"""Unit tests for the Agent V1 planning tool."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from pydantic_ai import Agent, Tool
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    TextPart,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.plan_tool import (
    PlanItem,
    PlanReminder,
    PlanState,
    TaskStatus,
    make_write_plan_tool,
    render_plan,
)


def test_plan_item_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        PlanItem.model_validate({"content": "Compare schools", "status": "blocked"})


def test_render_plan_outputs_checklist_and_summary() -> None:
    rendered = render_plan(
        [
            PlanItem(content="Resolve schools", status=TaskStatus.completed),
            PlanItem(content="Compare costs", status=TaskStatus.in_progress),
            PlanItem(content="Write answer", status=TaskStatus.pending),
        ]
    )

    assert "1. [x] Resolve schools" in rendered
    assert "2. [~] Compare costs" in rendered
    assert "3. [ ] Write answer" in rendered
    assert rendered.endswith("(1/3 completed)")


async def test_write_plan_replaces_full_plan_and_returns_public_receipt() -> None:
    state = PlanState(
        items=[PlanItem(content="Old step", status=TaskStatus.in_progress)]
    )
    write_plan = make_write_plan_tool(state)

    result = await write_plan(
        [
            PlanItem(content="Check data", status=TaskStatus.completed),
            PlanItem(content="Draft answer", status=TaskStatus.in_progress),
        ]
    )

    assert [item.content for item in state.items] == ["Check data", "Draft answer"]
    assert result["status"] == "success"
    assert result["summary"] == "Plan updated: 2 steps, 1 completed, 1 in progress."
    assert result["public_receipt"] == {
        "items": [
            {"content": "Check data", "status": "completed"},
            {"content": "Draft answer", "status": "in_progress"},
        ],
        "completed": 1,
        "total": 2,
    }
    assert "(1/2 completed)" in result["rendered_plan"]


async def test_write_plan_notes_multiple_in_progress_steps() -> None:
    write_plan = make_write_plan_tool()

    result = await write_plan(
        [
            PlanItem(content="First", status=TaskStatus.in_progress),
            PlanItem(content="Second", status=TaskStatus.in_progress),
        ]
    )

    assert result["next_actions"] == ["Keep only one step in_progress at a time."]


async def test_plan_reminder_appends_ephemeral_tail_reminder_only_to_second_request() -> None:
    """D13 Phase 2 behavior 1: the reminder surfaces on the request *after*
    the plan is written, appended to the outgoing request only."""

    state = PlanState()
    seen_messages: list[list[ModelMessage]] = []

    def model_fn(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        seen_messages.append(list(messages))
        if len(seen_messages) == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="write_plan",
                        args={"items": [{"content": "Check data", "status": "in_progress"}]},
                    )
                ]
            )
        return ModelResponse(parts=[TextPart("Done.")])

    agent = Agent(
        FunctionModel(model_fn),
        tools=[Tool(make_write_plan_tool(state), takes_ctx=False)],
        capabilities=[PlanReminder(state)],
    )

    await agent.run("Plan the task.")

    assert len(seen_messages) == 2
    first_request_text = str(seen_messages[0])
    assert "<plan-reminder>" not in first_request_text

    second_request_tail = seen_messages[1][-1]
    tail_part = second_request_tail.parts[-1]
    assert isinstance(tail_part, UserPromptPart)
    reminder_content = tail_part.content[-1]
    assert isinstance(reminder_content, str)
    assert "<plan-reminder>" in reminder_content
    assert render_plan(state.items) in reminder_content


async def test_plan_reminder_never_leaks_into_durable_history() -> None:
    """D13 Phase 2 behavior 2: a leaked reminder in ``all_messages()`` would
    be persisted by the checkpointer and re-sent on every future replay."""

    state = PlanState()

    def model_fn(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        has_tool_call = any(
            isinstance(part, ToolCallPart)
            for message in messages
            for part in getattr(message, "parts", [])
        )
        if not has_tool_call:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="write_plan",
                        args={"items": [{"content": "Check data", "status": "in_progress"}]},
                    )
                ]
            )
        return ModelResponse(parts=[TextPart("Done.")])

    agent = Agent(
        FunctionModel(model_fn),
        tools=[Tool(make_write_plan_tool(state), takes_ctx=False)],
        capabilities=[PlanReminder(state)],
    )

    result = await agent.run("Plan the task.")

    for message in result.all_messages():
        assert "plan-reminder" not in str(message)
