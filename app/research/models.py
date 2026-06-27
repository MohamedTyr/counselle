"""Internal pydantic models for the research pipeline.

NOT stored in TurnState — convert to/from dicts at state boundaries using
``model.model_dump(mode="json")`` and ``Model.model_validate(dict)``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class VerifiedClaim(BaseModel):
    """One fact cross-checked against the evidence corpus."""

    claim: str
    status: Literal["verified", "conflict", "unsupported", "sentiment_only"]
    support_markers: list[str]
    note: str | None = None


class ResearchCaps(BaseModel):
    """Runtime budget tracking for one deep-research turn."""

    started_at: str  # ISO datetime
    tavily_searches_used: int = 0
    tavily_extracts_used: int = 0
    est_cost_usd: float = 0.0
    soft_timeout_hit: bool = False
    db_unavailable: bool = False
    external_unavailable: bool = False
