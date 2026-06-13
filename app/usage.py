"""Per-turn usage accounting: cost estimation + structured turn_complete logging.

ARCHITECTURE §19: every turn emits one structured ``turn_complete`` log line with
token counts, duration, and an estimated USD cost. The estimate is best-effort —
None for any model not in the ``model_prices`` table — and is documented as such.

Moved from ``api/usage.py`` at B2: the turn registry (``app/turns.py``) owns
usage enrichment and the ``turn_complete`` log now, and ``app/`` must never
import ``api/`` (ADR 0017 layering). ``api/usage.py`` re-exports for existing
importers.
"""

from __future__ import annotations

import logging
from typing import Any

from domain.events import Event, UsageData


def _bare_model_name(model_name: str) -> str:
    """Extract the bare model name from a provider-qualified string.

    Examples::

        "google-vertex:gemini-2.5-pro"  ->  "gemini-2.5-pro"
        "gemini-2.5-flash"              ->  "gemini-2.5-flash"
        "anthropic:claude-sonnet-4-6"   ->  "claude-sonnet-4-6"
    """
    if ":" in model_name:
        return model_name.split(":", 1)[1]
    return model_name


def estimate_cost(
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    prices: dict[str, tuple[float, float]],
) -> float | None:
    """Return the estimated USD cost for one turn, or ``None`` for an unknown model.

    Matching strategy (first hit wins):
    1. Exact key lookup (``"gemini-2.5-pro"``).
    2. Bare-name suffix match — strips the provider prefix
       (``"google-vertex:gemini-2.5-pro"`` → tries ``"gemini-2.5-pro"``).

    Args:
        model_name:    The model identifier used for the turn.
        input_tokens:  Number of prompt/input tokens consumed.
        output_tokens: Number of completion/output tokens generated.
        prices:        Mapping of bare model name → ``(input_per_1m, output_per_1m)``
                       USD rates.

    Returns:
        Estimated cost in USD, or ``None`` when the model is not in *prices*.
    """
    pair = prices.get(model_name)
    if pair is None:
        bare = _bare_model_name(model_name)
        pair = prices.get(bare)
    if pair is None:
        return None
    input_rate, output_rate = pair
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000


def enrich_usage_event(event: Event, model: str, settings: Any) -> Event:
    """Return a copy of *event* with ``est_cost_usd`` populated.

    The incoming *event* must have ``type == "usage"``.  The function validates
    the data into :class:`~domain.events.UsageData`, computes the cost estimate,
    and returns a new :class:`~domain.events.Event` with the filled field — the
    original is never mutated (immutability rule).

    If ``settings.usage_accounting`` is ``False``, the event is returned unchanged.
    """
    if not getattr(settings, "usage_accounting", True):
        return event

    usage = UsageData.model_validate(event.data)
    est = estimate_cost(
        model,
        usage.input_tokens,
        usage.output_tokens,
        getattr(settings, "model_prices", {}),
    )
    enriched_usage = UsageData(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        tool_calls=usage.tool_calls,
        est_cost_usd=est,
    )
    return Event(v=event.v, type=event.type, data=enriched_usage.model_dump())


def log_turn_complete(
    logger: logging.Logger,
    *,
    session_id: str,
    trace_id: str,
    usage: dict[str, Any],
    duration_ms: int,
    est_cost_usd: float | None,
    user_id: str | None = None,
) -> None:
    """Emit one structured ``turn_complete`` log line (ARCHITECTURE §19).

    The log line carries exactly these fields so log-aggregation pipelines can
    parse them without additional extraction:

    - ``event``: ``"turn_complete"`` (the log-event discriminator)
    - ``session_id``
    - ``user_id`` (``None`` until B3 wires auth)
    - ``trace_id``
    - ``input_tokens``
    - ``output_tokens``
    - ``tool_calls``
    - ``duration_ms``
    - ``est_cost_usd`` (float or ``None``)
    """
    logger.info(
        "turn_complete",
        extra={
            "event": "turn_complete",
            "session_id": session_id,
            "user_id": user_id,
            "trace_id": trace_id,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "tool_calls": usage.get("tool_calls", 0),
            "duration_ms": duration_ms,
            "est_cost_usd": est_cost_usd,
        },
    )
