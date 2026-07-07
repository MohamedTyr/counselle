"""Unit tests for the Agent V1 planning tool."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.plan_tool import PlanItem, PlanState, TaskStatus, make_write_plan_tool, render_plan


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
