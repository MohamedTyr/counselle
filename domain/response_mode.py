"""The Quick/Think response-mode enum (plans/quick-think-response-mode.md §3.1).

Shared boundary type for HTTP input, session persistence, graph state, turn
records, and model resolution. Contains no provider dependency.
"""

from __future__ import annotations

from enum import StrEnum


class ResponseMode(StrEnum):
    """A student's per-turn speed/depth selection.

    ``QUICK`` is the default for every new chat and the safe fallback for
    legacy or malformed persisted values. ``THINK`` requests more time and
    provider thought summaries (subject to ``thinking_stream``).
    """

    QUICK = "quick"
    THINK = "think"
