"""One seam for cross-cutting tool result handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.sources import SourceRegistry
from app.tool_overflow import ToolResultStore, reduce_tool_result

_SEARCH_TOOLS = frozenset({"search_web", "search_school_site", "search_reddit"})


@dataclass
class ToolMiddlewareContext:
    registry: SourceRegistry | None = None
    overflow_store: ToolResultStore | None = None
    max_result_chars: int = 0


def annotate_citations(
    result: Any, context: ToolMiddlewareContext | None, *, tool_name: str | None
) -> Any:
    """Attach source markers to cited tool results without mutating payloads."""
    if context is None or context.registry is None:
        return result
    if tool_name in _SEARCH_TOOLS:
        return context.registry.annotate_search_results(result)
    return context.registry.annotate_envelopes(result)


def error_envelope(result: Any) -> Any:
    """Normalize tool error returns.

    Today the concrete tools already return the D6 shape themselves. Keeping
    this as an explicit pipeline stage makes the order testable and gives MCP
    server errors one stable target shape.
    """
    return result


def overflow_spill(
    result: Any,
    context: ToolMiddlewareContext | None,
    *,
    exempt_overflow: bool = False,
) -> Any:
    """Spill oversized payloads after annotations/error normalization."""
    if context is None or context.overflow_store is None or exempt_overflow:
        return result
    return reduce_tool_result(result, context.overflow_store, max_chars=context.max_result_chars)


def process_tool_result(
    result: Any,
    context: ToolMiddlewareContext | None,
    *,
    tool_name: str | None = None,
    exempt_overflow: bool = False,
) -> Any:
    """Apply the ordered tool-result middleware pipeline."""
    result = annotate_citations(result, context, tool_name=tool_name)
    result = error_envelope(result)
    return overflow_spill(result, context, exempt_overflow=exempt_overflow)
