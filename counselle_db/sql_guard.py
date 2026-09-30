"""The read-only SQL guard for `query_database` -- the model-authored escape
hatch's allowlist/denylist over sqlglot's parsed AST (plan/ADR context: the
five-view reader contract, `docs/DATABASE_GUIDE.md`).

Re-pointed for school-data-v3 (plan §5.4/appendix F-ii): the CDS packet/
manifest/selected-document machinery this guard used to allow-list is gone
with the CDS Library reader views it protected. The five relations below are
their replacement -- `cds_library.current_school_facts` is reader-granted
(the `get_facts` service path reads it) but deliberately **not** allow-listed
here, because it carries a `value jsonb` column; `school_facts_sql` is the
long-form, jsonb-free surface `query_database` may actually touch.

"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from sqlglot import exp, parse
from sqlglot.errors import ParseError, TokenError

from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.models import FactCoverageRow, QueryResult, ServiceError
from domain.facts.state import MAJORS_MATCH_NOTE

__all__ = ["query_database"]

_ALLOWED_RELATIONS = frozenset(
    {
        "cds_library.school_profiles",
        "cds_library.school_facts_sql",
        "cds_library.school_explore",
        "cds_library.school_data_status",
        "cds_library.fact_coverage",
    }
)
_PLACEHOLDER_RE = re.compile(r"\$(\d+)")
_SAFE_FUNCTIONS = frozenset(
    {
        "abs",
        "and",
        "array",
        "array_contains_all",
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

# The one bytea-bearing column left in the five-view reader contract
# (`school_profiles.profile_sha256`). Guard it before asyncpg executes the
# statement: the post-fetch recursion in `query_database` remains a final
# backstop, but must never be the mechanism that prevents a hash from being
# materialized. (Plan appendix F-ii claims "no bytea column exists in any
# allow-listed relation" -- verified false against the live schema.)
_BYTEA_COLUMNS = frozenset({"profile_sha256"})
_BYTEA_RELATIONS = frozenset({"cds_library.school_profiles"})

# Internal jsonb provenance/plumbing columns, reachable through the
# allow-list with zero restriction (security review Finding 2):
# `school_profiles.basic_profile`, `school_profiles.profile_provenance`, and
# `school_data_status.tabs`. `profile_provenance` carries per-field IPEDS
# extraction plumbing (`file_sha256`, `chosen_source`, `normalization`,
# `source_column`) that was never meant to reach the model -- the same class
# of detail the deleted `_reject_packet_projection` used to keep off this
# surface, and the same reasoning the module docstring already applies to
# excluding `current_school_facts` from the allow-list outright.
# `basic_profile` is judged the same way rather than exposed via a narrow
# accessor: `get_school_profile` already serves its content typed and
# decoded (`counselle_db/service.py`'s `_walk_profile`), so `query_database`
# -- the raw escape hatch -- has no legitimate need to duplicate it as an
# unrestricted jsonb blob; blocking it outright is the simpler and safer
# choice, not a shortcut past a real need.
_JSON_COLUMNS = frozenset({"basic_profile", "profile_provenance", "tabs"})
_JSON_RELATIONS = frozenset(
    {"cds_library.school_profiles", "cds_library.school_data_status"}
)

_FACT_KEY_COLUMN = "fact_key"
_MAJORS_COLUMN = "majors"
# The real `fact_coverage` key for the majors list itself (verified live:
# `academics.undergraduate_majors`, 2219/2241 schools -- there is no
# `explore.*` row in `fact_coverage` and none can ever exist, since
# `rewrite_fact_coverage_counts` builds that table by `GROUP BY fact_key
# FROM school_facts`, which only ever emits real domain-style keys).
# `app/facts/explore_projection.py`'s `_FACT_KEY_MAP` confirms this key maps
# onto `school_explore.majors`, the exact column the membership predicate
# below tests. `academics.undergraduate_majors_count` is a different fact
# (a derived scalar), not the denominator for "do we have a majors list".
_MAJORS_FACT_KEY = "academics.undergraduate_majors"
_DENOMINATOR_UNAVAILABLE_NOTE = (
    "This ranking/aggregate has no bound fact key: denominator unavailable -- "
    "bind the fact key as a parameter and re-run, or state the number without "
    "a population claim."
)
# Plan §5.3/§6a/appendix F-ii: `MAJORS_MATCH_NOTE` (`domain/facts/state.py`)
# is the one canonical "matches on printed name" sentence, shared with
# `app/facts/service_explore.py`'s `/majors`/`/explore` HTTP responses --
# `domain/` sits below both `app/` and `counselle_db/` in ADR 0017's
# layering, so either may import it without a cycle.


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
                "octet_length(profile_sha256)."
            )
    for cast_expression in tree.find_all(exp.Cast):
        target = cast_expression.args.get("to")
        if isinstance(target, exp.DataType) and target.this in {
            exp.DataType.Type.BINARY,
            exp.DataType.Type.VARBINARY,
        }:
            raise ServiceError("Expressions returning binary/PDF bytes are not allowed.")


def _reject_json_projection(tree: exp.Query, relations: set[str]) -> None:
    """Reject projections that can return internal jsonb provenance/plumbing
    before the database is queried (security review Finding 2)."""
    unsafe_star = any(
        isinstance(expression, exp.Star)
        or (isinstance(expression, exp.Column) and isinstance(expression.this, exp.Star))
        for select in tree.find_all(exp.Select)
        for expression in select.expressions
    )
    if relations & _JSON_RELATIONS and unsafe_star:
        raise ServiceError(
            "Internal profile/provenance columns cannot be selected with *; "
            "name safe metadata columns."
        )
    for column in tree.find_all(exp.Column):
        if column.name.casefold() in _JSON_COLUMNS:
            raise ServiceError(
                "Internal profile/provenance jsonb columns cannot be projected; "
                "use get_school_profile for typed, decoded identity fields."
            )


def _reject_fact_key_substring_search(tree: exp.Query) -> None:
    """Fact keys are exact; a substring match must never masquerade as
    membership -- the v3 form of "membership is structural, never substring"
    (replaces the retired `_reject_manifest_text_search`, appendix F-ii)."""
    for predicate in tree.find_all(exp.Like, exp.ILike):
        if any(
            column.name.casefold() == _FACT_KEY_COLUMN
            for column in predicate.find_all(exp.Column)
        ):
            raise ServiceError(
                "Fact keys are exact; bind the key as a parameter instead of "
                "a LIKE/ILIKE pattern."
            )


def _is_known_fact_key(value: str, known: set[str]) -> bool:
    """A fact key is "known" only if it's a real key from the catalog
    (`CatalogSnapshot.fact_keys`, filled from `fact_coverage` -- which
    already excludes `explore.*` pseudo-keys, `counselle_db/catalog.py`'s
    `_FACT_COVERAGE_SQL`). There is no structural fallback any more: an
    `explore.<column>`-shaped string is not itself a `fact_key` row and
    can never exist in `fact_coverage` (verified live), so it is dropped
    like any other unresolved string rather than treated as a key -- that
    is what makes it impossible for a query to fabricate a denominator
    (appendix F-ii's intent, now actually enforced)."""
    return value in known


def _named_fact_keys(tree: exp.Query, params: list[Any], known: set[str]) -> tuple[str, ...]:
    """Fact keys this query names -- only catalog-known literals and
    catalog-known **bound params that are actually used inside a
    `fact_key = $n` / `fact_key IN (...)` predicate**, mirroring the scoping
    already applied to the literal half of this function (a literal only
    counts when it sits under an equality/IN test on the `fact_key` column).

    This is the safety property behind the denominator mechanism: an
    unresolved string, or a parameter bound to something other than
    `fact_key`, is ignored, so neither can ever fabricate a coverage claim
    that isn't backed by a real `fact_coverage` row.
    """
    named: set[str] = set()
    for predicate in tree.find_all(exp.EQ, exp.In):
        lhs = predicate.this
        if not (isinstance(lhs, exp.Column) and lhs.name.casefold() == _FACT_KEY_COLUMN):
            continue
        for literal in predicate.find_all(exp.Literal):
            if literal.is_string and _is_known_fact_key(str(literal.this), known):
                named.add(str(literal.this))
        for parameter in predicate.find_all(exp.Parameter):
            index_literal = parameter.this
            if not (isinstance(index_literal, exp.Literal) and index_literal.is_int):
                continue
            index = int(index_literal.this) - 1
            if not (0 <= index < len(params)):
                continue
            value = params[index]
            if isinstance(value, str) and _is_known_fact_key(value, known):
                named.add(value)
    return tuple(sorted(named))


def _needs_denominator(tree: exp.Query) -> bool:
    """A cross-school aggregate or ranking needs a stated population; a plain
    row read (e.g. one bound fact key, no aggregate) does not."""
    return tree.find(exp.AggFunc) is not None or tree.find(exp.Order) is not None


def _majors_membership_key(tree: exp.Query, relations: set[str]) -> str | None:
    """Detect a `majors @> ARRAY[...]` membership predicate over
    `school_explore` -- a school publishes its major list with no standard
    vocabulary, so this shape always carries the `academics.undergraduate_majors`
    denominator plus the printed-name caveat (appendix F-ii's "majors
    two-statement rule"), independent of whether the query is an aggregate.
    `@>` is the only array-membership operator in `_SAFE_FUNCTIONS`."""
    if "cds_library.school_explore" not in relations:
        return None
    for predicate in tree.find_all(exp.ArrayContainsAll):
        for column in (predicate.this, predicate.expression):
            if isinstance(column, exp.Column) and column.name.casefold() == _MAJORS_COLUMN:
                return _MAJORS_FACT_KEY
    return None


def _contains_binary(value: Any) -> bool:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return True
    if isinstance(value, dict):
        return any(_contains_binary(key) or _contains_binary(child) for key, child in value.items())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_binary(child) for child in value)
    return False


