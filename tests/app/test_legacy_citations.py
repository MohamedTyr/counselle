import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.legacy_citations import adapt_completed_sources
from app.sources import SourceRegistry
from app.transcript import extract_transcript


def test_v1_completed_source_is_opaque_evidenceless_and_bad_sibling_degrades() -> None:
    old = {
        "index": 1,
        "label": "IPEDS 2024",
        "citation": {
            "source": "ipeds",
            "tier": "official",
            "vintage": "IPEDS 2024",
            "caveat": "provisional",
            "raw_table": "adm2024",
        },
    }
    adapted = adapt_completed_sources([old, {"broken": True}])
    assert len(adapted) == 1
    assert adapted[0]["citation"]["source"] == "ipeds"
    assert adapted[0]["legacy"] is True
    assert adapted[0]["evidence"] == []


def test_checked_in_v1_turn_stays_displayable_but_cannot_seed_a_v2_registry() -> None:
    fixture = Path(__file__).parents[1] / "fixtures/protocol/legacy_v1_completed_turn.json"
    payload = json.loads(fixture.read_text())

    transcript = extract_transcript(payload["messages"], payload["turn_records"])
    assert transcript[-1]["text"] == "The legacy display was 7% [1]."
    assert transcript[-1]["sources"][0]["label"] == "IPEDS 2024 admissions"
    assert transcript[-1]["sources"][0]["legacy"] is True

    with pytest.raises(ValidationError):
        SourceRegistry(payload["turn_records"][0]["sources"])
