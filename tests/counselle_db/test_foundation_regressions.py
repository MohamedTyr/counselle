from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from counselle_db.catalog import Catalog, SchoolRecord, _freeze, normalize_school_name
from counselle_db.models import SchoolBasics, ServiceError
from counselle_db.service import _display_profile, _walk_profile, query_database, resolve_school


def test_profile_display_rejects_blank_strings_and_empty_lists() -> None:
    assert _display_profile("") is None
    assert _display_profile("   ") is None
    assert _display_profile([]) is None
    assert _display_profile(["Duke", "University"]) == "Duke, University"


class _Context:
    def __init__(self, value: object) -> None:
        self.value = value

    async def __aenter__(self) -> object:
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


class _QueryConnection:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self.records = records
        self.bound: tuple[Any, ...] = ()
        self.fetch_count = 0

    def transaction(self, **_: object) -> _Context:
        return _Context(self)

    async def execute(self, *_: object) -> None:
        return None

    async def fetch(self, _sql: str, *params: Any) -> list[dict[str, Any]]:
        self.fetch_count += 1
        self.bound = params
        return self.records


class _Pool:
    def __init__(self, connection: _QueryConnection) -> None:
        self.connection = connection

    def acquire(self) -> _Context:
        return _Context(self.connection)


def _query_catalog(records: list[dict[str, Any]]) -> tuple[Any, _QueryConnection]:
    connection = _QueryConnection(records)
    return SimpleNamespace(pool=_Pool(connection)), connection


async def test_query_database_passes_params_separately_and_applies_row_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog, connection = _query_catalog([{"id": 1}, {"id": 2}, {"id": 3}])
    monkeypatch.setattr(
        "counselle_db.service.get_settings",
        lambda: SimpleNamespace(
            db_row_cap=2,
            query_database_max_bytes=10_000,
            db_statement_timeout_ms=100,
        ),
    )
    result = await query_database(
        cast(Any, catalog),
        "SELECT id FROM cds_library.school_profiles WHERE state=$1",
        ["MA' OR true --"],
    )
    assert connection.bound == ("MA' OR true --",)
    assert result.row_count == 2
    assert result.truncated


async def test_query_database_caps_complete_serialized_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog, _ = _query_catalog(
        [{"very_long_column_name": "x" * 800}, {"very_long_column_name": "ok"}]
    )
    monkeypatch.setattr(
        "counselle_db.service.get_settings",
        lambda: SimpleNamespace(
            db_row_cap=500,
            query_database_max_bytes=700,
            db_statement_timeout_ms=100,
        ),
    )
    result = await query_database(
        cast(Any, catalog), "SELECT name FROM cds_library.school_profiles"
    )
    assert result.rows == ()
    assert result.truncated
    assert len(result.model_dump_json().encode()) <= 700


