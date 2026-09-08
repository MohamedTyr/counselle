"""The four-tool CDS Library service API.

`query_database`'s SQL guard (`_guard_sql`, its ~20 AST-walking helpers, and
`query_database` itself) lives in `counselle_db/sql_guard.py` -- split out
to keep this file under the house 800-line limit (CLAUDE.md); re-exported
here so every existing caller (`counselle_db/server.py`'s MCP tool, tests)
keeps importing it from `counselle_db.service` unchanged.
"""

from __future__ import annotations

import math
from typing import Any

import asyncpg

from counselle_db.catalog import Catalog
from counselle_db.formatting import format_decimal
from counselle_db.models import (
    DomainResult,
    FactsQueryResult,
    FactValueRow,
    ProfileGroup,
    ProfileGroupResult,
    ProfileLeaf,
    ProfileProvenanceReceipt,
    ResolveCandidates,
    ResolvedSchool,
    ResolveNotFound,
    ResolveResult,
    SchoolCoverage,
    SchoolFactsStatus,
    ServiceError,
)
from counselle_db.sql_guard import query_database

__all__ = [
    "ServiceError",
    "explore",
    "get_domain",
    "get_facts",
    "get_school_profile",
    "majors",
    "query_database",
    "resolve_school",
    "search_school_names",
]

_SELECTED_DOCUMENT_SQL = """SELECT d.*,p.manifest_version AS target_manifest_version
 FROM cds_library.active_cds_documents d
 LEFT JOIN cds_library.active_cds_domain_packets p
 ON p.school_id=d.school_id AND p.document_id=d.document_id AND p.domain_id=$2
 WHERE d.school_id=$1 ORDER BY d.academic_year DESC,d.document_id DESC LIMIT 1"""
_DOMAIN_ROWS_SQL = """SELECT p.*,d.currentness,d.staleness_reason
 FROM cds_library.active_cds_domain_packets p
 JOIN cds_library.active_cds_documents d ON d.school_id=p.school_id AND d.document_id=p.document_id
 WHERE p.school_id=$1 AND p.document_id=$2 AND p.domain_id=ANY($3::text[])"""
_PROFILE_SQL = """SELECT id,name,city,state,official_domain,basic_profile,profile_provenance,
 profile_version,profile_snapshot_date,profile_sha256
 FROM cds_library.school_profiles WHERE id=$1"""

# school-data-v3 Phase 2 -- the one reader touching `current_school_facts`
# (plan §5.2/§6a). `school_data_status` is read live, in the same read-only
# transaction, never from the Catalog snapshot copy (whose refresh cadence
# would let a page print "never checked" above rows the same response
# renders in state `value` -- plan §5.2).
_SCHOOL_DATA_STATUS_ONE_SQL = """SELECT school_id,has_collegedata,facts_updated_at,fact_count,tabs
 FROM cds_library.school_data_status WHERE school_id=$1"""
_CURRENT_SCHOOL_FACTS_SQL = """SELECT fact_key,tab,section,label,value,display,unit,value_type,
 value_num,value_text,value_bool,value_date,reported_period,reported_period_year,observed_at
 FROM cds_library.current_school_facts WHERE school_id=$1"""
_CURRENT_SCHOOL_FACTS_KEYS_SQL = _CURRENT_SCHOOL_FACTS_SQL + " AND fact_key=ANY($2::text[])"
_MAJORS_SQL = """SELECT m,count(*) AS n FROM cds_library.school_explore, unnest(majors) m
 WHERE m ILIKE $1 || '%' GROUP BY m ORDER BY 2 DESC LIMIT 50"""


def _coverage(
    document: asyncpg.Record | None, rows: list[asyncpg.Record], catalog: Catalog
) -> SchoolCoverage:
    # Parked (school-data-v3 Phase 0): cds_library's manifest/packet tables
    # are dropped, so there is no CDS document coverage to compute. This tool
    # is never reached live (mounted only when settings.cds_data_enabled,
    # which the v3 hatch keeps false) — fully removed in Phase 3, when
    # resolve_school's coverage shape becomes SchoolFactsStatus.
    raise ServiceError("CDS coverage is parked under school-data-v3; no CDS documents exist.")


async def _live_document(
    catalog: Catalog, unitid: int
) -> tuple[asyncpg.Record | None, list[asyncpg.Record]]:
    # Parked (school-data-v3 Phase 0): see _coverage above.
    raise ServiceError("CDS coverage is parked under school-data-v3; no CDS documents exist.")


async def resolve_school(catalog: Catalog, query: str) -> ResolveResult:
    query = query.strip()
    if not query or len(query) > 200:
        raise ServiceError("School query must be 1-200 characters.")
    candidates = catalog.resolve_candidates(query)
    if not candidates:
        return ResolveNotFound(
            message=(
                "That school is not in our database of "
                f"{len(catalog.snapshot.schools):,} institutions."
            )
        )
    if len(candidates) > 1 and not query.isdigit():
        return ResolveCandidates(
            candidates=tuple(item.basics for item in candidates),
            hint="Multiple campuses matched; ask which campus the student means.",
        )
    school = candidates[0]
    document, rows = await _live_document(catalog, school.basics.unitid)
    return ResolvedSchool(school=school.basics, coverage=_coverage(document, rows, catalog))


async def search_school_names(catalog: Catalog, query: str, limit: int = 10) -> list[Any]:
    return [record.basics for record in catalog.resolve_candidates(query)[:limit]]


