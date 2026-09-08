"""Live-DB tests for the ``render_viz`` tool (ADR 0014).

school-data-v3 Phase 0: the CDS manifest/domain catalog ``render_viz`` used to
validate metric refs against (the old manifest-era ``catalog.snapshot`` metric
map) is gone. ``CatalogSnapshot.fact_keys`` is populated as of Phase 3, Unit
B (from ``cds_library.fact_coverage``, filtered to non-``explore.*`` rows
with ``schools_with_value > 0``) — ``ACCEPTANCE_RATE`` below is a CDS-era
manifest ref, not a real v3 fact key, so it still honestly rejects as an
unknown ref (``app/viz.py:128,352``), just no longer because the whole store
is empty. The comparison/stat-block cases that exercise a real, mapped fact
key are a later unit's (owns ``app/viz.py``).

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
from domain.specs import ColumnInput, MetricCellInput, VizRowInput

pytestmark = [pytest.mark.live_db, pytest.mark.asyncio(loop_scope="module")]

DUKE = 198419
NOT_A_UNITID = 1

ACCEPTANCE_RATE = "admissions.acceptance_rate"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def catalog() -> AsyncIterator[Catalog]:
    """A live read-only pool with the fields catalog loaded — one per module."""
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()


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
                label="Acceptance rate", cells=(MetricCellInput(fact_key=ACCEPTANCE_RATE),)
            )
        ],
    )
    assert payload["ok"] is False
    assert "not in our database" in payload["rejected_cells"][0]["reason"]
    assert viz_emitted == []


async def test_metric_cell_rejects_a_ref_not_in_fact_keys(catalog: Catalog) -> None:
    """``fact_keys`` is populated (school-data-v3 Phase 3) but a CDS-era
    manifest ref like ``ACCEPTANCE_RATE`` is not a real v3 fact key, so the
    cell still honestly rejects as unknown."""
    assert catalog.snapshot.fact_keys
    assert ACCEPTANCE_RATE not in catalog.snapshot.fact_keys
    registry = SourceRegistry()
    viz_emitted: list[dict[str, Any]] = []
    payload = await render_viz(
        catalog,
        registry,
        viz_emitted,
        type="stat_block",
        columns=[ColumnInput(unitid=DUKE)],
        rows=[
            VizRowInput(
                label="Acceptance rate", cells=(MetricCellInput(fact_key=ACCEPTANCE_RATE),)
            )
        ],
    )
    assert payload["ok"] is False
    assert payload["rejected_cells"]
    assert viz_emitted == []
