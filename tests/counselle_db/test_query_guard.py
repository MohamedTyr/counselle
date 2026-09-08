from typing import cast

import pytest
from sqlglot import exp, parse_one

from counselle_db.models import ServiceError
from counselle_db.sql_guard import (
    _guard_sql,
    _majors_membership_key,
    _named_fact_keys,
    _needs_denominator,
)


def _query(sql: str) -> exp.Query:
    return cast(exp.Query, parse_one(sql, read="postgres"))


def test_query_guard_requires_qualified_allowlisted_view_and_bound_params() -> None:
    _guard_sql("SELECT name FROM cds_library.school_profiles WHERE id=$1", [1])
    assert (
        _guard_sql("SELECT name FROM cds_library.school_profiles;", [])
        == "SELECT name FROM cds_library.school_profiles"
    )
    for sql, params in [
        ("SELECT * FROM school_profiles", []),
        ("SELECT * FROM cds_library.school_profiles; SELECT 1", []),
        ("SELECT fact_key FROM cds_library.school_facts_sql -- comment", []),
        ("SELECT name FROM cds_library.school_profiles WHERE id=$2", [1]),
    ]:
        with pytest.raises(ServiceError):
            _guard_sql(sql, params)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM pg_catalog.pg_class",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM cds_library.school_profiles, cds_library.school_facts_sql",
        "SELECT pg_sleep(1) FROM cds_library.school_profiles",
        "SELECT set_config('role','postgres',false) FROM cds_library.school_profiles",
        "SELECT * FROM cds_library.school_profiles FOR UPDATE",
        "WITH gone AS (DELETE FROM cds_library.school_profiles RETURNING *) SELECT * FROM gone",
        "COPY cds_library.school_profiles TO STDOUT",
        "SELECT * INTO TEMP x FROM cds_library.school_profiles",
        "SELECT * FROM cds_library.school_profiles /* hidden */",
    ],
)
def test_query_guard_rejects_catalog_writes_locks_functions_and_comments(sql: str) -> None:
    with pytest.raises(ServiceError):
        _guard_sql(sql, [])


@pytest.mark.parametrize(
    "sql",
    [
        # `current_school_facts` is reader-granted but deliberately not
        # allow-listed -- it carries `value jsonb`, which `query_database`
        # must never be able to project (appendix F-ii).
        "SELECT value FROM cds_library.current_school_facts WHERE fact_key=$1",
        "SELECT * FROM cds_library.current_school_facts",
        "WITH x AS (SELECT value FROM cds_library.current_school_facts) SELECT * FROM x",
        # Base tables behind the reader views are never directly reachable.
        "SELECT * FROM cds_library.schools",
        "SELECT * FROM cds_library.school_facts",
        "SELECT * FROM cds_library.school_pages",
        "SELECT * FROM cds_library.facts_jobs",
        "SELECT * FROM cds_library.school_explore_rows",
        "SELECT * FROM cds_library.fact_coverage_counts",
    ],
)
def test_query_guard_rejects_current_school_facts_and_base_tables(sql: str) -> None:
    with pytest.raises(ServiceError, match="five schema-qualified"):
        _guard_sql(sql, ["admissions.rate"] if "$1" in sql else [])


def test_query_guard_accepts_allowlisted_ctes_joins_and_safe_aggregates() -> None:
    _guard_sql(
        """WITH facts AS (
               SELECT school_id,fact_key,value_num FROM cds_library.school_facts_sql
               WHERE fact_key=$1
             )
             SELECT p.state,avg(f.value_num)
             FROM facts f
             JOIN cds_library.school_profiles p ON p.id=f.school_id
             GROUP BY p.state""",
        ["admissions.rate"],
    )


def test_query_guard_accepts_typed_explore_filters_and_profile_join() -> None:
    _guard_sql(
        """SELECT p.name,e.admit_rate
             FROM cds_library.school_explore e
             JOIN cds_library.school_profiles p ON p.id=e.school_id
             WHERE e.control=$1 AND e.cost_attendance_out_of_state<$2
             ORDER BY e.admit_rate ASC LIMIT $3""",
        ["public", 30000, 25],
    )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT fact_key FROM cds_library.school_facts_sql WHERE fact_key LIKE $1",
        "SELECT fact_key FROM cds_library.school_facts_sql WHERE fact_key ILIKE $1",
        "SELECT fact_key FROM cds_library.fact_coverage WHERE fact_key LIKE $1",
        "SELECT fact_key FROM cds_library.school_facts_sql WHERE $1 LIKE fact_key",
        "WITH f AS (SELECT fact_key FROM cds_library.school_facts_sql) "
        "SELECT fact_key FROM f WHERE fact_key ILIKE $1",
    ],
)
def test_query_guard_rejects_like_and_ilike_on_fact_key(sql: str) -> None:
    with pytest.raises(ServiceError, match="exact"):
        _guard_sql(sql, ["%admissions%"])


