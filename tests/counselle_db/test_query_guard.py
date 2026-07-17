import pytest

from counselle_db.models import ServiceError
from counselle_db.service import _guard_sql


def test_query_guard_requires_qualified_allowlisted_view_and_bound_params() -> None:
    _guard_sql("SELECT name FROM cds_library.school_profiles WHERE id=$1", [1])
    assert (
        _guard_sql("SELECT name FROM cds_library.school_profiles;", [])
        == "SELECT name FROM cds_library.school_profiles"
    )
    for sql, params in [
        ("SELECT * FROM school_profiles", []),
        ("SELECT * FROM cds_library.school_profiles; SELECT 1", []),
        ("SELECT pdf_content FROM cds_library.cds_document_sources -- bytes", []),
        ("SELECT name FROM cds_library.school_profiles WHERE id=$2", [1]),
    ]:
        with pytest.raises(ServiceError):
            _guard_sql(sql, params)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM pg_catalog.pg_class",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM cds_library.school_profiles, cds_library.active_cds_documents",
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


def test_query_guard_accepts_allowlisted_ctes_joins_and_safe_aggregates() -> None:
    _guard_sql(
        """WITH profiles AS (
               SELECT id,state FROM cds_library.school_profiles WHERE state=$1
             )
             SELECT p.state,count(*)
             FROM profiles p
             JOIN cds_library.active_cds_documents d ON d.school_id=p.id
             GROUP BY p.state""",
        ["MA"],
    )


def test_query_guard_accepts_jsonb_traversal_and_parameter_casts() -> None:
    _guard_sql(
        "SELECT packet->'metrics'->>$1 FROM cds_library.active_cds_domain_packets "
        "WHERE school_id=$2::int",
        ["admissions.rate", 1],
    )
    _guard_sql(
        "SELECT octet_length(pdf_content) FROM cds_library.cds_document_sources",
        [],
    )
    _guard_sql(
        "SELECT school_id FROM cds_library.active_cds_domain_packets "
        "WHERE jsonb_typeof(packet->'metrics'->'applicants_total'->'value')=$1 "
        "OR packet->'metrics'->'applicants_total'->>'extraction_status'=$1",
        ["number"],
    )


def test_query_guard_requires_exact_structural_manifest_metric_membership() -> None:
    _guard_sql(
        """SELECT jsonb_path_exists(
               m.content,
               '$.domains[*].metrics[*] ? (@.id == $ref)',
               jsonb_build_object('ref', to_jsonb($1::text))
             ) AS metric_ref_present
             FROM cds_library.cds_manifest_snapshots m
             WHERE m.is_current""",
        ["financial_aid.need_blind"],
    )
    with pytest.raises(ServiceError, match="exact structural JSON membership"):
        _guard_sql(
            "SELECT content::text ILIKE $1 "
            "FROM cds_library.cds_manifest_snapshots WHERE is_current",
            ["%financial_aid.need_blind%"],
        )
    with pytest.raises(ServiceError, match="packet JSON|packet json|packet"):
        _guard_sql(
            "SELECT jsonb_path_exists(packet, '$.provider_contract') "
            "FROM cds_library.active_cds_domain_packets",
            [],
        )
    with pytest.raises(ServiceError, match="exact bound manifest"):
        _guard_sql(
            "SELECT jsonb_path_exists(m.content, '$.domains[*].metrics[*].description') "
            "FROM cds_library.cds_manifest_snapshots m",
            [],
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT packet FROM cds_library.active_cds_domain_packets",
        "SELECT packet->'metrics' FROM cds_library.active_cds_domain_packets",
        "SELECT packet->'provider_contract'->'requested_domains' "
        "FROM cds_library.active_cds_domain_packets",
        "SELECT packet->'metrics'->'admissions.rate'->>'diagnostic_code' "
        "FROM cds_library.active_cds_domain_packets",
        "SELECT packet->'metrics'->'admissions.rate'->'evidence'->>'excerpt' "
        "FROM cds_library.active_cds_domain_packets",
        "WITH candidate AS (SELECT packet->'metrics'->'admissions.rate' AS metric "
        "FROM cds_library.active_cds_domain_packets) SELECT metric FROM candidate",
        "WITH candidate AS (SELECT packet->'metrics'->'admissions.rate' AS metric "
        "FROM cds_library.active_cds_domain_packets), renamed AS "
        "(SELECT metric AS payload FROM candidate) SELECT payload FROM renamed",
    ],
)
def test_query_guard_rejects_packet_objects_and_internal_paths(sql: str) -> None:
    with pytest.raises(ServiceError, match="Packet|packet|internal"):
        _guard_sql(sql, [])


