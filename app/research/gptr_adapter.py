"""GPT-Researcher adapter (Phase 9 — deferred, behind deep_research_use_gptr flag)."""

from __future__ import annotations

from typing import Any


async def gather_via_gptr(query: str, source_config: Any, settings: Any) -> dict[str, Any]:
    """Placeholder — Phase 9 will implement this when deep_research_use_gptr is True."""
    raise NotImplementedError("GPTR integration is Phase 9 (not yet implemented)")