def test_query_guard_allows_like_on_non_fact_key_columns() -> None:
    """The fact-key rejector is targeted, not a blanket LIKE ban -- a label
    substring search over a non-membership column is still ordinary SQL."""
    _guard_sql(
        "SELECT label FROM cds_library.school_facts_sql WHERE label ILIKE $1",
        ["%tuition%"],
    )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT profile_sha256 FROM cds_library.school_profiles",
        "SELECT profile_sha256 AS payload FROM cds_library.school_profiles",
        "SELECT s.profile_sha256 FROM cds_library.school_profiles AS s",
        "SELECT * FROM cds_library.school_profiles",
        "SELECT s.* FROM cds_library.school_profiles AS s",
        "WITH source AS (SELECT * FROM cds_library.school_profiles) "
        "SELECT id FROM source",
        "WITH source AS (SELECT profile_sha256 AS payload "
        "FROM cds_library.school_profiles) SELECT payload FROM source",
        "SELECT CAST('abc' AS bytea) FROM cds_library.school_profiles",
    ],
)
def test_query_guard_rejects_binary_projection_before_execution(sql: str) -> None:
    with pytest.raises(ServiceError, match="Binary|binary"):
        _guard_sql(sql, [])


def test_query_guard_allows_octet_length_of_binary_column() -> None:
    _guard_sql("SELECT octet_length(profile_sha256) FROM cds_library.school_profiles", [])


@pytest.mark.parametrize(
    "sql",
    [
        # Security review Finding 2: internal jsonb provenance/plumbing was
        # reachable through the allow-list with zero restriction.
        "SELECT basic_profile FROM cds_library.school_profiles",
        "SELECT profile_provenance FROM cds_library.school_profiles",
        "SELECT s.profile_provenance FROM cds_library.school_profiles AS s",
        "SELECT tabs FROM cds_library.school_data_status",
        # `school_profiles` also carries `profile_sha256` (bytea), so its
        # `*` case is exercised by the binary-projection test above; here we
        # cover the json-only relation's `*` case.
        "SELECT * FROM cds_library.school_data_status",
        "WITH source AS (SELECT * FROM cds_library.school_data_status) "
        "SELECT school_id FROM source",
        "WITH source AS (SELECT profile_provenance AS payload "
        "FROM cds_library.school_profiles) SELECT payload FROM source",
    ],
)
def test_query_guard_rejects_internal_json_projection_before_execution(sql: str) -> None:
    with pytest.raises(ServiceError, match="Internal profile/provenance"):
        _guard_sql(sql, [])


def test_query_guard_still_allows_safe_school_profiles_columns() -> None:
    """Finding 2's fix must not regress ordinary reads of the same relation."""
    _guard_sql("SELECT id,name,city,state FROM cds_library.school_profiles WHERE id=$1", [1])


@pytest.mark.parametrize(
    ("sql", "params"),
    [
        ("SELECT * FROM cds_library.school_profiles WHERE id=$1 OR id=$3", [1, 2, 3]),
        ("SELECT * FROM cds_library.school_profiles WHERE id=$1", []),
        ("SELECT * FROM cds_library.school_profiles", [1]),
        ("SELECT * FROM cds_library.school_profiles WHERE id='$1'", [1]),
    ],
)
def test_query_guard_requires_exact_ast_placeholders(sql: str, params: list[object]) -> None:
    with pytest.raises(ServiceError, match="placeholders"):
        _guard_sql(sql, params)


def test_query_guard_fails_closed_on_tokenizer_errors() -> None:
    with pytest.raises(ServiceError, match="safe SELECT/WITH"):
        _guard_sql(
            "SELECT fact_key->$1->>($2||$3) FROM cds_library.school_facts_sql",
            ["metrics", "diagnostic", "_code"],
        )


# --- `_named_fact_keys` -- the denominator mechanism's safety property ---
#
# `CatalogSnapshot.fact_keys` is filled from `fact_coverage` (school-data-v3
# Phase 3, Unit B) and already excludes `explore.*` pseudo-keys
# (`counselle_db/catalog.py`'s `_FACT_COVERAGE_SQL`). These tests exercise
# `_named_fact_keys` directly against an explicit `known` set -- `set(
# catalog.snapshot.fact_keys)`'s real shape, whether empty or populated --
# and prove the fail-closed property the task calls for: with
# `known=set()`, no string is ever treated as a named key, no matter its
# shape -- there is no structural fallback any more (security review
# Finding 1: an `explore.<column>`-shaped string used to bypass the catalog
# entirely and could silence the denominator note on an unrelated bound
# parameter). See `test_foundation_regressions.py`'s
# `test_query_database_cross_school_aggregate_carries_named_key_coverage` for
# the same property exercised through `query_database` end to end with a
# non-empty `fact_keys`.


