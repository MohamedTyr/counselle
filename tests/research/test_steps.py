from __future__ import annotations

from typing import Any

import pytest

from app.research.steps import research_step
from domain.events import StepDetail, StepSource


def test_research_step_maps_internal_statuses_to_protocol() -> None:
    chunks: list[dict[str, Any]] = []
    emissions: list[tuple[str, dict[str, Any]]] = []

    research_step(chunks.append, emissions, "planning", "running", "Planning research")
    research_step(chunks.append, emissions, "planning", "complete", "Planning research")

    start = chunks[0]["data"]
    end = chunks[1]["data"]

    assert start["step_id"] == "research_planning"
    assert end["step_id"] == "research_planning"
    assert start["kind"] == "research"
    assert end["kind"] == "research"
    assert start["status"] == "start"
    assert end["status"] == "end"
    assert emissions == [("step", start), ("step", end)]


def test_research_step_rejects_unknown_status() -> None:
    with pytest.raises(KeyError):
        research_step(lambda _: None, [], "planning", "bogus", "Planning research")  # type: ignore[arg-type]


def test_research_step_passes_kind_tier_detail_and_sources() -> None:
    chunks: list[dict[str, Any]] = []
    emissions: list[tuple[str, dict[str, Any]]] = []

    research_step(
        chunks.append,
        emissions,
        "official_search",
        "complete",
        "Checking official pages",
        detail=StepDetail(query="MIT testing policy", result_count=2, domains=["mit.edu"]),
        sources=[
            StepSource(
                label="mit.edu",
                favicon="https://www.google.com/s2/favicons?domain=mit.edu&sz=32",
                url="https://mit.edu/admissions",
            )
        ],
        kind="edu_search",
        tier="official",
    )

    data = chunks[0]["data"]
    assert data["kind"] == "edu_search"
    assert data["tier"] == "official"
    assert data["detail"] == {
        "query": "MIT testing policy",
        "domains": ["mit.edu"],
        "result_count": 2,
    }
    assert data["sources"] == [
        {
            "label": "mit.edu",
            "favicon": "https://www.google.com/s2/favicons?domain=mit.edu&sz=32",
            "url": "https://mit.edu/admissions",
        }
    ]
    assert emissions == [("step", data)]
