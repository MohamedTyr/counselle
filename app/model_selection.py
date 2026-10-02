"""Server-owned Quick/Think model resolution (plans/quick-think-response-mode.md §3.2).

The browser sends only ``"quick"`` or ``"think"``; it never sends a model ID,
provider, or reasoning effort. This module is the only mapping from that
product intent to a model setting and reasoning effort.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from domain.response_mode import ResponseMode

if TYPE_CHECKING:
    from config.settings import ReasoningEffort, Settings


def model_name_from_setting(model_setting: str) -> str:
    """``"fireworks:accounts/fireworks/models/x"`` → ``"accounts/fireworks/models/x"``:
    the bare model name the provider API expects, with the provider prefix
    stripped (``app.llm.build_model`` consumes it).

    ``app.agent_node`` re-exports the name for the parked CDS code that
    imports it from there.
    """
    return model_setting.split(":", 1)[-1]


@dataclass(frozen=True)
class CounselorModelSelection:
    """The immutable, fully-resolved model configuration for one turn."""

    response_mode: ResponseMode
    model_setting: str
    reasoning_effort: ReasoningEffort


def goal_agent_model_setting(settings: Settings) -> str:
    """Resolve the model setting for the goal-mode agent's own iterations
    (plans/goal-mode-plan.md §2.10, D15). Empty ``settings.goal_model`` falls
    back to ``settings.model_cheap`` — the SAME ADR 0011 seam as
    :func:`goal_judge_model_setting`/:func:`goal_criteria_model_setting`, so
    all three goal-mode model knobs are resolved in one place rather than
    inline in ``app/agent_node.py``.
    """
    return settings.goal_model or settings.model_cheap


def goal_judge_model_setting(settings: Settings) -> str:
    """Resolve the model setting for the goal-mode judge call (plans/goal-mode-plan.md
    §3, D15). Empty ``settings.model_goal_judge`` falls back to ``settings.model_cheap``
    — the plan's default, made an explicit knob rather than inherited by accident.

    R2 (plans/goal-mode-plan.md §7.1): a cheap-tier judge is the model MOST
    vulnerable to verbosity/padding attacks (MT-Bench measured a 91.3% fool
    rate on weak judges vs. 8.7% on a strong one). Raising ``model_goal_judge``
    to a stronger tier than the agent itself is a live, argued-for owner
    option (§9(b)) — this seam is what makes that a config change, not a
    rewrite.
    """
    return settings.model_goal_judge or settings.model_cheap


def goal_criteria_model_setting(settings: Settings) -> str:
    """Resolve the model setting for the goal-mode criteria-derivation call
    (plans/goal-mode-plan.md §3.2, D15). Empty ``settings.model_goal_criteria``
    falls back to ``settings.model_cheap``.
    """
    return settings.model_goal_criteria or settings.model_cheap


def counselor_model_selection(
    response_mode: ResponseMode,
    settings: Settings,
) -> CounselorModelSelection:
    """Resolve *response_mode* to exactly one model setting + reasoning effort.

    Quick maps to ``settings.model_counselor`` at ``reasoning_effort_quick``;
    Think maps to ``settings.model_counselor_think`` at
    ``reasoning_effort_think``.
    """
    if response_mode is ResponseMode.THINK:
        return CounselorModelSelection(
            response_mode=ResponseMode.THINK,
            model_setting=settings.model_counselor_think,
            reasoning_effort=settings.reasoning_effort_think,
        )
    return CounselorModelSelection(
        response_mode=ResponseMode.QUICK,
        model_setting=settings.model_counselor,
        reasoning_effort=settings.reasoning_effort_quick,
    )
