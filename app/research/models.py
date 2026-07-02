"""Internal pydantic models for the research pipeline.

NOT stored in TurnState — convert to/from dicts at state boundaries using
``model.model_dump(mode="json")`` and ``Model.model_validate(dict)``.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from domain.envelope import SourceName, Tier


class EvidenceItem(BaseModel):
    """Normalized internal evidence handoff between research nodes.

    Stored in graph state only as ``model_dump(mode="json")`` dicts. The source
    registry remains the public citation owner; this shape gives verifier and
    synthesis code a stable, compact corpus instead of assorted tool payloads.
    """

    marker: str = Field(pattern=r"^\[\d+\]$")
    source: SourceName
    tier: Tier
    school: str | None = None
    topic: str | None = None
    title: str | None = None
    snippet: str | None = None
    url: str | None = None
    field_key: str | None = None
    display: str | None = None
    vintage: str
    retrieved_at: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)


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
    est_cost_usd: float | None = None
    soft_timeout_hit: bool = False
    db_unavailable: bool = False
    external_unavailable: bool = False
    verification_unavailable: str | None = None
