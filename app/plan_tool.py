"""Agent-mode planning tool.

Ported from pydantic-ai-harness
``experimental/planning/_toolset.py`` at
``b5b93704c3d997bf1910528d964306118589738c`` (MIT). The v2 capability wrapper
is intentionally not used; Agent V1 only needs the small tool logic on
PydanticAI 1.x.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_ai import RunContext
from pydantic_ai.capabilities import WrapModelRequestHandler
from pydantic_ai.capabilities.abstract import AbstractCapability
from pydantic_ai.messages import CachePoint, ModelRequest, ModelResponse, UserPromptPart
from pydantic_ai.models import ModelRequestContext


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


def _reminder_text(rendered_plan: str) -> str:
    """Wrap the rendered checklist for the ephemeral tail reminder."""
    return f"<plan-reminder>\n{rendered_plan}\n</plan-reminder>"


@dataclass
class PlanReminder(AbstractCapability[Any]):
    """Ephemeral tail reminder of the current plan (harness Planning, D13).

    Appends the rendered checklist to the tail of the *outgoing* model
    request only -- never to durable history -- so the model re-reads its
    own plan on every step without the reminder ever being persisted or
    replayed. A ``CachePoint`` precedes it so the cached prefix (system
    prompt + prior turns) stays byte-identical across requests.
    """

    state: PlanState
    cache_ttl: Literal["5m", "1h"] = "5m"

    async def wrap_model_request(
        self,
        ctx: RunContext[Any],
        *,
        request_context: ModelRequestContext,
        handler: WrapModelRequestHandler,
    ) -> ModelResponse:
        items = self.state.items
        if not items:
            return await handler(request_context)
        messages = request_context.messages
        last = messages[-1] if messages else None
        if isinstance(last, ModelRequest):
            reminder = UserPromptPart(
                content=[CachePoint(ttl=self.cache_ttl), _reminder_text(render_plan(items))]
            )
            messages[-1] = replace(last, parts=[*last.parts, reminder])
        return await handler(request_context)


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
        """Create or replace the full task plan for a multi-step task.

        Skip this tool for trivial, single-step, or purely conversational work
        -- planning a task that doesn't need it just adds noise.

        Mark a step `in_progress` before you start it, and `completed`
        immediately after you finish it -- don't batch updates. Keep exactly
        one step `in_progress` at a time, and never call `write_plan` more
        than once in parallel (full replacement makes concurrent calls race).

        Only mark a step `completed` when it is fully done. If you hit an
        error or a blocker, leave it `in_progress` and add a new step naming
        the blocker -- don't mark it complete to move on.

        Pass the entire ordered plan every time, including steps that are
        unchanged, completed, or cancelled -- this call fully replaces the
        plan, it does not patch it.

        Your final answer to the student must come in the message AFTER your
        last `write_plan` call; marking the last step complete is not itself
        an answer.

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
