"""One seam for cross-cutting tool result handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.sources import SourceRegistry
from app.tool_overflow import ToolResultStore, reduce_tool_result
from domain.events import tool_ui_from_payload

_SEARCH_TOOLS = frozenset({"search_web", "search_school_site", "search_reddit"})
_OVERFLOW_EXEMPT_TOOLS = frozenset({"render_viz"})


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


def demote_tool_ui(result: Any) -> Any:
    """Move a top-level tool ``ui`` payload into ``public_receipt.ui``.

    The raw ``ui`` key is intended for the client-side step event, not for the
    model-visible tool result. Keeping the public copy on the receipt also lets
    overflow reduction preserve it in the compact envelope.
    """
    if not isinstance(result, dict) or "ui" not in result:
        return result

    base = {key: value for key, value in result.items() if key != "ui"}
    ui = tool_ui_from_payload(result.get("ui"))
    if ui is None:
        return base

    receipt = base.get("public_receipt")
    receipt_dict = dict(receipt) if isinstance(receipt, dict) else {}
    return {**base, "public_receipt": {**receipt_dict, "ui": ui.model_dump()}}


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
    result = demote_tool_ui(result)
    exempt_overflow = exempt_overflow or tool_name in _OVERFLOW_EXEMPT_TOOLS
    return overflow_spill(result, context, exempt_overflow=exempt_overflow)
