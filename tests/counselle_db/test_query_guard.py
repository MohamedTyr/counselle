import pytest

from counselle_db.models import ServiceError
from counselle_db.service import _guard_sql


def test_query_guard_requires_qualified_allowlisted_view_and_bound_params() -> None:
    _guard_sql("SELECT name FROM cds_library.school_profiles WHERE id=$1", [1])
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
        "WHERE jsonb_typeof(packet->'metrics'->'applicants_total'->'value')=$1",
        ["number"],
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
