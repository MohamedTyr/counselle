"""Usage aggregation for the deep-research subgraph."""

from __future__ import annotations

from typing import Any

from app.usage import estimate_cost
from domain.events import UsageData


def record_model_usage(
    research: dict[str, Any],
    usage: Any,
    *,
    model_name: str,
    settings: Any,
) -> None:
    """Add one PydanticAI run's usage into ``research["usage"]``.

    ``usage`` is intentionally typed as ``Any`` because tests pass small fakes
    and PydanticAI exposes a lightweight dataclass. Missing attrs count as zero.
    """
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    tool_calls = int(getattr(usage, "tool_calls", 0) or 0)

    current = _usage_dict(research)
    current["input_tokens"] += input_tokens
    current["output_tokens"] += output_tokens
    current["tool_calls"] += tool_calls

    est = estimate_cost(
        model_name,
        input_tokens,
        output_tokens,
        getattr(settings, "model_prices", {}),
    )
    if est is not None:
        current["est_cost_usd"] = float(current.get("est_cost_usd") or 0.0) + est

    research["usage"] = current
    caps = dict(research.get("caps") or {})
    caps["est_cost_usd"] = current.get("est_cost_usd")
    research["caps"] = caps


def aggregate_usage(research: dict[str, Any]) -> dict[str, Any]:
    """Return the terminal ``UsageData`` payload for the whole research turn."""
    usage = _usage_dict(research)
    return UsageData(
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        tool_calls=usage["tool_calls"],
        est_cost_usd=usage.get("est_cost_usd"),
    ).model_dump(mode="json")


def _usage_dict(research: dict[str, Any]) -> dict[str, Any]:
    raw = research.get("usage")
    if not isinstance(raw, dict):
        raw = {}
    est = raw.get("est_cost_usd")
    return {
        "input_tokens": int(raw.get("input_tokens") or 0),
        "output_tokens": int(raw.get("output_tokens") or 0),
        "tool_calls": int(raw.get("tool_calls") or 0),
        "est_cost_usd": float(est) if est is not None else None,
    }
