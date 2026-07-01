"""DB evidence gathering regressions for deep research."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.research.gather_db import (
    _evidence_items_from_envelopes,
    _fetch_school_data,
    research_gather_db_node,
)
from counselle_db.models import ResolveMatch, SchoolBasics
from domain.envelope import Citation, CitationEnvelope


@pytest.mark.asyncio
async def test_fetch_school_data_reads_dossier_section_values() -> None:
    evidence = CitationEnvelope(
        field="admissions.sat_math_25",
        label="SAT Math 25th percentile",
        display="790",
        raw=790,
        available=True,
        unit="number",
        citation=Citation(
            source="cds",
            tier="official",
            vintage="CDS 2024-25",
            raw_table="cds_freshman_profile",
        ),
    )
    deps = SimpleNamespace(catalog=MagicMock())
    match = ResolveMatch(
        school=SchoolBasics(unitid=166683, name="Massachusetts Institute of Technology"),
        coverage_tier="base",
        tier_explanation="base coverage",
    )
    dossier = SimpleNamespace(
        sections=[
            SimpleNamespace(values=[evidence]),
            SimpleNamespace(values=[]),
        ]
    )

    with (
        patch("counselle_db.service.resolve_school", new_callable=AsyncMock) as resolve_school,
        patch("app.research.gather_db.get_dossier", new_callable=AsyncMock) as get_dossier,
    ):
        resolve_school.return_value = match
        get_dossier.return_value = dossier

        result = await _fetch_school_data("MIT", deps)

    assert result == [evidence.model_dump(mode="json")]
    get_dossier.assert_awaited_once_with(deps.catalog, 166683)


def test_db_evidence_items_are_normalized_plain_dicts() -> None:
    items = _evidence_items_from_envelopes(
        [
            {
                "marker": "[1]",
                "field": "admissions.sat_math_25",
                "label": "SAT Math 25th percentile",
                "display": "790",
                "available": True,
                "raw": 790,
                "unit": "number",
                "citation": {
                    "source": "cds",
                    "tier": "official",
                    "vintage": "CDS 2024-25",
                    "raw_table": "cds_freshman_profile",
                },
            }
        ],
        "Massachusetts Institute of Technology",
    )

    assert items == [
        {
            "marker": "[1]",
            "source": "cds",
            "tier": "official",
            "school": "Massachusetts Institute of Technology",
            "topic": "testing",
            "title": "SAT Math 25th percentile",
            "snippet": "790",
            "url": None,
            "field_key": "admissions.sat_math_25",
            "display": "790",
            "vintage": "CDS 2024-25",
            "retrieved_at": None,
            "provenance": {
                "kind": "db_envelope",
                "citation": {
                    "source": "cds",
                    "tier": "official",
                    "vintage": "CDS 2024-25",
                    "raw_table": "cds_freshman_profile",
                },
                "available": True,
                "raw": 790,
                "unit": "number",
                "raw_table": "cds_freshman_profile",
                "caveat": None,
            },
        }
    ]


@pytest.mark.asyncio
async def test_gather_db_node_registers_real_pydantic_envelopes() -> None:
    envelope = CitationEnvelope(
        field="admissions.sat_math_25",
        label="SAT Math 25th percentile",
        display="790",
        raw=790,
        available=True,
        unit="number",
        citation=Citation(
            source="cds",
            tier="official",
            vintage="CDS 2024-25",
            raw_table="cds_freshman_profile",
        ),
    )
    deps = SimpleNamespace(catalog=MagicMock())
    match = ResolveMatch(
        school=SchoolBasics(unitid=166683, name="Massachusetts Institute of Technology"),
        coverage_tier="base",
        tier_explanation="base coverage",
    )
    dossier = SimpleNamespace(sections=[SimpleNamespace(values=[envelope])])
    state = {
        "source_registry": [],
        "research": {
            "plan": {"schools": ["MIT"]},
            "emissions": [],
            "caps": {},
        },
    }

    with (
        patch("app.research.gather_db.get_stream_writer", return_value=lambda _chunk: None),
        patch("counselle_db.service.resolve_school", new_callable=AsyncMock) as resolve_school,
        patch("app.research.gather_db.get_dossier", new_callable=AsyncMock) as get_dossier,
    ):
        resolve_school.return_value = match
        get_dossier.return_value = dossier

        result = await research_gather_db_node(state, deps)

    evidence = result["research"]["db_evidence"]
    assert evidence
    assert evidence[0]["marker"] == "[1]"
    assert evidence[0]["source"] == "cds"
    assert result["source_registry"][0]["citation"]["source"] == "cds"
