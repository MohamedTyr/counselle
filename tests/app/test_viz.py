"""Live-DB tests for the ``render_viz`` tool (Phase 4 Slice D; ADR 0014).

The core assertion is the provenance boundary: the RenderSpec lands in
``viz_emitted`` with per-cell citation envelopes, while the LLM-visible
return payload carries NO numeric values — no '$', no '%', no 4+-digit
numbers — only the ack text, the value count, and the citation markers.

Fixture replicates ``tests/counselle_db/conftest.py``: one read-only pool +
catalog per module on a module-scoped event loop (asyncpg pools cannot be
shared across loops).
"""

import json
import re
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

from app.sources import SourceRegistry
from app.viz import render_viz
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from domain.specs import RenderSpec

pytestmark = [pytest.mark.live_db, pytest.mark.asyncio(loop_scope="module")]

DUKE = 198419
HARVARD = 166027
NOT_A_UNITID = 1

ACCEPTANCE_RATE = "admissions.acceptance_rate"
TUITION_IN_STATE = "cost.tuition_in_state"

_FOUR_PLUS_DIGITS = re.compile(r"\d{4,}")


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def catalog() -> AsyncIterator[Catalog]:
    """A live read-only pool with the fields catalog loaded — one per module."""
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()


def _assert_no_numbers(payload: dict[str, Any]) -> None:
    """ADR 0014: numbers never transit the LLM — marker indices and the count only.

    ``ensure_ascii=False`` so escape artifacts (an em-dash becomes ``\\u2014``)
    don't masquerade as digits — the check is about the real text content.
    """
    wire = json.dumps(payload, ensure_ascii=False)
    assert "$" not in wire
    assert "%" not in wire
    assert not _FOUR_PLUS_DIGITS.search(wire)


# --- comparison_table ---------------------------------------------------------


async def test_comparison_table_emits_spec_with_envelope_cells(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        unitids=[DUKE, HARVARD],
        field_keys=[ACCEPTANCE_RATE, TUITION_IN_STATE],
    )
    assert payload["ok"] is True
    assert len(viz_emitted) == 1
    spec = RenderSpec.model_validate(viz_emitted[0])  # a valid RenderSpec dict
    assert spec.type == "comparison_table"
    assert [school.unitid for school in spec.schools] == [DUKE, HARVARD]
    assert len(spec.rows) == 2  # one row per field
    for row in spec.rows:
        assert len(row.cells) == 2  # one cell per school
        for cell in row.cells:  # per-cell envelopes, fully cited
            assert cell.citation.tier == "official"
            assert cell.citation.vintage


async def test_comparison_table_schools_carry_website_domain(catalog: Catalog) -> None:
    """Each school resolves its registrable website host live (for the client logo)."""
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        unitids=[DUKE, HARVARD],
        field_keys=[ACCEPTANCE_RATE, TUITION_IN_STATE],
    )
    assert payload["ok"] is True
    spec = RenderSpec.model_validate(viz_emitted[0])
    domains = {school.unitid: school.domain for school in spec.schools}
    assert domains[DUKE] == "duke.edu"
    assert domains[HARVARD] == "harvard.edu"


async def test_comparison_table_payload_carries_no_numbers(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        unitids=[DUKE, HARVARD],
        field_keys=[ACCEPTANCE_RATE, TUITION_IN_STATE],
    )
    assert payload["ok"] is True
    assert payload["viz"].startswith("comparison_table rendered with ")
    assert payload["sources"]
    _assert_no_numbers(payload)
    # ... while the emitted spec DOES carry the real display values.
    spec_wire = json.dumps(viz_emitted[0])
    assert "%" in spec_wire or "$" in spec_wire


# --- score_band ----------------------------------------------------------------


async def test_score_band_sat_renders_two_section_rows(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog, registry, viz_emitted, type="score_band", unitids=[DUKE], test="sat"
    )
    assert payload["ok"] is True
    spec = RenderSpec.model_validate(viz_emitted[0])  # validator passes — no composite
    assert spec.band is not None and spec.band.test == "sat"
    assert len(spec.rows) == 2  # TWO section rows, never one combined row
    labels = [row.label for row in spec.rows]
    assert any("EBRW" in label for label in labels)
    assert any("Math" in label for label in labels)
    for row in spec.rows:  # each row stays within ONE section (the honesty trap)
        fields = [cell.field for cell in row.cells]
        assert not (
            any("sat_ebrw" in field for field in fields)
            and any("sat_math" in field for field in fields)
        )
    _assert_no_numbers(payload)


async def test_score_band_rejects_caller_supplied_field_keys(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="score_band",
        unitids=[DUKE],
        field_keys=["admissions.sat_average"],  # the LLM may NOT pick band fields
        test="sat",
    )
    assert payload["ok"] is False
    assert "field_keys" in payload["error"]
    assert viz_emitted == []
    assert len(registry) == 0  # nothing registered on error
    _assert_no_numbers(payload)


# --- stat_block ------------------------------------------------------------------


async def test_stat_block_sources_markers_match_registry_entries(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="stat_block",
        unitids=[DUKE],
        field_keys=[ACCEPTANCE_RATE, TUITION_IN_STATE],
    )
    assert payload["ok"] is True
    assert len(viz_emitted) == 1
    assert RenderSpec.model_validate(viz_emitted[0]).type == "stat_block"
    assert payload["sources"]
    registered_indices = {entry.index for entry in registry.entries}
    for marker in payload["sources"]:  # every "[n]" resolves to a registry entry
        assert int(marker.strip("[]")) in registered_indices
    assert len(registry) == len(registered_indices)  # indices are unique
    _assert_no_numbers(payload)


# --- errors ------------------------------------------------------------------------


async def test_unknown_unitid_returns_error_without_numbers(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="stat_block",
        unitids=[NOT_A_UNITID],
        field_keys=[ACCEPTANCE_RATE],
    )
    assert payload["ok"] is False
    assert "not in our database" in payload["error"]
    assert viz_emitted == []
    assert "$" not in json.dumps(payload) and "%" not in json.dumps(payload)
