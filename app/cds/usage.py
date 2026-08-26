"""Token-usage accumulation and cost estimation for one extraction run --
split out of `app/cds/engine.py` purely to keep it under the file-size
budget; used by the orchestrator (`engine.py`) and both sibling call modules
(`calling.py`, `starved_retry.py`, `batch_run.py`) to fold every call's usage
into the run's running total.
"""

from __future__ import annotations

from adapters import cds_gemini

# Vertex AI PayGo pricing for gemini-3.1-flash-lite, USD/1M tokens
# (recon-vertex.md §4e) -- an informational cost estimate for
# validation_summary, not a billing-accurate figure. Mirrors the constant in
# scripts/verify_cds_adapters.py.
_INPUT_PRICE_PER_1M = 0.25
_OUTPUT_PRICE_PER_1M = 1.50


def _zero_usage() -> cds_gemini.Usage:
    return cds_gemini.Usage(0, 0, 0, 0, 0)


def _add_usage(a: cds_gemini.Usage, b: cds_gemini.Usage) -> cds_gemini.Usage:
    return cds_gemini.Usage(
        prompt_tokens=a.prompt_tokens + b.prompt_tokens,
        output_tokens=a.output_tokens + b.output_tokens,
        thoughts_tokens=a.thoughts_tokens + b.thoughts_tokens,
        cached_tokens=a.cached_tokens + b.cached_tokens,
        total_tokens=a.total_tokens + b.total_tokens,
    )


def _usage_dict(usage: cds_gemini.Usage) -> dict[str, int]:
    return {
        "prompt_tokens": usage.prompt_tokens,
        "output_tokens": usage.output_tokens,
        "thoughts_tokens": usage.thoughts_tokens,
        "cached_tokens": usage.cached_tokens,
        "total_tokens": usage.total_tokens,
    }


def _estimate_cost_usd(usage: cds_gemini.Usage) -> float:
    return round(
        usage.prompt_tokens / 1_000_000 * _INPUT_PRICE_PER_1M
        # Thinking tokens bill as output, not for free -- omitting them here
        # would make any non-zero thinking budget look free in cost tracking.
        + (usage.output_tokens + usage.thoughts_tokens) / 1_000_000 * _OUTPUT_PRICE_PER_1M,
        6,
    )


__all__ = ["_add_usage", "_estimate_cost_usd", "_usage_dict", "_zero_usage"]