async def test_query_database_rejects_nested_binary_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog, _ = _query_catalog([{"packet": {"content": memoryview(b"pdf")}}])
    monkeypatch.setattr(
        "counselle_db.service.get_settings",
        lambda: SimpleNamespace(
            db_row_cap=500,
            query_database_max_bytes=10_000,
            db_statement_timeout_ms=100,
        ),
    )
    with pytest.raises(ServiceError, match="Binary/PDF"):
        await query_database(
            cast(Any, catalog), "SELECT packet FROM cds_library.active_cds_domain_packets"
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pdf_content FROM cds_library.cds_document_sources",
        "SELECT source.* FROM cds_library.cds_document_sources AS source",
        "WITH source AS (SELECT * FROM cds_library.cds_document_sources) "
        "SELECT document_id FROM source",
    ],
)
async def test_query_database_rejects_pdf_projection_before_fetch(
    sql: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog, connection = _query_catalog([])
    monkeypatch.setattr(
        "counselle_db.service.get_settings",
        lambda: SimpleNamespace(
            db_row_cap=500,
            query_database_max_bytes=10_000,
            db_statement_timeout_ms=100,
        ),
    )
    with pytest.raises(ServiceError, match="Binary/PDF"):
        await query_database(cast(Any, catalog), sql)
    assert connection.fetch_count == 0


def test_snapshot_json_is_deeply_frozen() -> None:
    source = {"group": {"nested": [1, {"value": 2}]}}
    frozen = _freeze(source)
    source["group"]["nested"][1]["value"] = 3  # type: ignore[index]
    assert frozen["group"]["nested"][1]["value"] == 2
    with pytest.raises(TypeError):
        frozen["group"]["nested"][1]["value"] = 4


def test_profile_walk_is_recursive_safe_and_attaches_matching_provenance() -> None:
    profile = {
        "homepage": "https://example.edu",
        "flags": [True, False],
        "unsafe": [{"nested": "object"}],
    }
    provenance = {
        "official_links": {
            "homepage": {"source_column": "Official homepage", "chosen_source": "IPEDS"}
        }
    }
    rows = _walk_profile("official_links", profile, provenance)
    by_ref = {row.ref: row for row in rows}
    homepage = by_ref["official_links.homepage"]
    assert homepage.label == "Official homepage"
    assert homepage.provenance == provenance["official_links"]["homepage"]
    assert homepage.caveat_kinds == ("profile_snapshot",)
    assert by_ref["official_links.flags"].display == "Yes, No"
    assert not by_ref["official_links.unsafe"].available


async def test_exact_alias_collision_returns_candidates_without_campus_guessing() -> None:
    records = tuple(
        SimpleNamespace(
            basics=SchoolBasics(unitid=unitid, name=name),
            aliases=("State University",),
        )
        for unitid, name in ((1, "State University Main"), (2, "State University City"))
    )
    catalog = SimpleNamespace(
        resolve_candidates=lambda query: records,
        snapshot=SimpleNamespace(schools={1: records[0], 2: records[1]}),
    )
    result = await resolve_school(cast(Any, catalog), "State University")
    assert result.status == "candidates"
    assert [candidate.unitid for candidate in result.candidates] == [1, 2]


def test_catalog_resolver_handles_unitid_alias_prefix_fuzzy_and_not_found() -> None:
    records = {
        1: SchoolRecord(
            basics=SchoolBasics(unitid=1, name="Example University", state="MA"),
            aliases=("EU",),
            search_name="example university",
            is_main_campus=True,
            basic_profile={},
            profile_version="v1",
            profile_snapshot_date=datetime.now(UTC).date(),
            profile_sha256="00" * 32,
        ),
        2: SchoolRecord(
            basics=SchoolBasics(unitid=2, name="Example University Downtown", state="MA"),
            aliases=(),
            search_name="example university downtown",
            is_main_campus=False,
            basic_profile={},
            profile_version="v1",
            profile_snapshot_date=datetime.now(UTC).date(),
            profile_sha256="11" * 32,
        ),
    }
    names: dict[str, tuple[int, ...]] = {}
    for unitid, record in records.items():
        for name in (record.basics.name, record.search_name, *record.aliases):
            normalized = normalize_school_name(name)
            names[normalized] = (*names.get(normalized, ()), unitid)
    catalog = Catalog(
        cast(Any, object()),
        cast(
            Any,
            SimpleNamespace(
                refreshed_at=datetime.now(UTC), schools=records, name_index=names
            ),
        ),
    )
    assert [item.basics.unitid for item in catalog.resolve_candidates("1")] == [1]
    assert [item.basics.unitid for item in catalog.resolve_candidates("EU")] == [1]
    assert [item.basics.unitid for item in catalog.resolve_candidates("Example University")] == [1]
    assert catalog.resolve_candidates("Exampel University")[0].basics.unitid == 1
    assert catalog.resolve_candidates("zzzzzz") == ()


async def test_catalog_refresh_is_atomic_and_failed_refresh_keeps_truthful_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = SimpleNamespace(refreshed_at=datetime.now(UTC) - timedelta(hours=2), domains=())
    catalog = Catalog(cast(Any, object()), cast(Any, original))
    monkeypatch.setattr(
        "counselle_db.catalog.get_settings",
        lambda: SimpleNamespace(data_catalog_refresh_seconds=1),
    )

    async def fail(_pool: object) -> object:
        raise RuntimeError("boom")

    monkeypatch.setattr(Catalog, "_load_snapshot", staticmethod(fail))
    assert cast(Any, await catalog.maybe_refresh(force=True)) is original
    assert catalog.snapshot.refreshed_at == original.refreshed_at

    fresh = SimpleNamespace(refreshed_at=datetime.now(UTC), domains=())

    async def succeed(_pool: object) -> object:
        return fresh

    monkeypatch.setattr(Catalog, "_load_snapshot", staticmethod(succeed))
    assert cast(Any, await catalog.maybe_refresh(force=True)) is fresh
    assert cast(Any, catalog.snapshot) is fresh


def test_migration_0012_drops_only_retired_objects_and_rollback_is_loud() -> None:
    root = Path(__file__).parents[2]
    migration = (root / "migrations/0012_drop_old_db_objects.sql").read_text()
    rollback = (root / "migrations/0012_drop_old_db_objects.rollback.sql").read_text()
    assert "DROP FUNCTION IF EXISTS counselle.decode_ipeds" in migration
    assert "DROP FUNCTION IF EXISTS counselle.value_vintage" in migration
    assert "DROP TABLE IF EXISTS counselle.field_index" in migration
    assert "RAISE EXCEPTION" in rollback
    assert "not SQL-reversible" in rollback


def test_setup_db_reconciles_existing_roles_and_legacy_authority() -> None:
    setup = (Path(__file__).parents[2] / "scripts/setup_db.sql").read_text()

    for role in ("counselle_ro", "counselle_app"):
        assert f"ALTER ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE" in setup
        assert f"ALTER ROLE {role} RESET ALL" in setup
        assert f"ALTER ROLE {role} IN DATABASE counselle_data RESET ALL" in setup
    assert "granted.rolname <> 'cds_library_reader'" in setup
    assert "REVOKE %I FROM counselle_app" in setup
    assert "REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I" in setup
    assert "REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I" in setup
    assert "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I" in setup
    assert "ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I" in setup
    assert "GRANT cds_library_reader TO counselle_ro" in setup
