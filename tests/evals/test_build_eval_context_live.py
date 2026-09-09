"""Live-DB proof that the school-data-v3 eval fixture builder actually works
against the real facts store (Phase 3 harness unblock).

``build_eval_context`` only reads ``runtime.deps.catalog``/``.settings``, so
this test builds those two directly against the live RO pool rather than
standing up the full ``Runtime`` (checkpointer, app pool, pipeline pool) --
none of that machinery is read by the function under test.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from evals.runner import EvalContext, build_eval_context

pytestmark = pytest.mark.live_db

# Independently confirmed live against the school-data-v3 DB (a manual
# docker query, and the plan's own case list): Yale, Felician University, and the
# University of Alabama System Office (has_collegedata=false).
_YALE = 130794
_FELICIAN = 184612
_ALABAMA_SYSTEM_OFFICE = 100733


async def test_build_eval_context_resolves_real_schools_from_the_live_facts_store() -> None:
    settings = get_settings()
    pool = await create_pool(settings=settings)
    try:
        catalog = await Catalog.load(pool, settings=settings)
        for unitid in (_YALE, _FELICIAN, _ALABAMA_SYSTEM_OFFICE):
            assert unitid in catalog.snapshot.schools

        runtime = SimpleNamespace(deps=SimpleNamespace(catalog=catalog, settings=settings))
        context = await build_eval_context(runtime)  # type: ignore[arg-type]

        assert isinstance(context, EvalContext)
        assert context.total == len(catalog.snapshot.schools)
        assert context.covered == catalog.snapshot.schools_with_facts
        assert context.common_metric_ref in catalog.snapshot.fact_keys
        assert context.aid_metric_ref in catalog.snapshot.fact_keys
        assert context.selectivity_applicants_ref in catalog.snapshot.fact_keys
        assert context.selectivity_admitted_ref in catalog.snapshot.fact_keys
        for school in (context.common_a, context.common_b, context.comparison_peer):
            assert school.unitid in catalog.snapshot.schools
        assert context.profile_only.unitid in catalog.snapshot.schools
        assert context.stale_partial.unitid in catalog.snapshot.schools
        assert len(context.stat_metric_refs) == 4
        assert len(set(context.stat_metric_refs)) == 4

        # A manual live query (docker exec counselle-db-v3) found zero
        # `not_found` page statuses and zero facts older than
        # `facts_stale_days` -- both v3 cases gated on these flags must
        # therefore report themselves as not exercisable right now, never as
        # silently passed.
        assert context.not_published_available is False
        assert context.stale_facts_available is False
    finally:
        await pool.close()