@pytest.mark.parametrize(
    ("sql", "params"),
    [
        (
            "SELECT packet -> ($1 || $2) ->> 'response_schema' "
            "FROM cds_library.active_cds_domain_packets",
            ["provider_", "contract"],
        ),
        (
            "SELECT packet -> 'metrics' -> $1 ->> ($2 || $3) "
            "FROM cds_library.active_cds_domain_packets",
            ["admissions.rate", "diagnostic", "_code"],
        ),
        (
            "SELECT packet -> 'metrics' -> $1 -> ($2 || $3) ->> 'excerpt' "
            "FROM cds_library.active_cds_domain_packets",
            ["admissions.rate", "evi", "dence"],
        ),
        (
            "WITH candidate AS ("
            "SELECT packet->'metrics'->$1 AS metric "
            "FROM cds_library.active_cds_domain_packets) "
            "SELECT metric->>($2 || $3) FROM candidate",
            ["admissions.rate", "diagnostic", "_code"],
        ),
    ],
)
def test_query_guard_rejects_computed_packet_path_steps(
    sql: str, params: list[object]
) -> None:
    with pytest.raises(ServiceError, match="Packet JSON paths"):
        _guard_sql(sql, params)


def test_query_guard_accepts_documented_scalar_packet_candidate_query() -> None:
    _guard_sql(
        """WITH candidates AS (
             SELECT school_id, packet->'metrics'->$2 AS metric
             FROM cds_library.active_cds_domain_packets
             WHERE domain_id=$1
           ), verified AS (
             SELECT school_id, metric->'value' AS value
             FROM candidates
             WHERE metric->>'extraction_status'='verified'
               AND metric->>'availability_status'='reported'
               AND jsonb_typeof(metric->'value')='number'
           )
           SELECT school_id, value FROM verified ORDER BY value DESC LIMIT $3""",
        ["admissions", "admissions.rate", 10],
    )