def _guard_sql_impl(sql: str, params: list[Any]) -> tuple[str, exp.Query, set[str]]:
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
            raise ServiceError(
                "Queries may use only the five schema-qualified facts store reader views."
            )
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
    _reject_json_projection(tree, relations)
    _reject_fact_key_substring_search(tree)
    return normalized, tree, relations


def _guard_sql(sql: str, params: list[Any]) -> str:
    return _guard_sql_impl(sql, params)[0]


async def query_database(
    catalog: Catalog, sql: str, params: list[Any] | None = None
) -> QueryResult:
    values = params or []
    safe_sql, tree, relations = _guard_sql_impl(sql, values)
    settings = _catalog_settings(catalog)
    known_fact_keys = set(catalog.snapshot.fact_keys)
    named_keys = set(_named_fact_keys(tree, values, known_fact_keys))
    majors_key = _majors_membership_key(tree, relations)
    if majors_key is not None:
        named_keys.add(majors_key)
    needs_denominator = _needs_denominator(tree)
    # The interpolated statement has passed the sqlglot relation/function/
    # statement allowlist above; every caller-supplied value remains an asyncpg
    # bind parameter. Only the code-owned row cap is added here.
    wrapped = f"SELECT * FROM ({safe_sql}) AS counselle_query LIMIT {settings.db_row_cap + 1}"  # nosec B608
    rows: list[tuple[Any, ...]] = []
    columns: tuple[str, ...] = ()
    truncated = False
    as_of = datetime.now(UTC)
    warning_parts = [
        "Raw query rows bypass typed normalization. Re-fetch named student-facing "
        "values through get_school_profile or get_facts; aggregates need as-of "
        "and coverage-denominator attribution."
    ]
    if needs_denominator and not named_keys:
        warning_parts.append(_DENOMINATOR_UNAVAILABLE_NOTE)
    if majors_key is not None:
        warning_parts.append(MAJORS_MATCH_NOTE)
    warning = " ".join(warning_parts)
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
                    "octet_length(profile_sha256)."
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
        coverage: tuple[FactCoverageRow, ...] = ()
        if named_keys and (needs_denominator or majors_key is not None):
            coverage_rows = await conn.fetch(
                "SELECT fact_key, schools_with_value, computed_at "
                "FROM cds_library.fact_coverage WHERE fact_key = ANY($1::text[])",
                sorted(named_keys),
            )
            # A ranking's denominator is every profiled school, not only the
            # ones with a CollegeData crawl (`fact_coverage.schools_total`):
            # "X out of all the schools Counselle knows" is the honest claim.
            coverage = tuple(
                FactCoverageRow(
                    fact_key=coverage_row["fact_key"],
                    schools_with_value=coverage_row["schools_with_value"],
                    schools_total=catalog.school_count,
                    as_of=coverage_row["computed_at"],
                )
                for coverage_row in coverage_rows
            )
    result = QueryResult(
        columns=columns,
        rows=tuple(rows),
        row_count=len(rows),
        truncated=truncated,
        as_of=as_of,
        warning=warning,
        coverage=coverage,
    )
    if len(result.model_dump_json().encode()) > settings.query_database_max_bytes:
        raise ServiceError("Query metadata exceeds the configured serialized-result limit.")
    return result
