from __future__ import annotations

from typing import Any

import pytest

from app.research.steps import research_step


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
