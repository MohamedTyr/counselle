"""Agent-mode planning tool.

Ported from pydantic-ai-harness
``experimental/planning/_toolset.py`` at
``b5b93704c3d997bf1910528d964306118589738c`` (MIT). The v2 capability wrapper
is intentionally not used; Agent V1 only needs the small tool logic on
PydanticAI 1.x.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(StrEnum):
    """Lifecycle status of a single plan step."""

    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


_STATUS_ICONS = {
    TaskStatus.pending: "[ ]",
    TaskStatus.in_progress: "[~]",
    TaskStatus.completed: "[x]",
    TaskStatus.cancelled: "[-]",
}


class PlanItem(BaseModel):
    """A single step in the plan."""

    content: str = Field(
        description='Imperative description of the step, e.g. "Compare net prices".'
    )
    status: TaskStatus = Field(
        default=TaskStatus.pending,
        description="Current status of this step.",
    )


@dataclass
class PlanState:
    """Mutable per-run plan storage shared by the write_plan closure."""

    items: list[PlanItem] = field(default_factory=list[PlanItem])


def render_plan(items: list[PlanItem]) -> str:
    """Render the plan as a checklist with a one-line progress summary."""
    if not items:
        return "No plan yet."
    lines = [
        f"{index + 1}. {_STATUS_ICONS[item.status]} {item.content}"
        for index, item in enumerate(items)
    ]
    completed = sum(1 for item in items if item.status is TaskStatus.completed)
    lines.append(f"({completed}/{len(items)} completed)")
    return "\n".join(lines)


def _summary(items: list[PlanItem]) -> str:
    total = len(items)
    in_progress = sum(1 for item in items if item.status is TaskStatus.in_progress)
    completed = sum(1 for item in items if item.status is TaskStatus.completed)
    if total == 0:
        return "Plan updated: no steps."
    step_word = "step" if total == 1 else "steps"
    return f"Plan updated: {total} {step_word}, {completed} completed, {in_progress} in progress."


def _receipt(items: list[PlanItem]) -> dict[str, Any]:
    return {
        "items": [item.model_dump(mode="json") for item in items],
        "completed": sum(1 for item in items if item.status is TaskStatus.completed),
        "total": len(items),
    }


def make_write_plan_tool(
    state: PlanState | None = None,
) -> Callable[[list[PlanItem]], Awaitable[dict[str, Any]]]:
    """Return the run-local ``write_plan`` tool."""

    plan_state = state or PlanState()

    async def write_plan(items: list[PlanItem]) -> dict[str, Any]:
        """Create or replace the full task plan.

        Pass the entire ordered plan every time -- including steps that are
        unchanged, completed, or cancelled. Keep exactly one step `in_progress`.
        Call this when you start and when you finish a step so your progress
        stays visible.

        Args:
            items: The complete ordered list of plan steps.
        """
        plan_state.items = list(items)
        in_progress = sum(1 for item in items if item.status is TaskStatus.in_progress)
        next_actions = (
            ["Keep only one step in_progress at a time."]
            if in_progress > 1
            else ["Continue with the in-progress step."]
        )
        return {
            "status": "success",
            "summary": _summary(plan_state.items),
            "rendered_plan": render_plan(plan_state.items),
            "public_receipt": _receipt(plan_state.items),
            "next_actions": next_actions,
        }

    write_plan.__name__ = "write_plan"
    return write_plan
