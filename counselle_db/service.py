"""The CollegeData facts-store service API (in-process; the MCP server it
used to back was retired in school-data-v3 Phase 3) -- `resolve_school`,
`get_school_profile`, `get_facts`, `explore`, and `majors` over the six
`cds_library` reader views (ADR 0038).

`query_database`'s SQL guard (`_guard_sql`, its ~20 AST-walking helpers, and
`query_database` itself) lives in `counselle_db/sql_guard.py` -- split out
to keep this file under the house 800-line limit (CLAUDE.md); re-exported
here so existing callers keep importing it from `counselle_db.service`
unchanged.

`tool_errors`/its `_error` D6-shape formatter also live here: the
in-process tools `app/toolset.py` mounts use the same safe-error contract.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from functools import wraps
from types import MappingProxyType
from typing import Any

import asyncpg
import structlog
from pydantic import ValidationError

from counselle_db.catalog import Catalog
from counselle_db.formatting import format_decimal
from counselle_db.models import (
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
    SchoolFactsStatus,
    ServiceError,
)
from counselle_db.sql_guard import query_database

logger = structlog.get_logger(__name__)

__all__ = [
    "ADMISSIONS_FIT_FACT_KEYS",
    "MAX_ADMISSIONS_FIT_PAGE_SCHOOLS",
    "ServiceError",
    "explore",
    "explore_with_admissions_fit_facts",
    "get_facts",
    "get_school_profile",
    "majors",
    "query_database",
    "resolve_school",
    "search_school_names",
    "tool_errors",
]

_GENERIC_SAFE_RETRY = "Adjust the arguments and retry once if data is still needed."
_MANIFEST_SAFE_RETRY = (
    "Load db-recipes and copy its exact structural manifest membership query, "
    "keeping the metric reference in the bound parameter."
)
_SELECTED_DOCUMENT_SAFE_RETRY = (
    "Load db-recipes and copy its selected-per-school ranking CTE and exact "
    "school_id + document_id packet join."
)


def _error(message: str) -> dict[str, Any]:
    lowered = message.lower()
    if any(
        word in lowered
        for word in ("postgresql://", "password", "api_key", "secret", "token", "dsn")
    ):
        message = "database tool failed without a shareable error message"
        lowered = message
    manifest_rejection = "manifest" in lowered and any(
        phrase in lowered
        for phrase in (
            "exact structural json membership",
            "exact bound manifest",
            "manifest json helper",
        )
    )
    selected_document_rejection = (
        "cross-school packet rankings require canonical selected-document semantics"
        in lowered
    )
    return {
        "error": "tool_error",
        "root_cause": message,
        "safe_retry": (
            _MANIFEST_SAFE_RETRY
            if manifest_rejection
            else _SELECTED_DOCUMENT_SAFE_RETRY
            if selected_document_rejection
            else _GENERIC_SAFE_RETRY
        ),
        "stop_condition": "If unavailable or outside the contract, say so instead of retrying.",
    }


def tool_errors(fn: Any) -> Any:
    """Wrap a tool body in the D6 safe-error shape: a `ServiceError` (or any
    unexpected exception) becomes `{error, root_cause, safe_retry,
    stop_condition}` instead of an uncaught traceback -- shared by
    `counselle_db.server`'s MCP tools and `app.toolset`'s in-process ones."""

    @wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return await fn(*args, **kwargs)
        except ServiceError as exc:
            return _error(str(exc))
        except Exception:
            logger.warning("db_tool_unexpected_error", tool=fn.__name__, exc_info=True)
            return _error("database tool failed without a shareable error message")

    return wrapper


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

# The Explore executor owns the current-school-facts read.  This feature's
# list is deliberately code-owned rather than caller-selected, so an Explore
# request cannot widen its student-profile comparison surface.  The app-layer
# adapter keeps a separately pinned tuple because it needs the same closed
# contract while translating a typed row, but this infrastructure module must
# never import outward into ``app`` to obtain SQL inputs.
ADMISSIONS_FIT_FACT_KEYS: tuple[str, ...] = (
    "admissions.test_policy_sat_or_act",
    "class_profile.gpa_distribution",
    "class_profile.class_rank_top_tenth",
    "class_profile.class_rank_top_quarter",
    "class_profile.class_rank_top_half",
    "class_profile.sat_math_p25",
    "class_profile.sat_math_p75",
    "class_profile.sat_ebrw_p25",
    "class_profile.sat_ebrw_p75",
    "class_profile.act_composite_p25",
    "class_profile.act_composite_p75",
)
# The default preserves the original two-argument executor API.  The Explore
# adapter must pass its already-validated configured page bound explicitly so
# this service never creates a second, conflicting limit when deployments
# choose a different ``facts_explore_max_page_size``.
MAX_ADMISSIONS_FIT_PAGE_SCHOOLS = 100
_ADMISSIONS_FIT_FACTS_SQL = """SELECT school_id,fact_key,tab,section,label,value,display,unit,
 value_type,value_num,value_text,value_bool,value_date,reported_period,reported_period_year,observed_at
 FROM cds_library.current_school_facts
 WHERE school_id=ANY($1::integer[]) AND fact_key=ANY($2::text[])
 ORDER BY school_id ASC,fact_key ASC"""
_MAJORS_SQL = """SELECT m,count(*) AS n FROM cds_library.school_explore, unnest(majors) m
 WHERE m ILIKE $1 || '%' GROUP BY m ORDER BY 2 DESC LIMIT 50"""


async def _facts_status(catalog: Catalog, unitid: int) -> SchoolFactsStatus | None:
    """`cds_library.school_data_status` for one school -- read live, never
    from the Catalog snapshot copy (plan §5.2's freshness rule; see the
    `_SCHOOL_DATA_STATUS_ONE_SQL` comment below). Shared by `resolve_school`
    and `get_facts`, whose own read stays inside its single read-only
    transaction with the fact rows rather than calling this helper, so the
    two never drift apart from a crawl committing in between."""
    async with catalog.pool.acquire() as conn:
        row = await conn.fetchrow(_SCHOOL_DATA_STATUS_ONE_SQL, unitid)
    if row is None:
        return None
    return SchoolFactsStatus(
        has_collegedata=row["has_collegedata"],
        facts_updated_at=row["facts_updated_at"],
        fact_count=row["fact_count"],
        tabs=dict(row["tabs"] or {}),
    )


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
    data = await _facts_status(catalog, school.basics.unitid)
    if data is None:
        raise ServiceError("That school is not in our database.")
    return ResolvedSchool(
        school=school.basics,
        data=data,
        profile_snapshot_date=school.profile_snapshot_date,
    )


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


def _section_keys(catalog: Catalog, sections: list[str]) -> list[str]:
    """Every declared `fact_key` in the named sections (plan §6a's `get_facts`
    narrowing) -- an unknown section id fails with the school-agnostic valid
    list (`facts_sections.yaml` is one asset for every school)."""
    known = catalog.snapshot.sections
    unknown = [section for section in sections if section not in known]
    if unknown:
        raise ServiceError(
            f"Unknown section {unknown[0]!r}. Valid sections: {', '.join(sorted(known))}"
        )
    return [
        fact.key
        for section in sections
        for group in known[section].groups
        for fact in group.facts
    ]


async def get_facts(
    catalog: Catalog,
    unitid: int,
    sections: list[str] | None = None,
    keys: list[str] | None = None,
) -> FactsQueryResult:
    """The one reader touching `current_school_facts` (plan §5.2/§6a).

    At most one of `sections` (expanded to that section's declared keys via
    `Catalog.snapshot.sections`) or `keys` (exact `fact_key`s) narrows the
    read; passing neither returns every current fact row for the school --
    the HTTP facts page's shape (`app/facts/service.py` needs the whole
    school to resolve every declared key's state, including keys with no row
    at all). This function does not add capping/`truncated` on top of the
    unnarrowed read, since the full-page read has no such budget (plan
    §5.2's ≤150 KB payload budget is a property of the data, not an
    artificial cap); the agent tool (`app/toolset.py`) applies its own cap
    on top of a narrowed call.
    """
    if sections and keys:
        raise ServiceError("Pass sections or keys, not both.")
    if not catalog.snapshot.schools.get(unitid):
        raise ServiceError("That school is not in our database.")
    resolved_keys = _section_keys(catalog, sections) if sections else keys
    async with catalog.pool.acquire() as conn, conn.transaction(readonly=True):
        status_row = await conn.fetchrow(_SCHOOL_DATA_STATUS_ONE_SQL, unitid)
        if status_row is None:
            raise ServiceError("That school is not in our database.")
        fact_rows = await (
            conn.fetch(_CURRENT_SCHOOL_FACTS_KEYS_SQL, unitid, resolved_keys)
            if resolved_keys
            else conn.fetch(_CURRENT_SCHOOL_FACTS_SQL, unitid)
        )
    school = catalog.snapshot.schools[unitid]
    status = SchoolFactsStatus(
        has_collegedata=status_row["has_collegedata"],
        facts_updated_at=status_row["facts_updated_at"],
        fact_count=status_row["fact_count"],
        tabs=dict(status_row["tabs"] or {}),
    )
    rows = tuple(FactValueRow(**dict(record)) for record in fact_rows)
    return FactsQueryResult(
        school=school.basics,
        status=status,
        rows=rows,
        profile_snapshot_date=school.profile_snapshot_date,
    )


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


def _validated_admissions_fit_page_cap(max_page_size: object) -> int:
    """Validate the bound supplied by the code-owned Explore caller.

    This module deliberately does not import application settings: the app
    validates its configuration and query once, then supplies that resulting
    cap to this infrastructure executor.  Keeping the validation here makes
    a direct caller fail before its page statement can create an unbounded
    dependent ``ANY`` query.
    """
    if (
        isinstance(max_page_size, bool)
        or not isinstance(max_page_size, int)
        or max_page_size <= 0
    ):
        raise ServiceError("Explore max_page_size must be a positive integer.")
    return max_page_size


def _admissions_fit_page_school_ids(
    rows: tuple[asyncpg.Record, ...], *, max_page_size: int
) -> list[int]:
    """Validate the bounded page identity set before issuing the fact batch.

    ``school_explore`` is one row per school.  The code-owned Explore caller
    supplies its validated page cap, which keeps a malformed page statement
    from turning into an unbounded ``ANY`` query or silently grouping data
    under an invalid identifier.
    """
    if len(rows) > max_page_size:
        raise ServiceError("Explore results exceed the admissions-fit page cap.")
    identifiers: list[int] = []
    seen: set[int] = set()
    for row in rows:
        try:
            school_id = row["school_id"]
        except (KeyError, IndexError) as exc:
            raise ServiceError("Explore page rows must include a school_id.") from exc
        if isinstance(school_id, bool) or not isinstance(school_id, int) or school_id <= 0:
            raise ServiceError("Explore page school_id must be a positive integer.")
        if school_id in seen:
            raise ServiceError("Explore page school_ids must be unique.")
        seen.add(school_id)
        identifiers.append(school_id)
    return identifiers


class _FrozenJsonList(Sequence[Any]):
    """An immutable JSON array with the narrow ``list`` compatibility the
    Phase-2 facts adapter needs while it decodes distribution buckets.

    It is intentionally *not* a ``list`` subclass: inherited C-level list
    methods could otherwise mutate it by calling ``list.append(instance, …)``.
    ``isinstance(value, list)`` consults this compatibility property, which
    lets the already-published adapter retain its JSON-array guard while all
    mutation routes remain unavailable.
    """

    __slots__ = ("_items",)

    def __init__(self, values: Sequence[Any]) -> None:
        # Bypass our deliberately rejecting ``__setattr__`` only while the
        # object is being built.  From the caller's point of view this is a
        # genuinely immutable sequence, including its otherwise reachable
        # backing attribute.
        object.__setattr__(self, "_items", tuple(_freeze_json(value) for value in values))

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __getattribute__(self, name: str) -> Any:
        # ``isinstance`` reads ``__class__`` for Python objects.  Expose the
        # JSON-array compatibility type there without inheriting mutable list
        # storage or overriding ``object.__class__`` with an incompatible
        # read-only property.
        if name == "__class__":
            return list
        return super().__getattribute__(name)

    def __getitem__(self, index: int | slice) -> Any:
        return self._items[index]

    def __len__(self) -> int:
        return len(self._items)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Sequence) and not isinstance(other, (str, bytes, bytearray)):
            return bool(self._items == tuple(other))
        return False

    def __repr__(self) -> str:
        return repr(list(self._items))


def _freeze_json(value: Any) -> Any:
    """Copy and freeze every JSON container supplied by the facts reader.

    ``FactValueRow`` itself is frozen, but its ``Any`` JSON payload would
    otherwise preserve an asyncpg row's mutable dictionaries and arrays by
    identity.  Explore is the only consumer returning these rows across the
    fit boundary, so freeze them here rather than widening the raw facts-page
    contract.  JSON has only objects, arrays, and scalar leaves; tuples are
    copied too for defensive fixture/caller behavior.
    """
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return _FrozenJsonList(value)
    if isinstance(value, tuple):
        return tuple(_freeze_json(item) for item in value)
    return value


def _admissions_fit_fact_value_row(
    record: Any,
    *,
    allowed_school_ids: frozenset[int],
    allowed_fact_keys: frozenset[str],
) -> tuple[int, FactValueRow] | None:
    """Validate one optional fixed-key detail row without weakening page SQL.

    A page row remains a required result and is validated before the batch.
    In contrast, every row here is optional enrichment: its absence means the
    fit calculator falls back to the admit-rate baseline.  A nullable
    ``observed_at`` is possible in the reader view when its source page was
    never fetched, so an invalid detail row must not turn into a page-level
    Explore failure.
    """
    try:
        values = dict(record)
    except (TypeError, ValueError):
        logger.warning("admissions_fit_fact_row_dropped", reason="not_mapping")
        return None

    school_id = values.pop("school_id", None)
    fact_key = values.get("fact_key")
    if (
        isinstance(school_id, bool)
        or not isinstance(school_id, int)
        or school_id not in allowed_school_ids
        or not isinstance(fact_key, str)
        or fact_key not in allowed_fact_keys
    ):
        return None
    if "value" not in values:
        logger.warning(
            "admissions_fit_fact_row_dropped",
            school_id=school_id,
            fact_key=fact_key,
            reason="missing_value",
        )
        return None

    try:
        row = FactValueRow(**{**values, "value": _freeze_json(values["value"])})
    except (TypeError, ValueError, ValidationError):
        logger.warning(
            "admissions_fit_fact_row_dropped",
            school_id=school_id,
            fact_key=fact_key,
            reason="invalid_detail_row",
        )
        return None
    return school_id, row


async def explore_with_admissions_fit_facts(
    catalog: Catalog,
    main_statement: tuple[str, Sequence[Any]],
    *,
    max_page_size: int = MAX_ADMISSIONS_FIT_PAGE_SCHOOLS,
) -> tuple[tuple[asyncpg.Record, ...], Mapping[int, tuple[FactValueRow, ...]]]:
    """Read an Explore page and its estimator inputs in one database snapshot.

    The caller supplies exactly the code-owned *page* statement.  Ancillary
    Explore control/count/options/tail queries remain with :func:`explore`
    and therefore are intentionally not represented as sharing this
    snapshot.  This executor issues at most two SELECTs: the page statement,
    followed by one closed-key batch read for the page's school IDs.  The
    optional ``max_page_size`` is an explicit service boundary: the legacy
    two-argument call retains the 100-school default, while the Explore
    adapter supplies its own already-validated configured maximum.
    """
    page_cap = _validated_admissions_fit_page_cap(max_page_size)
    main_sql, main_params = main_statement
    async with (
        catalog.pool.acquire() as conn,
        conn.transaction(isolation="repeatable_read", readonly=True),
    ):
        page_rows = tuple(
            await conn.fetch(main_sql, *main_params)  # nosec B608 -- code-owned SQL, bound values
        )
        school_ids = _admissions_fit_page_school_ids(page_rows, max_page_size=page_cap)
        if not school_ids:
            return page_rows, MappingProxyType({})
        fact_records = await conn.fetch(
            _ADMISSIONS_FIT_FACTS_SQL,
            school_ids,
            list(ADMISSIONS_FIT_FACT_KEYS),
        )

    grouped: dict[int, list[FactValueRow]] = {school_id: [] for school_id in school_ids}
    allowed_school_ids = frozenset(school_ids)
    allowed_fact_keys = frozenset(ADMISSIONS_FIT_FACT_KEYS)
    for record in fact_records:
        parsed = _admissions_fit_fact_value_row(
            record,
            allowed_school_ids=allowed_school_ids,
            allowed_fact_keys=allowed_fact_keys,
        )
        if parsed is None:
            continue
        school_id, row = parsed
        grouped[school_id].append(row)
    return page_rows, MappingProxyType(
        {school_id: tuple(grouped[school_id]) for school_id in school_ids}
    )


async def majors(catalog: Catalog, query: str) -> tuple[tuple[str, int], ...]:
    """`GET /v1/schools/majors?q=` (plan §5.3) -- exact-prefix match on the
    school's own printed program name; no standard vocabulary exists."""
    async with catalog.pool.acquire() as conn:
        rows = await conn.fetch(_MAJORS_SQL, query)
    return tuple((row["m"], row["n"]) for row in rows)
