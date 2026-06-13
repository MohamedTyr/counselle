"""Backward-compat re-export — usage accounting moved to ``app/usage.py`` at B2.

The turn registry (``app/turns.py``) owns usage enrichment and the
``turn_complete`` log; ``app/`` must never import ``api/`` (ADR 0017
layering), so the implementation lives in ``app/usage.py`` now. Existing
importers of ``api.usage`` keep working through this shim.
"""

from app.usage import (
    enrich_usage_event,
    estimate_cost,
    log_turn_complete,
)

__all__ = ["enrich_usage_event", "estimate_cost", "log_turn_complete"]
