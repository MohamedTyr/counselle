"""Read-only adapter for already-persisted v1 source entries."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class LegacySourceEntry(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)
    index: int
    citation: dict[str, Any]
    label: str
    snippet: str | None = None


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
        except Exception:
            continue
        dumped = old.model_dump(mode="json")
        dumped["legacy"] = True
        dumped["evidence"] = []
        dumped["evidence_omitted_count"] = 0
        adapted.append(dumped)
    return adapted
