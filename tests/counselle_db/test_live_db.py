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


async def test_resolve_school_single_match_returns_live_facts_status(catalog: Catalog) -> None:
    """school-data-v3 Phase 3 (Unit B): a single-candidate match no longer
    calls the CDS-era coverage reader (``_live_document``/``_coverage``,
    permanently parked) -- it reads ``school_data_status`` live and returns
    a real ``SchoolFactsStatus``, for every school (the view's LEFT JOIN
    guarantees a row even with no CollegeData crawl at all)."""
    unitid = next(iter(catalog.snapshot.schools))
    result = await resolve_school(catalog, str(unitid))
    assert result.status == "match"
    assert result.school.unitid == unitid
    assert isinstance(result.data.has_collegedata, bool)
    assert isinstance(result.data.fact_count, int)
    assert isinstance(result.data.tabs, dict)
    assert result.profile_snapshot_date == catalog.snapshot.schools[unitid].profile_snapshot_date


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


async def test_majors_membership_query_carries_real_fact_coverage_denominator(
    catalog: Catalog,
) -> None:
    """Security review Finding 1: the majors-shaped rule (`majors @>
    ARRAY[...]` over `school_explore`) must attach a real `fact_coverage`
    row for `academics.undergraduate_majors` -- the fictional
    `explore.majors` key this used to bind cannot exist in the live schema
    (`fact_coverage` has zero `explore.*` rows and can never have any, since
    the table is built by `GROUP BY fact_key FROM school_facts`)."""
    result = await query_database(
        catalog,
        "SELECT school_id FROM cds_library.school_explore WHERE majors @> ARRAY[$1] LIMIT 1",
        ["Nursing"],
    )
    assert len(result.coverage) == 1
    coverage_row = result.coverage[0]
    assert coverage_row.fact_key == "academics.undergraduate_majors"
    assert coverage_row.schools_with_value > 0
    assert coverage_row.schools_total >= coverage_row.schools_with_value
    assert "exact program name" in result.warning


async def test_explore_shaped_bound_param_cannot_silence_denominator_note(
    catalog: Catalog,
) -> None:
    """Security review Finding 1: an `explore.<column>`-shaped bound
    parameter must never resolve as a real fact key -- it used to bypass
    `CatalogSnapshot.fact_keys` entirely via a structural regex, silencing
    the "denominator unavailable" caveat on a cross-school aggregate with no
    real coverage behind it."""
    result = await query_database(
        catalog,
        "SELECT count(*) FROM cds_library.school_facts_sql WHERE fact_key=$1",
        ["explore.admit_rate"],
    )
    assert result.coverage == ()
    assert "denominator unavailable" in result.warning


async def test_internal_json_columns_are_rejected_even_via_select_star(
    catalog: Catalog,
) -> None:
    """Security review Finding 2: `profile_provenance` (internal IPEDS
    extraction plumbing) and `school_data_status.tabs` must never be
    projectable, including through `SELECT *` -- verified against the live
    pool/role, not just the AST in isolation."""
    with pytest.raises(ServiceError, match="Internal profile/provenance"):
        await query_database(
            catalog, "SELECT profile_provenance FROM cds_library.school_profiles LIMIT 1"
        )
    with pytest.raises(ServiceError, match="Internal profile/provenance"):
        await query_database(catalog, "SELECT * FROM cds_library.school_data_status LIMIT 1")


async def test_reader_cannot_select_pipeline_base_table(catalog: Catalog) -> None:
    async with catalog.pool.acquire() as conn:
        allowed = await conn.fetchval(
            "SELECT has_table_privilege($1,$2,$3)",
            "cds_library_reader",
            "cds_library.schools",
            "SELECT",
        )
    assert allowed is False
