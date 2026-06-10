"""The citation envelope — the one shape every value travels in (ADR 0006, ARCHITECTURE §9).

Every tool result, every web/Reddit finding, every visualization cell is a
``CitationEnvelope``: already decoded, scaled, formatted, and stamped with
source + tier + vintage. The agent's prose uses ``display``; visualizations
use ``raw``; the student always sees where a number came from.
"""

from typing import Literal

from pydantic import BaseModel

SourceName = Literal["ipeds", "scorecard", "cds", "web", "edu", "reddit"]
Tier = Literal["official", "community"]

Unit = Literal["percent", "currency", "count", "number", "bool", "text", "date"]


class Citation(BaseModel):
    """Where a value came from, how official it is, and how old it is."""

    source: SourceName
    tier: Tier
    vintage: str  # human string, e.g. "IPEDS 2024-25 (provisional)"
    caveat: str | None = None
    raw_table: str | None = None
    url: str | None = None  # for web/edu/reddit sources


class CitationEnvelope(BaseModel):
    """A single cited value, display-ready — the agent never re-formats it."""

    v: int = 1
    field: str  # field key or pseudo-key (e.g. "web.search_result")
    label: str
    display: str  # ALWAYS set; "not available" when available=False
    raw: float | int | bool | str | None = None
    available: bool
    unit: Unit | None = None
    citation: Citation
