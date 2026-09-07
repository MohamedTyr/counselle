"""Live-DB tests for the ``render_viz`` tool (ADR 0014).

school-data-v3 Phase 0: the CDS manifest/domain catalog ``render_viz`` used to
validate metric refs against (the old manifest-era ``catalog.snapshot`` metric
map) is gone —
``CatalogSnapshot.fact_keys`` is empty until Phase 3 fills it from the facts
store, so every metric cell honestly rejects as an unknown ref until then
(``app/viz.py:128,352``). The comparison/stat-block cases that exercised real
metric data are deferred to Phase 3, when ``fact_keys`` is populated.

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
                label="Acceptance rate", cells=(MetricCellInput(metric_ref=ACCEPTANCE_RATE),)
            )
        ],
    )
    assert payload["ok"] is False
    assert "not in our database" in payload["rejected_cells"][0]["reason"]
    assert viz_emitted == []


async def test_every_metric_cell_rejects_while_fact_keys_is_empty(catalog: Catalog) -> None:
    """The facts store has no rows yet (school-data-v3 Phase 0-2) — a metric
    ref can never resolve against an empty ``fact_keys``, and the agent stays
    web-only until Phase 3 mounts the in-process DB tools over real data."""
    assert catalog.snapshot.fact_keys == {}
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
                label="Acceptance rate", cells=(MetricCellInput(metric_ref=ACCEPTANCE_RATE),)
            )
        ],
    )
    assert payload["ok"] is False
    assert payload["rejected_cells"]
    assert viz_emitted == []