def _display_profile(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(float(value)):
            return None
        return format_decimal(value)
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        if not value:
            return None
        displays = [_display_profile(item) for item in value]
        if any(item is None for item in displays):
            return None
        display = ", ".join(item for item in displays if item is not None)
        return display or None
    return None


def _receipt_at(provenance: Any, path: tuple[str, ...]) -> ProfileProvenanceReceipt | None:
    current = provenance
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return ProfileProvenanceReceipt.model_validate(current) if isinstance(current, dict) else None


def _walk_profile(
    group: str, value: Any, provenance: Any, path: tuple[str, ...] = ()
) -> list[ProfileLeaf]:
    if isinstance(value, dict):
        return [
            leaf
            for key, child in value.items()
            for leaf in _walk_profile(group, child, provenance, (*path, key))
        ]
    display = _display_profile(value)
    receipt = _receipt_at(provenance, (group, *path))
    source_column = receipt.source_column if receipt else None
    label = source_column or path[-1].replace("_", " ").capitalize()
    return [
        ProfileLeaf(
            ref=".".join((group, *path)),
            label=label,
            display=display,
            available=display is not None,
            value=value if display is not None else None,
            provenance=receipt,
        )
    ]


async def get_school_profile(
    catalog: Catalog, unitid: int, groups: list[str] | None = None
) -> ProfileGroupResult:
    async with catalog.pool.acquire() as conn:
        row = await conn.fetchrow(_PROFILE_SQL, unitid)
    if row is None:
        raise ServiceError("School is not in the profile catalog.")
    profile = row["basic_profile"]
    valid = tuple(key for key, value in profile.items() if isinstance(value, dict))
    selected = tuple(groups) if groups is not None else valid
    unknown = [group for group in selected if group not in valid]
    if unknown:
        raise ServiceError(f"Unknown profile group. Valid groups: {', '.join(valid)}")
    record = catalog.snapshot.schools[unitid]
    result_groups = tuple(
        ProfileGroup(
            id=group, rows=tuple(_walk_profile(group, profile[group], row["profile_provenance"]))
        )
        for group in selected
    )
    return ProfileGroupResult(
        school=record.basics,
        profile_version=row["profile_version"],
        profile_snapshot_date=row["profile_snapshot_date"],
        profile_sha256=bytes(row["profile_sha256"]).hex(),
        groups=result_groups,
        valid_groups=valid,
    )


async def get_domain(catalog: Catalog, unitid: int, domain_id: str) -> DomainResult:
    # Parked (school-data-v3 Phase 0): cds_library's manifest/packet tables and
    # Catalog.domain() are both gone — there is no CDS domain data to read.
    # This tool is never reached live (mounted only when
    # settings.cds_data_enabled, which the v3 hatch keeps false); fully
    # removed in Phase 3 along with the packet/manifest guard machinery.
    raise ServiceError("get_domain is parked under school-data-v3; no CDS domains exist.")


async def get_facts(
    catalog: Catalog, unitid: int, keys: list[str] | None = None
) -> FactsQueryResult:
    """The one reader touching `current_school_facts` (plan §5.2/§6a).

    `keys=None` returns every current fact row for the school -- the HTTP
    facts page's shape (`app/facts/service.py` needs the whole school to
    resolve every declared key's state, including keys with no row at all).
    A narrower `keys=[...]` call is the seam Phase 3's agent tool narrows
    through; this unit does not add capping/`truncated` on top of it, since
    the full-page read has no such budget (plan §5.2's ≤150 KB payload
    budget is a property of the data, not an artificial cap).
    """
    if not catalog.snapshot.schools.get(unitid):
        raise ServiceError("That school is not in our database.")
    async with catalog.pool.acquire() as conn, conn.transaction(readonly=True):
        status_row = await conn.fetchrow(_SCHOOL_DATA_STATUS_ONE_SQL, unitid)
        if status_row is None:
            raise ServiceError("That school is not in our database.")
        fact_rows = await (
            conn.fetch(_CURRENT_SCHOOL_FACTS_KEYS_SQL, unitid, keys)
            if keys
            else conn.fetch(_CURRENT_SCHOOL_FACTS_SQL, unitid)
        )
    school = catalog.snapshot.schools[unitid]
    status = SchoolFactsStatus(
        school_id=status_row["school_id"],
        has_collegedata=status_row["has_collegedata"],
        facts_updated_at=status_row["facts_updated_at"],
        fact_count=status_row["fact_count"],
        tabs=dict(status_row["tabs"] or {}),
    )
    rows = tuple(FactValueRow(**dict(record)) for record in fact_rows)
    return FactsQueryResult(school=school.basics, status=status, rows=rows)


async def explore(
    catalog: Catalog, statements: list[tuple[str, list[Any]]]
) -> tuple[tuple[asyncpg.Record, ...], ...]:
    """Execute the parameterized statements `app/facts/service_explore.py`
    built (plan §5.3) -- one read-only transaction, in order, never through
    `_guard_sql` (that guard is for model-authored SQL only). Every
    statement here is code-owned; caller-supplied values are asyncpg bind
    parameters throughout.
    """
    results: list[tuple[asyncpg.Record, ...]] = []
    async with catalog.pool.acquire() as conn, conn.transaction(readonly=True):
        for sql, params in statements:
            rows = await conn.fetch(sql, *params)  # nosec B608 -- code-owned SQL, bound params only
            results.append(tuple(rows))
    return tuple(results)


async def majors(catalog: Catalog, query: str) -> tuple[tuple[str, int], ...]:
    """`GET /v1/schools/majors?q=` (plan §5.3) -- exact-prefix match on the
    school's own printed program name; no standard vocabulary exists."""
    async with catalog.pool.acquire() as conn:
        rows = await conn.fetch(_MAJORS_SQL, query)
    return tuple((row["m"], row["n"]) for row in rows)