def test_named_fact_keys_fails_closed_on_domain_style_keys_when_catalog_is_empty() -> None:
    tree = _query("SELECT count(*) FROM cds_library.school_facts_sql WHERE fact_key=$1")
    assert _named_fact_keys(tree, ["admissions.rate"], known=set()) == ()
    assert _named_fact_keys(tree, ["not.a.real.key"], known=set()) == ()


def test_named_fact_keys_resolves_domain_key_once_catalog_knows_it() -> None:
    tree = _query("SELECT count(*) FROM cds_library.school_facts_sql WHERE fact_key=$1")
    assert _named_fact_keys(tree, ["admissions.rate"], known={"admissions.rate"}) == (
        "admissions.rate",
    )


def test_named_fact_keys_fails_closed_on_explore_shaped_strings_even_bound_or_literal() -> None:
    """Finding 1 regression: an `explore.*`-shaped string is not a real
    `fact_key` row (verified live -- `fact_coverage` has zero `explore.*`
    rows and can never have any) and must never resolve without a catalog
    hit, whether it arrives as a bound param or a literal."""
    bound = _query(
        "SELECT count(*) FROM cds_library.school_explore, cds_library.school_facts_sql "
        "WHERE fact_key=$1"
    )
    assert _named_fact_keys(bound, ["explore.admit_rate"], known=set()) == ()
    literal = _query(
        "SELECT count(*) FROM cds_library.school_facts_sql WHERE fact_key='explore.admit_rate'"
    )
    assert _named_fact_keys(literal, [], known=set()) == ()


def test_named_fact_keys_ignores_unresolved_strings_and_reads_in_list_literals() -> None:
    tree = _query(
        "SELECT count(*) FROM cds_library.school_facts_sql "
        "WHERE fact_key IN ('admissions.rate','not_a_real_key')"
    )
    assert _named_fact_keys(tree, [], known={"admissions.rate"}) == ("admissions.rate",)


def test_named_fact_keys_ignores_a_bound_param_not_used_in_a_fact_key_predicate() -> None:
    """Finding 1's param-scanning scope fix: a catalog-known string bound to
    an unrelated column (e.g. `state`) must never count as a named fact key
    just because it happens to also be a known key string -- only a param
    actually used inside a `fact_key = $n` / `fact_key IN (...)` predicate
    counts, mirroring the scoping already applied to the literal half."""
    tree = _query("SELECT count(*) FROM cds_library.school_profiles WHERE state=$1")
    assert _named_fact_keys(tree, ["admissions.rate"], known={"admissions.rate"}) == ()


def test_named_fact_keys_resolves_bound_param_used_in_a_fact_key_in_list() -> None:
    tree = _query(
        "SELECT count(*) FROM cds_library.school_facts_sql WHERE fact_key IN ($1, $2)"
    )
    assert _named_fact_keys(
        tree, ["admissions.rate", "not_a_real_key"], known={"admissions.rate"}
    ) == ("admissions.rate",)


def test_needs_denominator_true_for_aggregate_or_order_false_otherwise() -> None:
    assert _needs_denominator(_query("SELECT count(*) FROM cds_library.school_profiles"))
    assert _needs_denominator(_query("SELECT id FROM cds_library.school_profiles ORDER BY id"))
    assert not _needs_denominator(
        _query("SELECT id FROM cds_library.school_profiles WHERE id=$1")
    )


def test_majors_membership_key_detects_array_contains_over_explore_majors() -> None:
    tree = _query("SELECT name FROM cds_library.school_explore WHERE majors @> ARRAY[$1]")
    assert (
        _majors_membership_key(tree, {"cds_library.school_explore"})
        == "academics.undergraduate_majors"
    )


def test_majors_membership_key_ignores_other_columns_and_other_relations() -> None:
    not_majors = _query(
        "SELECT name FROM cds_library.school_explore WHERE sports_women @> ARRAY[$1]"
    )
    assert _majors_membership_key(not_majors, {"cds_library.school_explore"}) is None

    wrong_relation = _query("SELECT school_id FROM cds_library.school_facts_sql WHERE fact_key=$1")
    assert _majors_membership_key(wrong_relation, {"cds_library.school_facts_sql"}) is None


def test_query_guard_accepts_majors_array_containment_over_explore() -> None:
    _guard_sql(
        "SELECT name FROM cds_library.school_explore WHERE majors @> ARRAY[$1]",
        ["Nursing"],
    )
