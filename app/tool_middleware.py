"""One seam for cross-cutting tool result handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.tool_overflow import ToolResultStore, reduce_tool_result


@dataclass
class ToolMiddlewareContext:
    overflow_store: ToolResultStore
    max_result_chars: int


def process_tool_result(
    result: Any,
    context: ToolMiddlewareContext | None,
    *,
    exempt_overflow: bool = False,
) -> Any:
    """Apply the tool result middleware pipeline."""
    if context is None or exempt_overflow:
        return result
    return reduce_tool_result(
        result,
        context.overflow_store,
        max_chars=context.max_result_chars,
    )
