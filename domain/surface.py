"""The UI-surface enum (plans/essay-ai-panel.md Part 1 §1.1).

Shared boundary type for HTTP input, turn state, and the agent node's prompt
and tool-profile selection. Contains no provider dependency.
"""

from __future__ import annotations

from enum import StrEnum


class Surface(StrEnum):
    """Which UI surface originated this turn.

    ``CHAT`` is the default for every turn and the safe fallback for legacy or
    malformed persisted values. ``ESSAY`` is the essay editor's AI panel: a
    different system prompt and a narrower tool profile, scoped to the one
    essay the panel has open.
    """

    CHAT = "chat"
    ESSAY = "essay"
