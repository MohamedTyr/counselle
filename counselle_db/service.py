"""The four-tool CDS Library service API."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import asyncpg
from sqlglot import exp, parse
from sqlglot.errors import ParseError

from config.settings import get_db_child_settings
from counselle_db.catalog import Catalog
from counselle_db.models import (
    AvailabilitySummary,
    DomainResult,
    ProfileGroup,
    ProfileGroupResult,
    ProfileLeaf,
    QueryResult,
    ResolveCandidates,
    ResolvedSchool,
    ResolveNotFound,
    ResolveResult,
    SchoolCoverage,
    ServiceError,
)
from counselle_db.packets import ParsedMetric, parse_packet_row, read_metric

# Local seam retained for focused service tests.
get_settings = get_db_child_settings

__all__ = [
    "ServiceError",
    "get_domain",
    "get_school_profile",
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
_ALLOWED_RELATIONS = frozenset(
    {
        "cds_library.school_profiles",
        "cds_library.active_cds_domain_packets",
        "cds_library.active_cds_documents",
        "cds_library.cds_document_sources",
        "cds_library.cds_manifest_snapshots",
    }
)
_PLACEHOLDER_RE = re.compile(r"\$(\d+)")
_SAFE_FUNCTIONS = frozenset(
    {
        "abs",
        "and",
        "avg",
        "ceil",
        "ceiling",
        "char_length",
        "coalesce",
        "count",
        "cast",
        "date_part",
        "extract",
        "floor",
        "greatest",
        "least",
        "in",
        "length",
        "like",
        "json_extract",
        "json_extract_scalar",
        "lower",
        "max",
        "min",
        "not",
        "nullif",
        "octet_length",
        "or",
        "round",
        "substring",
        "sum",
        "trim",
        "upper",
    }
)

# The bytea-bearing columns in the five-view reader contract.  Guard these before
# asyncpg executes the statement: the post-fetch recursion remains a final backstop,
# but must never be the mechanism that prevents a PDF from being materialized.
_BYTEA_COLUMNS = frozenset(
    {"pdf_content", "pdf_sha256", "profile_sha256", "content_sha256", "domain_schema_hash"}
)
_BYTEA_RELATIONS = frozenset(
    {
        "cds_library.school_profiles",
        "cds_library.active_cds_domain_packets",
        "cds_library.active_cds_documents",
        "cds_library.cds_document_sources",
        "cds_library.cds_manifest_snapshots",
    }
)


def _inside_octet_length(column: exp.Column) -> bool:
    parent = column.parent
    while parent is not None and not isinstance(parent, exp.Select):
        if isinstance(parent, exp.Anonymous) and parent.name.casefold() == "octet_length":
            return True
        parent = parent.parent
    return False


def _reject_binary_projection(tree: exp.Query, relations: set[str]) -> None:
    """Reject projections that can return bytea before the database is queried."""
    unsafe_star = any(
        isinstance(expression, exp.Star)
        or (isinstance(expression, exp.Column) and isinstance(expression.this, exp.Star))
        for select in tree.find_all(exp.Select)
        for expression in select.expressions
    )
    if relations & _BYTEA_RELATIONS and unsafe_star:
        raise ServiceError(
            "Binary/PDF columns cannot be selected with *; name safe metadata columns."
        )
    for column in tree.find_all(exp.Column):
        if column.name.casefold() in _BYTEA_COLUMNS and not _inside_octet_length(column):
            raise ServiceError(
                "Binary/PDF bytes cannot be returned; select metadata such as "
                "octet_length(pdf_content)."
            )
    for cast in tree.find_all(exp.Cast):
        target = cast.args.get("to")
        if isinstance(target, exp.DataType) and target.this in {
            exp.DataType.Type.BINARY,
            exp.DataType.Type.VARBINARY,
        }:
            raise ServiceError("Expressions returning binary/PDF bytes are not allowed.")


def _contains_binary(value: Any) -> bool:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return True
    if isinstance(value, dict):
        return any(_contains_binary(key) or _contains_binary(child) for key, child in value.items())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_binary(child) for child in value)
    return False


def _coverage(
    document: asyncpg.Record | None, rows: list[asyncpg.Record], catalog: Catalog
) -> SchoolCoverage:
    if document is None:
        return SchoolCoverage()
    statuses = {
        row["domain_id"]: row["accepted_packet_status"] for row in rows if row["packet"] is not None
    }
    ordered = tuple(domain.id for domain in catalog.snapshot.domains if domain.id in statuses)
    return SchoolCoverage(
        selected_year=document["academic_year"],
        document_id=document["document_id"],
        currentness=document["currentness"],
        stale_reason=document["staleness_reason"],
        usable_domain_count=len(ordered),
        partial_domain_count=sum(value == "partial" for value in statuses.values()),
        usable_domain_ids=ordered,
        latest_status=document["latest_extraction_status"],
        latest_error_code=document["latest_error_code"],
    )


async def _live_document(
    catalog: Catalog, unitid: int
) -> tuple[asyncpg.Record | None, list[asyncpg.Record]]:
    async with catalog.pool.acquire() as conn:
        document = await conn.fetchrow(_SELECTED_DOCUMENT_SQL, unitid, None)
        if document is None:
            return None, []
        rows = await conn.fetch(
            _DOMAIN_ROWS_SQL,
            unitid,
            document["document_id"],
            [d.id for d in catalog.snapshot.domains],
        )
        return document, list(rows)


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
        return format(Decimal(str(value)), "f").rstrip("0").rstrip(".") or "0"
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


def _receipt_at(provenance: Any, path: tuple[str, ...]) -> dict[str, Any] | None:
    current = provenance
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current if isinstance(current, dict) else None


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
    source_column = receipt.get("source_column") if receipt else None
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
    domain = await catalog.domain(domain_id)
    school = catalog.snapshot.schools.get(unitid)
    if school is None:
        raise ServiceError("School is not in the profile catalog.")
    async with catalog.pool.acquire() as conn:
        document = await conn.fetchrow(_SELECTED_DOCUMENT_SQL, unitid, domain_id)
    empty = AvailabilitySummary(
        configured=len(domain.metrics), verified=0, not_in_template_version=0
    )
    if document is None:
        return DomainResult(
            school=school.basics,
            domain_id=domain_id,
            availability=empty,
            summary=f"0 of {len(domain.metrics)} metrics verified; no active CDS document.",
        )
    manifest_version = document["target_manifest_version"]
    manifests = dict(catalog.snapshot.manifests)
    pinned_manifest = manifests.get(manifest_version) if manifest_version else None
    if manifest_version and pinned_manifest is None:
        raise ServiceError(
            "Stored CDS data for this domain uses an unsupported/inconsistent "
            "contract; no values were returned."
        )
    historical_domain = (
        next((item for item in pinned_manifest.domains if item.id == domain_id), None)
        if pinned_manifest
        else None
    )
    if pinned_manifest and historical_domain is None:
        raise ServiceError(
            "Stored CDS data for this domain uses an unsupported/inconsistent "
            "contract; no values were returned."
        )
    binder_domains = {
        ref.split(".", 1)[0]
        for metric in (historical_domain.metrics if historical_domain else ())
        for context in metric.contexts
        for ref in context.refs
    }
    requested_domains = sorted({domain_id, *binder_domains})
    async with catalog.pool.acquire() as conn:
        raw_rows = await conn.fetch(
            _DOMAIN_ROWS_SQL, unitid, document["document_id"], requested_domains
        )
    by_domain = {row["domain_id"]: row for row in raw_rows}
    target = by_domain.get(domain_id)
    if target is None or target["packet"] is None:
        return DomainResult(
            school=school.basics,
            domain_id=domain_id,
            academic_year=document["academic_year"],
            document_id=document["document_id"],
            document_sha256=bytes(document["pdf_sha256"]).hex(),
            currentness=document["currentness"],
            latest_status=document["latest_extraction_status"],
            latest_error_code=document["latest_error_code"],
            availability=empty,
            summary=(
                f"0 of {len(domain.metrics)} metrics verified; this domain has no accepted packet."
            ),
        )
    settings = get_settings()
    target_packet = parse_packet_row(
        dict(target), manifests, settings.supported_packet_extractor_versions
    )
    parsed = {domain_id: target_packet}
    parsed.update(
        {
            key: parse_packet_row(
                dict(row), manifests, settings.supported_packet_extractor_versions
            )
            for key, row in by_domain.items()
            if key != domain_id and row["packet"] is not None
        }
    )
    context_values: dict[str, tuple[ParsedMetric, Any]] = {}
    for parsed_packet in parsed.values():
        definitions = {
            metric.ref: metric for d in parsed_packet.manifest.domains for metric in d.metrics
        }
        context_values.update(
            {
                ref: (metric, definitions[ref])
                for ref, metric in parsed_packet.packet.metrics.items()
                if ref in definitions
                and metric.extraction_status == "verified"
                and metric.availability_status == "reported"
                and metric.value is not None
                and metric.evidence is not None
            }
        )
    packet = parsed[domain_id]
    definitions = {
        metric.ref: metric
        for d in packet.manifest.domains
        if d.id == domain_id
        for metric in d.metrics
    }
    rows = tuple(
        read_metric(
            packet.packet.metrics.get(
                definition.ref,
                ParsedMetric(
                    ref=definition.ref,
                    extraction_status="not_extracted",
                    availability_status=None,
                    value=None,
                    raw_value=None,
                    evidence=None,
                ),
            ),
            definition,
            academic_year=document["academic_year"],
            packet_status=packet.packet.status,
            definition_match=packet.current_definition_match,
            currentness=document["currentness"],
            context_values=context_values,
        )
        for definition in definitions.values()
    )
    verified = sum(row.available for row in rows)
    absent = sum(row.availability_status == "not_in_template_version" for row in rows)
    summary = f"{verified} of {len(domain.metrics)} metrics verified"
    if absent:
        summary += f"; {absent} not in this template version"
    return DomainResult(
        school=school.basics,
        domain_id=domain_id,
        academic_year=document["academic_year"],
        document_id=document["document_id"],
        document_sha256=bytes(document["pdf_sha256"]).hex(),
        source_kind=document["source_kind"],
        retrieved_at=document["retrieved_at"],
        manifest_version=packet.packet.manifest_version,
        packet_status=packet.packet.status,
        currentness=document["currentness"],
        latest_status=document["latest_extraction_status"],
        latest_error_code=document["latest_error_code"],
        definition_match=packet.current_definition_match,
        rows=rows,
        availability=AvailabilitySummary(
            configured=len(domain.metrics), verified=verified, not_in_template_version=absent
        ),
        summary=summary,
    )


def _guard_sql(sql: str, params: list[Any]) -> None:
    if (
        not isinstance(sql, str)
        or not sql.strip()
        or any(token in sql for token in (";", "--", "/*"))
    ):
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    try:
        statements = parse(sql, read="postgres")
    except ParseError:
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.") from None
    if len(statements) != 1 or not isinstance(statements[0], exp.Query):
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    tree = statements[0]
    forbidden_nodes = (
        exp.Alter,
        exp.Command,
        exp.Copy,
        exp.Create,
        exp.Delete,
        exp.Drop,
        exp.Grant,
        exp.Insert,
        exp.Merge,
        exp.Revoke,
        exp.Set,
        exp.Update,
    )
    if any(tree.find(node_type) is not None for node_type in forbidden_nodes):
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    if tree.find(exp.Lock) is not None or tree.find(exp.Into) is not None:
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    if any(
        not join.args.get("on") and not join.args.get("kind") for join in tree.find_all(exp.Join)
    ):
        raise ServiceError("Implicit comma joins are not allowed.")
    cte_names = {cte.alias for cte in tree.find_all(exp.CTE)}
    tables = list(tree.find_all(exp.Table))
    if not tables:
        raise ServiceError("Queries must read at least one CDS reader view.")
    relations: set[str] = set()
    for table in tables:
        if not table.db and table.name in cte_names and not table.catalog:
            continue
        relation = f"{table.db}.{table.name}" if table.db and not table.catalog else ""
        if relation not in _ALLOWED_RELATIONS:
            raise ServiceError("Queries may use only the five schema-qualified CDS reader views.")
        relations.add(relation)
    for function in tree.find_all(exp.Func):
        name = (
            function.name if isinstance(function, exp.Anonymous) else function.sql_name()
        ).casefold()
        if name not in _SAFE_FUNCTIONS:
            raise ServiceError("Query uses a function that is not allowed by the read-only guard.")
    placeholders = sorted({int(item) for item in _PLACEHOLDER_RE.findall(sql)})
    ast_placeholders = sorted(
        int(parameter.this.this)
        for parameter in tree.find_all(exp.Parameter)
        if isinstance(parameter.this, exp.Literal) and parameter.this.is_int
    )
    if placeholders != ast_placeholders or placeholders != list(range(1, len(params) + 1)):
        raise ServiceError("SQL placeholders must be contiguous and match params exactly.")
    if any(_contains_binary(value) for value in params):
        raise ServiceError("Binary query parameters are not allowed.")
    _reject_binary_projection(tree, relations)


async def query_database(
    catalog: Catalog, sql: str, params: list[Any] | None = None
) -> QueryResult:
    values = params or []
    _guard_sql(sql, values)
    settings = get_settings()
    wrapped = f"SELECT * FROM ({sql}) AS counselle_query LIMIT {settings.db_row_cap + 1}"
    async with catalog.pool.acquire() as conn, conn.transaction(readonly=True):
        await conn.execute(
            "SELECT set_config('statement_timeout', $1, true)",
            str(settings.db_statement_timeout_ms),
        )
        records = await conn.fetch(wrapped, *values)
    truncated = len(records) > settings.db_row_cap
    records = records[: settings.db_row_cap]
    columns = tuple(records[0].keys()) if records else ()
    rows: list[tuple[Any, ...]] = []
    as_of = datetime.now(UTC)
    warning = (
        "Raw query rows bypass typed normalization. Re-fetch named student-facing "
        "values through get_school_profile or get_domain; aggregates need as-of "
        "and coverage-denominator attribution."
    )
    for record in records:
        row = tuple(record.values())
        if _contains_binary(row):
            raise ServiceError(
                "Binary/PDF bytes cannot be returned; select metadata such as "
                "octet_length(pdf_content)."
            )
        candidate = QueryResult(
            columns=columns,
            rows=tuple([*rows, row]),
            row_count=len(rows) + 1,
            truncated=truncated,
            as_of=as_of,
            warning=warning,
        )
        if len(candidate.model_dump_json().encode()) > settings.query_database_max_bytes:
            truncated = True
            break
        rows.append(row)
    result = QueryResult(
        columns=columns,
        rows=tuple(rows),
        row_count=len(rows),
        truncated=truncated,
        as_of=as_of,
        warning=warning,
    )
    if len(result.model_dump_json().encode()) > settings.query_database_max_bytes:
        raise ServiceError("Query metadata exceeds the configured serialized-result limit.")
    return result
