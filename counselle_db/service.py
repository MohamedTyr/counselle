"""The four-tool CDS Library service API."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Any, cast

import asyncpg
from sqlglot import exp, parse
from sqlglot.errors import ParseError, TokenError

from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.formatting import format_cds_edition, format_decimal
from counselle_db.models import (
    AvailabilitySummary,
    DomainResult,
    ProfileGroup,
    ProfileGroupResult,
    ProfileLeaf,
    ProfileProvenanceReceipt,
    QueryResult,
    ResolveCandidates,
    ResolvedSchool,
    ResolveNotFound,
    ResolveResult,
    SchoolCoverage,
    ServiceError,
)
from counselle_db.packets import ParsedMetric, parse_packet_row, read_metric

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
        "jsonb_build_object",
        "jsonb_path_exists",
        "jsonb_typeof",
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
        "to_jsonb",
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
_PACKET_RELATION = "cds_library.active_cds_domain_packets"
_DOCUMENT_RELATION = "cds_library.active_cds_documents"
_MANIFEST_RELATION = "cds_library.cds_manifest_snapshots"
_INTERNAL_PACKET_KEYS = frozenset({"provider_contract", "diagnostic_code", "evidence"})
_SAFE_PACKET_RESULT_KEYS = frozenset(
    {"availability_status", "extraction_status", "value"}
)
_MANIFEST_METRIC_JSONPATH = "$.domains[*].metrics[*] ? (@.id == $ref)"


def _catalog_settings(catalog: Catalog) -> Any:
    """Use settings injected by the owning runtime; fall back for test/MCP seams."""
    return getattr(catalog, "settings", None) or get_settings()


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
    for cast_expression in tree.find_all(exp.Cast):
        target = cast_expression.args.get("to")
        if isinstance(target, exp.DataType) and target.this in {
            exp.DataType.Type.BINARY,
            exp.DataType.Type.VARBINARY,
        }:
            raise ServiceError("Expressions returning binary/PDF bytes are not allowed.")


def _json_path_parts(expression: exp.Expression, params: list[Any]) -> tuple[str, ...]:
    """Return one safe, statically bound JSON extraction path.

    Packet paths are a security boundary: accepting an expression we cannot
    resolve here would let a query assemble an internal key at execution time
    and bypass the denylist below.  Only quoted string keys and direct ``$n``
    bind parameters are supported.
    """
    value = expression.args.get("expression")
    if isinstance(value, exp.JSONPath):
        parts = tuple(value.expressions)
        if (
            not parts
            or not isinstance(parts[0], exp.JSONPathRoot)
            or any(not isinstance(part, exp.JSONPathKey) for part in parts[1:])
        ):
            raise ServiceError(
                "Packet JSON paths must use static string keys or direct positional parameters."
            )
        return tuple(str(key.this) for key in parts[1:])
    if (
        isinstance(value, exp.Parameter)
        and isinstance(value.this, exp.Literal)
        and value.this.is_int
    ):
        index = int(value.this.this) - 1
        if 0 <= index < len(params):
            return (str(params[index]),)
    if isinstance(value, exp.Literal) and value.is_string:
        return (str(value.this),)
    raise ServiceError(
        "Packet JSON paths must use static string keys or direct positional parameters."
    )


def _packet_path(column: exp.Column, params: list[Any]) -> tuple[str, ...]:
    """Collect the chained ``packet -> ...`` path rooted at one packet column."""
    parts: list[str] = []
    child: exp.Expression = column
    parent = child.parent
    while isinstance(parent, (exp.JSONExtract, exp.JSONExtractScalar)):
        if parent.this is not child:
            break
        parts.extend(_json_path_parts(parent, params))
        child = parent
        parent = child.parent
    return tuple(parts)


def _reject_dynamic_packet_paths(
    tree: exp.Query, params: list[Any], packet_aliases: set[str]
) -> None:
    """Reject computed JSON keys on packet chains, including CTE aliases."""
    packet_roots = {_PACKET_RELATION.rsplit(".", 1)[-1], "packet", *packet_aliases}
    for extraction in tree.find_all(exp.JSONExtract, exp.JSONExtractScalar):
        root = cast(exp.Expression, extraction)
        while isinstance(root, (exp.JSONExtract, exp.JSONExtractScalar)):
            root = root.this
        if isinstance(root, exp.Column) and root.name.casefold() in packet_roots:
            _json_path_parts(cast(exp.Expression, extraction), params)


def _projection_body(expression: exp.Expression) -> exp.Expression:
    return expression.this if isinstance(expression, exp.Alias) else expression


def _packet_column(expression: exp.Expression) -> exp.Column | None:
    return next(
        (
            column
            for column in expression.find_all(exp.Column)
            if column.name.casefold() == "packet"
        ),
        None,
    )


def _packet_path_keys(tree: exp.Query, params: list[Any]) -> set[str]:
    keys = {str(key.this).casefold() for key in tree.find_all(exp.JSONPathKey)}
    keys.update(
        str(params[int(parameter.this.this) - 1]).casefold()
        for parameter in tree.find_all(exp.Parameter)
        if isinstance(parameter.this, exp.Literal)
        and parameter.this.is_int
        and 0 < int(parameter.this.this) <= len(params)
        and isinstance(parameter.parent, (exp.JSONExtract, exp.JSONExtractScalar))
    )
    return keys


def _returns_packet_object(
    body: exp.Expression, params: list[Any], unsafe_aliases: set[str]
) -> bool:
    direct_packet = _packet_column(body)
    if direct_packet is not None:
        path = tuple(part.casefold() for part in _packet_path(direct_packet, params))
        return not (
            isinstance(body, exp.JSONExtractScalar)
            or (bool(path) and path[-1] in _SAFE_PACKET_RESULT_KEYS)
        )
    columns = {column.name.casefold() for column in body.find_all(exp.Column)}
    if not columns & unsafe_aliases:
        return False
    return not (
        isinstance(body, exp.JSONExtractScalar)
        or any(
            str(key.this).casefold() in _SAFE_PACKET_RESULT_KEYS
            for key in body.find_all(exp.JSONPathKey)
        )
    )


def _packet_object_aliases(tree: exp.Query, params: list[Any]) -> set[str]:
    unsafe_aliases: set[str] = set()
    selects = list(tree.find_all(exp.Select))
    for _ in range(len(selects)):
        before = len(unsafe_aliases)
        for projection in (
            projection for select in selects for projection in select.expressions
        ):
            alias = projection.alias_or_name.casefold()
            if alias and _returns_packet_object(
                _projection_body(projection), params, unsafe_aliases
            ):
                unsafe_aliases.add(alias)
        if len(unsafe_aliases) == before:
            break
    return unsafe_aliases


def _reject_packet_projection(
    tree: exp.Query, relations: set[str], params: list[Any]
) -> None:
    """Keep packet provenance and large JSON objects behind the typed parser.

    The guarded SQL escape hatch may traverse one named metric for scalar
    filtering and aggregation. It may not select the whole packet/metrics map,
    internal evidence or diagnostics, or return a metric object to the model.
    """
    if _PACKET_RELATION not in relations:
        return
    if _packet_path_keys(tree, params) & _INTERNAL_PACKET_KEYS:
        raise ServiceError(
            "Packet provenance, diagnostics, and raw evidence are internal; "
            "use get_domain for typed values and citations."
        )
    for column in tree.find_all(exp.Column):
        if column.name.casefold() != "packet":
            continue
        path = tuple(part.casefold() for part in _packet_path(column, params))
        if len(path) < 2 or path[0] != "metrics":
            raise ServiceError(
                "Whole packet JSON cannot be selected; traverse one named metric "
                "for scalar filtering or aggregation."
            )
    unsafe_aliases = _packet_object_aliases(tree, params)
    _reject_dynamic_packet_paths(tree, params, unsafe_aliases)
    root_select = tree if isinstance(tree, exp.Select) else tree.find(exp.Select)
    if root_select is None:
        return
    for projection in root_select.expressions:
        if _returns_packet_object(_projection_body(projection), params, unsafe_aliases):
            raise ServiceError(
                "Packet objects cannot be returned; select only scalar candidate values."
            )


def _reject_manifest_text_search(tree: exp.Query, relations: set[str]) -> None:
    """Prevent substring matches from masquerading as exact manifest membership."""
    if _MANIFEST_RELATION not in relations:
        return
    for predicate in tree.find_all(exp.ILike, exp.Like):
        if any(
            column.name.casefold() == "content"
            for column in predicate.this.find_all(exp.Column)
        ):
            raise ServiceError(
                "Manifest metric references require exact structural JSON membership, "
                "not a text substring search."
            )


def _table_is(table: exp.Table, relation: str) -> bool:
    schema, name = relation.split(".", 1)
    return table.db.casefold() == schema and table.name.casefold() == name


def _ordered_column(item: exp.Expression) -> tuple[str, bool] | None:
    if not isinstance(item, exp.Ordered) or not isinstance(item.this, exp.Column):
        return None
    return item.this.name.casefold(), item.args.get("desc") is True


def _selected_document_cte(tree: exp.Query) -> str | None:
    """Find the unfiltered, deterministic selected-document CTE from db-recipes."""
    for cte in tree.find_all(exp.CTE):
        select = cte.this
        if not isinstance(select, exp.Select):
            continue
        from_clause = select.args.get("from_")
        source = from_clause.this if isinstance(from_clause, exp.From) else None
        if not isinstance(source, exp.Table) or not _table_is(source, _DOCUMENT_RELATION):
            continue
        distinct = select.args.get("distinct")
        on = distinct.args.get("on") if isinstance(distinct, exp.Distinct) else None
        distinct_expressions = list(on.expressions) if isinstance(on, exp.Tuple) else []
        order = select.args.get("order")
        ordered = (
            [_ordered_column(item) for item in order.expressions]
            if isinstance(order, exp.Order)
            else []
        )
        projected = {
            projection.name.casefold()
            for projection in select.expressions
            if isinstance(projection, exp.Column)
        }
        unfiltered = (
            not any(
                select.args.get(key) is not None
                for key in ("where", "limit", "group", "having", "qualify")
            )
            and not select.args.get("joins")
            and not any(nested is not select for nested in select.find_all(exp.Select))
        )
        if (
            len(distinct_expressions) == 1
            and isinstance(distinct_expressions[0], exp.Column)
            and distinct_expressions[0].name.casefold() == "school_id"
            and {"school_id", "document_id"} <= projected
            and unfiltered
            and ordered[:3]
            == [
                ("school_id", False),
                ("academic_year", True),
                ("document_id", True),
            ]
        ):
            return cte.alias.casefold()
    return None


def _join_has_exact_document_keys(
    join: exp.Join, selected_alias: str, packet_alias: str
) -> bool:
    on = join.args.get("on")
    if not isinstance(on, exp.Expression) or on.find(exp.Or) is not None:
        return False
    matched: set[str] = set()
    for equality in on.find_all(exp.EQ):
        left, right = equality.this, equality.expression
        if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
            continue
        columns = (left, right)
        names = {column.name.casefold() for column in columns}
        tables = {column.table.casefold() for column in columns}
        if len(names) == 1 and tables == {selected_alias, packet_alias}:
            matched.update(names)
    return {"school_id", "document_id"} <= matched


def _uses_selected_document_ranking(tree: exp.Query) -> bool:
    selected_alias = _selected_document_cte(tree)
    if selected_alias is None:
        return False
    for select in tree.find_all(exp.Select):
        from_clause = select.args.get("from_")
        packet_table = from_clause.this if isinstance(from_clause, exp.From) else None
        if not isinstance(packet_table, exp.Table) or not _table_is(
            packet_table, _PACKET_RELATION
        ):
            continue
        packet_alias = packet_table.alias_or_name.casefold()
        for join in select.args.get("joins") or []:
            relation = join.this
            if (
                isinstance(relation, exp.Table)
                and relation.name.casefold() == selected_alias
                and not join.args.get("side")
                and join.args.get("kind") in {None, "INNER"}
                and _join_has_exact_document_keys(
                    join, relation.alias_or_name.casefold(), packet_alias
                )
            ):
                return True
    return False


def _select_direct_tables(select: exp.Select) -> list[exp.Table]:
    return [
        table
        for table in select.find_all(exp.Table)
        if table.find_ancestor(exp.Select) is select
    ]


def _has_single_school_constraint(tree: exp.Query) -> bool:
    """Allow a direct document/packet join only when that join is one-school scoped."""
    for select in tree.find_all(exp.Select):
        tables = _select_direct_tables(select)
        relations = {
            _DOCUMENT_RELATION
            if _table_is(table, _DOCUMENT_RELATION)
            else _PACKET_RELATION
            if _table_is(table, _PACKET_RELATION)
            else ""
            for table in tables
        }
        if not {_DOCUMENT_RELATION, _PACKET_RELATION} <= relations:
            continue
        aliases = {table.alias_or_name.casefold() for table in tables}
        where = select.args.get("where")
        if not isinstance(where, exp.Where) or where.find(exp.Or) is not None:
            continue
        for equality in where.find_all(exp.EQ):
            left, right = equality.this, equality.expression
            pairs = ((left, right), (right, left))
            if any(
                isinstance(column, exp.Column)
                and column.name.casefold() == "school_id"
                and (not column.table or column.table.casefold() in aliases)
                and isinstance(value, (exp.Parameter, exp.Literal))
                for column, value in pairs
            ):
                return True
    return False


def _reject_unselected_cross_school_ranking(
    tree: exp.Query, relations: set[str]
) -> None:
    """Prevent rankings from mixing multiple active editions per school."""
    if not {_DOCUMENT_RELATION, _PACKET_RELATION} <= relations:
        return
    has_bounded_ranking = any(
        select.args.get("order") is not None and select.args.get("limit") is not None
        for select in tree.find_all(exp.Select)
    )
    if not has_bounded_ranking:
        return
    if _has_single_school_constraint(tree) or _uses_selected_document_ranking(tree):
        return
    raise ServiceError(
        "Cross-school packet rankings require canonical selected-document semantics: "
        "use the db-recipes DISTINCT ON selected-per-school CTE and join packets on "
        "exact school_id + document_id."
    )


def _is_manifest_membership_call(
    function: exp.Anonymous, manifest_aliases: set[str]
) -> bool:
    args = function.expressions
    if len(args) != 3:
        return False
    content, path, variables = args
    if not (
        isinstance(content, exp.Column)
        and content.name.casefold() == "content"
        and content.table.casefold() in manifest_aliases
        and isinstance(path, exp.Literal)
        and path.is_string
        and path.this == _MANIFEST_METRIC_JSONPATH
        and isinstance(variables, exp.Anonymous)
        and variables.name.casefold() == "jsonb_build_object"
        and len(variables.expressions) == 2
        and isinstance(variables.expressions[0], exp.Literal)
        and variables.expressions[0].is_string
        and variables.expressions[0].this == "ref"
    ):
        return False
    encoded_ref = variables.expressions[1]
    if not (
        isinstance(encoded_ref, exp.Anonymous)
        and encoded_ref.name.casefold() == "to_jsonb"
        and len(encoded_ref.expressions) == 1
        and isinstance(encoded_ref.expressions[0], exp.Cast)
    ):
        return False
    parameter = encoded_ref.expressions[0].this
    target = encoded_ref.expressions[0].args.get("to")
    return (
        isinstance(parameter, exp.Parameter)
        and isinstance(parameter.this, exp.Literal)
        and parameter.this.is_int
        and int(parameter.this.this) == 1
        and isinstance(target, exp.DataType)
        and target.this == exp.DataType.Type.TEXT
    )


def _reject_non_manifest_json_helpers(tree: exp.Query, relations: set[str]) -> None:
    """Allow JSONPath only for the one bound exact-ref manifest predicate."""
    manifest_aliases = {
        table.alias_or_name.casefold()
        for table in tree.find_all(exp.Table)
        if table.db.casefold() == "cds_library"
        and table.name.casefold() == "cds_manifest_snapshots"
    }
    membership_calls = [
        function
        for function in tree.find_all(exp.Anonymous)
        if function.name.casefold() == "jsonb_path_exists"
    ]
    if membership_calls and (
        _MANIFEST_RELATION not in relations
        or any(
            not _is_manifest_membership_call(function, manifest_aliases)
            for function in membership_calls
        )
    ):
        raise ServiceError("Only exact bound manifest metric membership JSONPath is allowed.")
    for function in tree.find_all(exp.Anonymous):
        if function.name.casefold() not in {"jsonb_build_object", "to_jsonb"}:
            continue
        if not any(
            function is descendant
            for call in membership_calls
            for descendant in call.walk()
        ):
            raise ServiceError("Manifest JSON helper functions are restricted to exact membership.")


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
        selected_edition=format_cds_edition(document["academic_year"]),
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


def _receipt_at(
    provenance: Any, path: tuple[str, ...]
) -> ProfileProvenanceReceipt | None:
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
    domain = await catalog.domain(domain_id)
    school = catalog.snapshot.schools.get(unitid)
    if school is None:
        raise ServiceError("School is not in the profile catalog.")
    async with catalog.pool.acquire() as conn:
        document = await conn.fetchrow(_SELECTED_DOCUMENT_SQL, unitid, domain_id)
    empty = AvailabilitySummary(
        configured=len(domain.metrics),
        verified=0,
        available=0,
        not_in_template_version=0,
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
    settings = _catalog_settings(catalog)
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
    verified = sum(
        metric.extraction_status == "verified"
        for ref, metric in packet.packet.metrics.items()
        if ref in definitions
    )
    available = sum(row.available for row in rows)
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
            configured=len(domain.metrics),
            verified=verified,
            available=available,
            not_in_template_version=absent,
        ),
        summary=summary,
    )


def _guard_sql(sql: str, params: list[Any]) -> str:
    if not isinstance(sql, str) or not sql.strip():
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    normalized = sql.strip()
    if normalized.endswith(";"):
        normalized = normalized[:-1].rstrip()
    if not normalized or any(token in normalized for token in (";", "--", "/*")):
        raise ServiceError("Only one safe SELECT/WITH statement is allowed.")
    try:
        statements = parse(normalized, read="postgres")
    except (ParseError, TokenError):
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
    placeholders = sorted({int(item) for item in _PLACEHOLDER_RE.findall(normalized)})
    ast_placeholders = sorted(
        {
        int(parameter.this.this)
        for parameter in tree.find_all(exp.Parameter)
        if isinstance(parameter.this, exp.Literal) and parameter.this.is_int
        }
    )
    if placeholders != ast_placeholders or placeholders != list(range(1, len(params) + 1)):
        raise ServiceError("SQL placeholders must be contiguous and match params exactly.")
    if any(_contains_binary(value) for value in params):
        raise ServiceError("Binary query parameters are not allowed.")
    _reject_binary_projection(tree, relations)
    _reject_packet_projection(tree, relations, params)
    _reject_unselected_cross_school_ranking(tree, relations)
    _reject_manifest_text_search(tree, relations)
    _reject_non_manifest_json_helpers(tree, relations)
    return normalized


async def query_database(
    catalog: Catalog, sql: str, params: list[Any] | None = None
) -> QueryResult:
    values = params or []
    safe_sql = _guard_sql(sql, values)
    settings = _catalog_settings(catalog)
    # The interpolated statement has passed the sqlglot relation/function/
    # statement allowlist above; every caller-supplied value remains an asyncpg
    # bind parameter. Only the code-owned row cap is added here.
    wrapped = (
        f"SELECT * FROM ({safe_sql}) AS counselle_query LIMIT {settings.db_row_cap + 1}"  # nosec B608
    )
    rows: list[tuple[Any, ...]] = []
    columns: tuple[str, ...] = ()
    truncated = False
    as_of = datetime.now(UTC)
    warning = (
        "Raw query rows bypass typed normalization. Re-fetch named student-facing "
        "values through get_school_profile or get_domain; aggregates need as-of "
        "and coverage-denominator attribution."
    )
    async with catalog.pool.acquire() as conn, conn.transaction(readonly=True):
        await conn.execute(
            "SELECT set_config('statement_timeout', $1, true)",
            str(settings.db_statement_timeout_ms),
        )
        cursor = conn.cursor(wrapped, *values, prefetch=1)
        async for record in cursor:
            if len(rows) >= settings.db_row_cap:
                truncated = True
                break
            if not columns:
                columns = tuple(record.keys())
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
                truncated=False,
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
