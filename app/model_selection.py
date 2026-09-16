"""Server-owned Quick/Think model resolution (plans/quick-think-response-mode.md §3.2).

The browser sends only ``"quick"`` or ``"think"``; it never sends a model ID,
provider, thinking level, or ``include_thoughts`` flag. This module is the only
mapping from that product intent to provider configuration.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from domain.response_mode import ResponseMode

if TYPE_CHECKING:
    from config.settings import Settings

_VERTEX_PREFIX = "google-vertex:"


def model_name_from_setting(model_setting: str) -> str:
    """``"google-vertex:gemini-2.5-pro"`` → ``"gemini-2.5-pro"`` — the provider
    prefix is unusable with our Express-mode key; only the bare model name
    feeds the explicit ``GoogleModel``/genai-client constructors that consume
    it (``app.agent_node.default_model_factory`` and its siblings in
    ``app.titles``, ``app.workspace.document_summary``, ``evals.runner``).

    Hoisted here from ``app.agent_node`` (school-data-v3 Phase 0) — this
    module is the model-selection seam, so the name-normalization helper
    belongs beside it rather than in the agent node. ``app.agent_node``
    re-exports the name so existing ``from app.agent_node import
    model_name_from_setting`` imports keep working unchanged.
    """
    return model_setting.split(":", 1)[-1]


@dataclass(frozen=True)
class CounselorModelSelection:
    """The immutable, fully-resolved model configuration for one turn."""

    response_mode: ResponseMode
    model_setting: str
    thinking_level: Literal["MINIMAL", "HIGH"]
    include_thoughts: bool


class UnsupportedCounselorProvider(RuntimeError):
    """Raised when a configured counselor model setting is not ``google-vertex:``.

    The current production factory always constructs a ``GoogleModel``;
    silently stripping an unknown prefix would misroute the call through
    Google. Provider-generic construction is a separate ADR-level change.
    """


def _require_vertex_prefix(model_setting: str) -> None:
    if not model_setting.startswith(_VERTEX_PREFIX):
        raise UnsupportedCounselorProvider(
            f"counselor model setting {model_setting!r} must use the "
            f"{_VERTEX_PREFIX!r} prefix; provider-generic construction is not "
            "implemented"
        )


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
    """Resolve *response_mode* to exactly one model + thinking configuration.

    Quick maps to ``settings.model_counselor`` (the existing Quick setting,
    kept unrenamed to preserve ``COUNSELLE_MODEL_COUNSELOR`` compatibility) at
    ``MINIMAL`` thinking with no requested provider thoughts. Think maps to
    ``settings.model_counselor_think`` at ``HIGH`` thinking, with provider
    thoughts requested only when ``settings.effective_thinking_stream`` is on.
    """
    if response_mode is ResponseMode.THINK:
        model_setting = settings.model_counselor_think
        _require_vertex_prefix(model_setting)
        return CounselorModelSelection(
            response_mode=ResponseMode.THINK,
            model_setting=model_setting,
            thinking_level="HIGH",
            include_thoughts=settings.effective_thinking_stream,
        )

    model_setting = settings.model_counselor
    _require_vertex_prefix(model_setting)
    return CounselorModelSelection(
        response_mode=ResponseMode.QUICK,
        model_setting=model_setting,
        thinking_level="MINIMAL",
        include_thoughts=False,
    )
