from __future__ import annotations

import pytest

from counselle_db.catalog import Catalog
from counselle_db.models import ServiceError
from counselle_db.service import get_domain, get_school_profile, query_database, resolve_school

pytestmark = pytest.mark.live_db


async def test_current_five_view_contract(catalog: Catalog) -> None:
    assert catalog.snapshot.current_version in catalog.snapshot.manifests
    assert catalog.snapshot.current_contract == "8"
    unitid = next(iter(catalog.snapshot.schools))
    assert (await resolve_school(catalog, str(unitid))).status == "match"
    profile = await get_school_profile(catalog, unitid, [catalog.snapshot.profile_groups[0]])
    assert profile.groups
    covered = next(
        (key for key, value in catalog.snapshot.coverage.items() if value["domains"]), None
    )
    if covered is not None:
        domain = catalog.snapshot.coverage[covered]["domains"][0]
        result = await get_domain(catalog, covered, domain)
        assert result.availability.configured == catalog.snapshot.domain_counts[domain]


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
            "SELECT pdf_content FROM cds_library.cds_document_sources LIMIT 1",
        )


async def test_manifest_metric_membership_is_structural_not_description_substring(
    catalog: Catalog,
) -> None:
    ref, metric = next(iter(catalog.snapshot.metrics.items()))
    sql = """SELECT jsonb_path_exists(
               m.content,
               '$.domains[*].metrics[*] ? (@.id == $ref)',
               jsonb_build_object('ref', to_jsonb($1::text))
             ) AS metric_ref_present
             FROM cds_library.cds_manifest_snapshots m
             WHERE m.is_current"""
    present = await query_database(catalog, sql, [ref])
    description_only = await query_database(catalog, sql, [metric.description])
    assert present.rows == ((True,),)
    assert description_only.rows == ((False,),)


async def test_reader_cannot_select_pipeline_base_table(catalog: Catalog) -> None:
    async with catalog.pool.acquire() as conn:
        allowed = await conn.fetchval(
            "SELECT has_table_privilege($1,$2,$3)",
            "cds_library_reader",
            "cds_library.schools",
            "SELECT",
        )
    assert allowed is False
