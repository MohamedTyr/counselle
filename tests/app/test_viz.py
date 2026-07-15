"""Live-DB tests for the ``render_viz`` tool (ADR 0014).

The core assertion is the provenance boundary: the RenderSpec lands in
``viz_emitted`` with per-cell citation envelopes, while the LLM-visible return
payload carries compact display values with matching citation markers.

Fixture replicates ``tests/counselle_db/conftest.py``: one read-only pool +
catalog per module on a module-scoped event loop (asyncpg pools cannot be
shared across loops).
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

from app.sources import SourceRegistry
from app.viz import render_viz
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from counselle_db.service import get_domain
from domain.specs import ColumnInput, MetricCellInput, RenderSpec, VizRowInput

pytestmark = [pytest.mark.live_db, pytest.mark.asyncio(loop_scope="module")]

DUKE = 198419
HARVARD = 166027
NOT_A_UNITID = 1

ACCEPTANCE_RATE = "admissions.acceptance_rate"
TUITION_IN_STATE = "cost.tuition_in_state"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def catalog() -> AsyncIterator[Catalog]:
    """A live read-only pool with the fields catalog loaded — one per module."""
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()


def _input(unitids: list[int], metric_ref: str) -> tuple[list[ColumnInput], list[VizRowInput]]:
    return (
        [ColumnInput(unitid=unitid) for unitid in unitids],
        [
            VizRowInput(
                label=metric_ref,
                cells=tuple(MetricCellInput(metric_ref=metric_ref) for _ in unitids),
            )
        ],
    )


async def _available_comparison(catalog: Catalog) -> tuple[list[int], str]:
    seen: dict[str, list[int]] = {}
    for unitid, coverage in catalog.snapshot.coverage.items():
        for domain_id in coverage["domains"]:
            result = await get_domain(catalog, unitid, domain_id)
            for row in result.rows:
                if not row.available:
                    continue
                schools = seen.setdefault(row.ref, [])
                schools.append(unitid)
                if len(schools) == 2:
                    return schools, row.ref
    pytest.fail("live catalog has no metric available for two schools")


# --- comparison_table ---------------------------------------------------------


async def test_comparison_table_emits_spec_with_envelope_cells(catalog: Catalog) -> None:
    unitids, metric_ref = await _available_comparison(catalog)
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    columns, rows = _input(unitids, metric_ref)
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        columns=columns,
        rows=rows,
    )
    assert payload["ok"] is True
    assert len(viz_emitted) == 1
    spec = RenderSpec.model_validate(viz_emitted[0])  # a valid RenderSpec dict
    assert spec.type == "comparison_table"
    assert [school.unitid for school in spec.columns] == unitids
    assert len(spec.rows) == 1
    for row in spec.rows:
        assert len(row.cells) == 2  # one cell per school
        for cell in row.cells:  # per-cell envelopes, fully cited
            assert cell.citation is not None
            assert cell.citation.tier == "official"
            assert cell.citation.vintage


async def test_comparison_table_schools_carry_website_domain(catalog: Catalog) -> None:
    """Each school resolves its registrable website host live (for the client logo)."""
    unitids, metric_ref = await _available_comparison(catalog)
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    columns, rows = _input(unitids, metric_ref)
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        columns=columns,
        rows=rows,
    )
    assert payload["ok"] is True
    spec = RenderSpec.model_validate(viz_emitted[0])
    domains = {school.unitid: school.domain for school in spec.columns}
    assert domains == {
        unitid: catalog.snapshot.schools[unitid].basics.official_domain for unitid in unitids
    }


async def test_comparison_table_payload_carries_cited_display_values(
    catalog: Catalog,
) -> None:
    unitids, metric_ref = await _available_comparison(catalog)
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    columns, rows = _input(unitids, metric_ref)
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="comparison_table",
        columns=columns,
        rows=rows,
    )
    assert payload["ok"] is True
    assert payload["status"] == "rendered"
    assert "result_for_agent" not in payload
    assert payload["sources"]
    cells = [cell for row in viz_emitted[0]["rows"] for cell in row["cells"]]
    assert cells
    assert all(cell["display"] for cell in cells)
    assert all(cell["marker"] in payload["sources"] for cell in cells)
    assert all(cell["display"] for cell in cells)


# --- stat_block ------------------------------------------------------------------


async def test_stat_block_sources_markers_match_registry_entries(catalog: Catalog) -> None:
    unitids, metric_ref = await _available_comparison(catalog)
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    columns, rows = _input(unitids[:1], metric_ref)
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="stat_block",
        columns=columns,
        rows=rows,
    )
    assert payload["ok"] is True
    assert len(viz_emitted) == 1
    assert RenderSpec.model_validate(viz_emitted[0]).type == "stat_block"
    assert payload["sources"]
    registered_indices = {entry.index for entry in registry.entries}
    for marker in payload["sources"]:  # every "[n]" resolves to a registry entry
        assert int(marker.strip("[]")) in registered_indices
    assert len(registry) == len(registered_indices)  # indices are unique
    cells = [cell for row in viz_emitted[0]["rows"] for cell in row["cells"]]
    assert all(cell["marker"] in payload["sources"] for cell in cells)


# --- errors ------------------------------------------------------------------------


async def test_unknown_unitid_returns_error_without_numbers(catalog: Catalog) -> None:
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="stat_block",
        columns=[ColumnInput(unitid=NOT_A_UNITID)],
        rows=[
            VizRowInput(
                label="Acceptance rate", cells=(MetricCellInput(metric_ref=ACCEPTANCE_RATE),)
            )
        ],
    )
    assert payload["ok"] is False
    assert "not in our database" in payload["rejected_cells"][0]["reason"]
    assert viz_emitted == []
    unitids, metric_ref = await _available_comparison(catalog)
