"""Read-only adapter for already-persisted v1 source entries."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class LegacyCitation(BaseModel):
    """The deliberately small persisted-v1 citation compatibility shape."""

    model_config = ConfigDict(extra="ignore", frozen=True)
    source: str
    tier: Literal["official", "community"]
    vintage: str
    url: str | None = None
    caveat: str | None = None
    raw_table: str | None = None


class LegacySourceEntry(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    index: int
    citation: LegacyCitation
    label: str


def adapt_completed_sources(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    adapted: list[dict[str, Any]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        citation = value.get("citation")
        if not isinstance(citation, dict):
            continue
        if citation.get("v") == 2:
            adapted.append(dict(value))
            continue
        try:
            old = LegacySourceEntry.model_validate(value)
        except Exception:  # nosec B112 - malformed legacy entries are intentionally skipped
            continue
        citation = {"v": 1, **old.citation.model_dump(mode="json", exclude_none=True)}
        adapted.append(
            {
                "v": 1,
                "legacy": True,
                "index": old.index,
                "citation": citation,
                "label": old.label,
                "evidence": [],
                "evidence_omitted_count": 0,
            }
        )
    return adapted
