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