def test_query_guard_accepts_canonical_selected_document_ranking() -> None:
    _guard_sql(
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC, document_id DESC
           ), candidates AS (
             SELECT d.school_id, d.packet->'metrics'->$2 AS metric
             FROM cds_library.active_cds_domain_packets d
             JOIN selected s
               ON s.school_id=d.school_id AND s.document_id=d.document_id
             WHERE d.domain_id=$1
           )
           SELECT school_id, metric->>'value' AS value
           FROM candidates ORDER BY value DESC LIMIT $3""",
        ["admissions", "admissions.rate", 10],
    )


@pytest.mark.parametrize(
    "selected_sql",
    [
        """SELECT school_id, document_id
             FROM cds_library.active_cds_documents""",
        """SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC""",
        """SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             WHERE academic_year > 2020
             ORDER BY school_id, academic_year DESC, document_id DESC""",
    ],
)
def test_query_guard_rejects_rankings_without_canonical_selected_document_cte(
    selected_sql: str,
) -> None:
    sql = f"""WITH selected AS ({selected_sql})
              SELECT d.school_id, d.packet->'metrics'->$1->>'value' AS value
              FROM cds_library.active_cds_domain_packets d
              JOIN selected s
                ON s.school_id=d.school_id AND s.document_id=d.document_id
              ORDER BY value DESC LIMIT $2"""
    with pytest.raises(ServiceError, match="canonical selected-document"):
        _guard_sql(sql, ["admissions.rate", 10])


def test_query_guard_rejects_selected_document_ranking_with_inexact_packet_join() -> None:
    sql = """WITH selected AS (
               SELECT DISTINCT ON (school_id) school_id, document_id
               FROM cds_library.active_cds_documents
               ORDER BY school_id, academic_year DESC, document_id DESC
             )
             SELECT d.school_id, d.packet->'metrics'->$1->>'value' AS value
             FROM cds_library.active_cds_domain_packets d
             JOIN selected s ON s.school_id=d.school_id
             ORDER BY value DESC LIMIT $2"""
    with pytest.raises(ServiceError, match=r"school_id \+ document_id"):
        _guard_sql(sql, ["admissions.rate", 10])


def test_query_guard_rejects_direct_cross_school_document_packet_ranking() -> None:
    sql = """SELECT p.school_id, p.packet->'metrics'->$1->>'value' AS value
             FROM cds_library.active_cds_domain_packets p
             JOIN cds_library.active_cds_documents d ON d.school_id=p.school_id
             ORDER BY value DESC LIMIT $2"""
    with pytest.raises(ServiceError, match="selected-per-school"):
        _guard_sql(sql, ["admissions.rate", 10])


def test_query_guard_rejects_direct_ranking_hidden_in_cte() -> None:
    sql = """WITH ranked AS (
               SELECT p.school_id, p.packet->'metrics'->$1->>'value' AS value
               FROM cds_library.active_cds_domain_packets p
               JOIN cds_library.active_cds_documents d ON d.school_id=p.school_id
               ORDER BY value DESC LIMIT $2
             )
             SELECT school_id, value FROM ranked"""
    with pytest.raises(ServiceError, match="selected-per-school"):
        _guard_sql(sql, ["admissions.rate", 10])


def test_query_guard_keeps_single_school_and_aggregate_document_packet_reads() -> None:
    _guard_sql(
        """SELECT p.document_id
             FROM cds_library.active_cds_domain_packets p
             JOIN cds_library.active_cds_documents d
               ON d.school_id=p.school_id AND d.document_id=p.document_id
             WHERE p.school_id=$1
             ORDER BY d.academic_year DESC LIMIT $2""",
        [1, 1],
    )
    _guard_sql(
        """SELECT count(*)
             FROM cds_library.active_cds_domain_packets p
             JOIN cds_library.active_cds_documents d
               ON d.school_id=p.school_id AND d.document_id=p.document_id""",
        [],
    )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pdf_content FROM cds_library.cds_document_sources",
        "SELECT pdf_content AS payload FROM cds_library.cds_document_sources",
        "SELECT s.pdf_content FROM cds_library.cds_document_sources AS s",
        "SELECT * FROM cds_library.cds_document_sources",
        "SELECT s.* FROM cds_library.cds_document_sources AS s",
        "WITH source AS (SELECT * FROM cds_library.cds_document_sources) "
        "SELECT document_id FROM source",
        "WITH source AS (SELECT pdf_content AS payload "
        "FROM cds_library.cds_document_sources) SELECT payload FROM source",
        "SELECT pdf_sha256 FROM cds_library.active_cds_documents",
        "SELECT content_sha256 FROM cds_library.cds_manifest_snapshots",
        "SELECT profile_sha256 FROM cds_library.school_profiles",
        "SELECT CAST('abc' AS bytea) FROM cds_library.school_profiles",
    ],
)
def test_query_guard_rejects_binary_projection_before_execution(sql: str) -> None:
    with pytest.raises(ServiceError, match="Binary|binary"):
        _guard_sql(sql, [])


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
            "SELECT packet->$1->>($2||$3) FROM cds_library.active_cds_domain_packets",
            ["metrics", "diagnostic", "_code"],
        )
