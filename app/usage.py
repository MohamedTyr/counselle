"""Per-turn usage accounting: cost estimation + structured turn_complete logging.

ARCHITECTURE §19: every turn emits one structured ``turn_complete`` log line with
token counts, duration, and an estimated USD cost. The estimate is best-effort —
None for any model not in the ``model_prices`` table — and is documented as such.

This is the single canonical home for per-turn usage accounting. The turn
registry (``app/turns.py``) owns usage enrichment and the ``turn_complete`` log,
so the logic lives in ``app/`` — ``app/`` must never import ``api/`` (ADR 0017
layering). The former ``api/usage.py`` re-export shim was deleted in M5; import
``enrich_usage_event`` / ``estimate_cost`` / ``log_turn_complete`` from here.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from domain.events import Event, UsageData

if TYPE_CHECKING:
    from config.settings import ModelPriceTier


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
    prices: dict[str, ModelPriceTier],
) -> float | None:
    """Return the estimated USD cost for one turn, or ``None`` for an unknown model.

    Matching strategy (first hit wins):
    1. Exact key lookup (``"gemini-2.5-pro"``).
    2. Bare-name suffix match — strips the provider prefix
       (``"google-vertex:gemini-2.5-pro"`` → tries ``"gemini-2.5-pro"``).

    When the matched tier has a long-context threshold and *input_tokens*
    exceeds it, Google's long-context rates apply to ALL tokens in the turn
    (not just the overage) — this mirrors that billing behavior exactly.

    Args:
        model_name:    The model identifier used for the turn.
        input_tokens:  Number of prompt/input tokens consumed.
        output_tokens: Number of completion/output tokens generated.
        prices:        Mapping of bare model name -> :class:`ModelPriceTier`.

    Returns:
        Estimated cost in USD, or ``None`` when the model is not in *prices*.
    """
    tier = prices.get(model_name)
    if tier is None:
        tier = prices.get(_bare_model_name(model_name))
    if tier is None:
        return None

    input_rate = tier.input_per_1m
    output_rate = tier.output_per_1m
    if (
        tier.long_context_threshold_tokens is not None
        and input_tokens > tier.long_context_threshold_tokens
        and tier.long_context_input_per_1m is not None
        and tier.long_context_output_per_1m is not None
    ):
        input_rate = tier.long_context_input_per_1m
        output_rate = tier.long_context_output_per_1m

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
    response_mode: str | None = None,
    model: str | None = None,
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
    - ``response_mode`` / ``model`` (plan/quick-think-response-mode.md §7.1 —
      so mode latency/cost can be compared without joining transcript state;
      ``None`` for a caller that predates response modes)
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
            "response_mode": response_mode,
            "model": model,
        },
    )
