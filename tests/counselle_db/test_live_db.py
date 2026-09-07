from __future__ import annotations

import pytest

from counselle_db.catalog import Catalog
from counselle_db.models import ServiceError
from counselle_db.service import get_school_profile, query_database, resolve_school

pytestmark = pytest.mark.live_db


async def test_catalog_snapshot_matches_the_six_view_contract(catalog: Catalog) -> None:
    assert catalog.snapshot.schools
    assert catalog.snapshot.profile_groups
    unitid = next(iter(catalog.snapshot.schools))
    profile = await get_school_profile(catalog, unitid, [catalog.snapshot.profile_groups[0]])
    assert profile.groups


async def test_resolve_school_single_match_is_parked_pending_phase_3_coverage(
    catalog: Catalog,
) -> None:
    """A single-candidate match still calls the CDS-era coverage reader
    (``_live_document``/``_coverage``), stubbed to raise under school-data-v3
    Phase 0 until Phase 3 replaces it with ``SchoolFactsStatus``."""
    unitid = next(iter(catalog.snapshot.schools))
    with pytest.raises(ServiceError, match="parked"):
        await resolve_school(catalog, str(unitid))


async def test_parameterized_query_and_binary_rejection(catalog: Catalog) -> None:
    unitid = next(iter(catalog.snapshot.schools))
    result = await query_database(
        catalog,
        "SELECT id,name FROM cds_library.school_profiles WHERE id=$1",
        [unitid],
    )
    assert result.row_count == 1
    with pytest.raises(ServiceError, match="Binary/PDF"):
        await query_database(
            catalog,
            "SELECT profile_sha256 FROM cds_library.school_profiles LIMIT 1",
        )


async def test_reader_cannot_select_pipeline_base_table(catalog: Catalog) -> None:
    async with catalog.pool.acquire() as conn:
        allowed = await conn.fetchval(
            "SELECT has_table_privilege($1,$2,$3)",
            "cds_library_reader",
            "cds_library.schools",
            "SELECT",
        )
    assert allowed is False
