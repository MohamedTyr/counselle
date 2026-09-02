from __future__ import annotations

from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from counselle_db.catalog import Catalog
from counselle_db.models import SchoolBasics, ServiceError
from counselle_db.packets import ManifestSnapshot, compile_manifest
from counselle_db.service import get_domain


class _AsyncContext:
    def __init__(self, value: object) -> None:
        self.value = value

    async def __aenter__(self) -> object:
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


def _manifest_content(
    version: str,
    *,
    description: str = "Admission rate",
    binder: bool = False,
) -> dict[str, Any]:
    contexts = (
        [{"id": "admissions.term", "label": "Term", "refs": ["enrollment.term"]}] if binder else []
    )
    domains = [
        {
            "id": "admissions",
            "title": "Admissions",
            "metrics": [
                {
                    "id": "admissions.rate",
                    "description": description,
                    "type": "number",
                    "unit": "percent",
                    "contexts": contexts,
                }
            ],
        }
    ]
    if binder:
        domains.append(
            {
                "id": "enrollment",
                "title": "Enrollment",
                "metrics": [
                    {
                        "id": "enrollment.term",
                        "description": "Reporting term",
                        "type": "string",
                    }
                ],
            }
        )
    return {"root": {"version": version}, "domains": domains}


def _manifest_row(
    version: str,
    *,
    current: bool,
    description: str = "Admission rate",
    binder: bool = False,
) -> dict[str, Any]:
    content = _manifest_content(version, description=description, binder=binder)
    return {
        "version": version,
        "content_sha256": b"m" * 32,
        "content": content,
        "domain_hashes": {domain["id"]: b"d" * 32 for domain in content["domains"]},
        "published_at": datetime(2026, 1, 1, tzinfo=UTC),
        "extractor_contract_version": "packet-v1",
        "is_current": current,
    }


def _profile_row(unitid: int = 1) -> dict[str, Any]:
    return {
        "id": unitid,
        "name": "Example University",
        "aliases": ["Example U"],
        "city": "Boston",
        "state": "MA",
        "search_name": "example university",
        "official_domain": "example.edu",
        "is_main_campus": True,
        "basic_profile": {"identity": {"sector": "Private"}},
        "profile_version": "profile-v1",
        "profile_snapshot_date": date(2026, 1, 2),
        "profile_sha256": b"p" * 32,
    }


def _coverage_row(
    domain: str = "admissions", *, status: str = "validated", document_id: int = 20
) -> dict[str, Any]:
    return {
        "school_id": 1,
        "academic_year": 2025,
        "document_id": document_id,
        "currentness": "stale",
        "staleness_reason": "newer edition expected",
        "latest_extraction_status": "succeeded",
        "latest_error_code": None,
        "domain_id": domain,
        "accepted_packet_status": status,
    }


class _CatalogConnection:
    def __init__(
        self,
        manifests: list[dict[str, Any]],
        profiles: list[dict[str, Any]],
        coverage: list[dict[str, Any]],
    ) -> None:
        self.manifests = manifests
        self.profiles = profiles
        self.coverage = coverage
        self.fetches: list[str] = []
        self.transactions: list[dict[str, object]] = []

    def transaction(self, **kwargs: object) -> _AsyncContext:
        self.transactions.append(kwargs)
        return _AsyncContext(self)

    async def fetch(self, sql: str, *_: object) -> list[dict[str, Any]]:
        self.fetches.append(sql)
        if "cds_manifest_snapshots" in sql:
            return deepcopy(self.manifests)
        if "school_profiles" in sql:
            return deepcopy(self.profiles)
        if "selected_documents" in sql:
            return deepcopy(self.coverage)
        raise AssertionError(f"unexpected SQL: {sql}")


class _CatalogPool:
    def __init__(self, connection: _CatalogConnection) -> None:
        self.connection = connection
        self.acquire_count = 0

    def acquire(self) -> _AsyncContext:
        self.acquire_count += 1
        return _AsyncContext(self.connection)


async def test_catalog_load_is_one_atomic_read_and_keeps_all_manifest_editions() -> None:
    connection = _CatalogConnection(
        [_manifest_row("4.0.0", current=False), _manifest_row("5.0.1", current=True)],
        [_profile_row()],
        [_coverage_row()],
    )
    pool = _CatalogPool(connection)

    catalog = await Catalog.load(cast(Any, pool))

    assert pool.acquire_count == 1
    assert connection.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert len(connection.fetches) == 3
    assert "DISTINCT ON (school_id)" in connection.fetches[2]
    assert "academic_year DESC,document_id DESC" in connection.fetches[2]
    assert set(catalog.snapshot.manifests) == {"4.0.0", "5.0.1"}
    assert catalog.snapshot.current_version == "5.0.1"
    assert catalog.snapshot.current_contract == "packet-v1"
    assert catalog.snapshot.domain_counts == {"admissions": 1}
    assert catalog.snapshot.coverage[1]["document_id"] == 20
    assert catalog.snapshot.coverage_aggregates == {
        "covered": 1,
        "fully": 1,
        "partial": 0,
        "stale": 1,
        "by_year": {2025: 1},
    }


@pytest.mark.parametrize(
    ("manifests", "profiles", "coverage", "message"),
    [
        ([_manifest_row("5.0.1", current=True)], [], [], "profile catalog is empty"),
        ([_manifest_row("5.0.1", current=False)], [_profile_row()], [], "exactly one current"),
        (
            [_manifest_row("5.0.1", current=True)],
            [_profile_row(), _profile_row()],
            [],
            "invalid or duplicated",
        ),
        (
            [_manifest_row("5.0.1", current=True)],
            [_profile_row()],
            [_coverage_row(), _coverage_row(document_id=21)],
            "duplicate schools",
        ),
    ],
)
async def test_catalog_rejects_invalid_snapshot_state(
    manifests: list[dict[str, Any]],
    profiles: list[dict[str, Any]],
    coverage: list[dict[str, Any]],
    message: str,
) -> None:
    pool = _CatalogPool(_CatalogConnection(manifests, profiles, coverage))
    with pytest.raises(ServiceError, match=message):
        await Catalog.load(cast(Any, pool))


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda content: content["root"].update(version="wrong"), "identity is inconsistent"),
        (
            lambda content: content["domains"].append(deepcopy(content["domains"][0])),
            "duplicate domain identifier",
        ),
        (
            lambda content: content["domains"][0]["metrics"].append(
                deepcopy(content["domains"][0]["metrics"][0])
            ),
            "references are invalid or duplicated",
        ),
        (
            lambda content: content["domains"][0]["metrics"][0].update(
                contexts=[
                    {
                        "id": "admissions.term",
                        "label": "Term",
                        "refs": ["missing.term"],
                    }
                ]
            ),
            "context references an unknown metric",
        ),
    ],
)
async def test_catalog_load_validates_manifest_identity_and_compiled_contract(
    mutate: Any, message: str
) -> None:
    row = _manifest_row("5.0.1", current=True)
    mutate(row["content"])
    row["domain_hashes"] = {domain["id"]: b"d" * 32 for domain in row["content"]["domains"]}
    pool = _CatalogPool(_CatalogConnection([row], [_profile_row()], []))

    with pytest.raises(ServiceError, match=message):
        await Catalog.load(cast(Any, pool))


async def test_refresh_cadence_skips_io_failure_is_atomic_and_unknown_domain_forces_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _CatalogConnection(
        [_manifest_row("5.0.1", current=True)], [_profile_row()], [_coverage_row()]
    )
    pool = _CatalogPool(connection)
    catalog = await Catalog.load(cast(Any, pool))
    original = catalog.snapshot
    monkeypatch.setattr(
        "counselle_db.catalog.get_settings",
        lambda: SimpleNamespace(data_catalog_refresh_seconds=3600),
    )

    assert await catalog.maybe_refresh() is original
    assert pool.acquire_count == 1

    connection.profiles = []
    assert await catalog.maybe_refresh(force=True) is original
    assert catalog.snapshot is original
    assert catalog.snapshot.refreshed_at == original.refreshed_at

    connection.profiles = [_profile_row()]
    connection.manifests = [_manifest_row("5.0.2", current=True, binder=True)]
    refreshed_domain = await catalog.domain("enrollment")
    assert refreshed_domain.id == "enrollment"
    assert catalog.snapshot.current_version == "5.0.2"
    assert pool.acquire_count == 3


def _packet_row(
    domain: str,
    metrics: dict[str, dict[str, Any]],
    *,
    manifest_version: str = "5.0.1",
    status: str = "validated",
    definition_match: bool = True,
) -> dict[str, Any]:
    extraction_id = f"00000000-0000-0000-0000-00000000000{1 if domain == 'admissions' else 2}"
    counts = {key: 0 for key in ("verified", "not_extracted", "conflict", "invalid")}
    for metric in metrics.values():
        counts[metric["extraction_status"]] += 1
    return {
        "school_id": 1,
        "academic_year": 2025,
        "document_id": 20,
        "pdf_sha256": b"a",
        "domain_id": domain,
        "accepted_packet_status": status,
        "packet": {
            "document_sha256": "61",
            "academic_year": 2025,
            "extraction_id": extraction_id,
            "manifest_version": manifest_version,
            "domain_id": domain,
            "domain_schema_hash": "64" * 32,
            "extractor_version": "gemini-routed-extraction-v8",
            "model_id": "model",
            "status": status,
            "counts": counts,
            "provider_contract": {"secret": "never-return"},
            "metrics": metrics,
        },
        "extraction_id": extraction_id,
        "manifest_version": manifest_version,
        "domain_schema_hash": b"d" * 32,
        "current_definition_match": definition_match,
        "currentness": "current",
        "staleness_reason": None,
    }


def _verified(value: object, raw: str, excerpt: str = "private evidence") -> dict[str, Any]:
    return {
        "extraction_status": "verified",
        "availability_status": "reported",
        "value": value,
        "raw_value": raw,
        "evidence": {"page_number": 1, "excerpt": excerpt},
    }


def _document(
    *,
    currentness: str = "current",
    year: int = 2025,
    document_id: int = 20,
    manifest_version: str | None = "5.0.1",
) -> dict[str, Any]:
    return {
        "school_id": 1,
        "academic_year": year,
        "document_id": document_id,
        "pdf_sha256": b"a",
        "currentness": currentness,
        "staleness_reason": "newer edition expected" if currentness == "stale" else None,
        "latest_extraction_status": "succeeded",
        "latest_error_code": None,
        "target_manifest_version": manifest_version,
        "source_kind": "upload",
        "retrieved_at": datetime(2026, 1, 1, tzinfo=UTC),
    }


class _DomainConnection:
    def __init__(
        self,
        document: dict[str, Any] | list[dict[str, Any]] | None,
        rows: list[dict[str, Any]],
    ) -> None:
        self.documents = (
            [] if document is None else document if isinstance(document, list) else [document]
        )
        self.rows = rows
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, sql: str, *params: object) -> dict[str, Any] | None:
        self.calls.append((sql, params))
        if not self.documents:
            return None
        selected = max(
            self.documents, key=lambda item: (item["academic_year"], item["document_id"])
        )
        return deepcopy(selected)

    async def fetch(self, sql: str, *params: object) -> list[dict[str, Any]]:
        self.calls.append((sql, params))
        domains = set(cast(list[str], params[2]))
        return [
            deepcopy(row)
            for row in self.rows
            if row["document_id"] == params[1] and row["domain_id"] in domains
        ]


class _DomainPool:
    def __init__(self, connection: _DomainConnection) -> None:
        self.connection = connection

    def acquire(self) -> _AsyncContext:
        return _AsyncContext(self.connection)


def _service_catalog(
    connection: _DomainConnection,
    *,
    current_version: str = "5.0.1",
    historical_description: str = "Historical admission rate",
    current_manifest: ManifestSnapshot | None = None,
) -> Catalog:
    historical = compile_manifest(
        "4.0.0",
        _manifest_content("4.0.0", description=historical_description, binder=True),
        {"admissions": b"d" * 32, "enrollment": b"d" * 32},
    )
    current = current_manifest or compile_manifest(
        "5.0.1",
        _manifest_content("5.0.1", description="Current admission rate", binder=True),
        {"admissions": b"d" * 32, "enrollment": b"d" * 32},
    )
    selected = current if current_version == "5.0.1" else historical
    snapshot = SimpleNamespace(
        refreshed_at=datetime.now(UTC),
        domains=selected.domains,
        schools={
            1: SimpleNamespace(
                basics=SchoolBasics(
                    unitid=1,
                    name="Example University",
                    city="Boston",
                    state="MA",
                    official_domain="example.edu",
                )
            )
        },
        manifests={"4.0.0": historical, "5.0.1": current},
    )
    return Catalog(cast(Any, _DomainPool(connection)), cast(Any, snapshot))


@pytest.fixture(autouse=True)
def _service_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "counselle_db.service.get_settings",
        lambda: SimpleNamespace(
            supported_packet_extractor_versions=frozenset({"gemini-routed-extraction-v8"})
        ),
    )


async def test_get_domain_uses_newest_selected_document_and_carries_internal_evidence() -> None:
    row = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    connection = _DomainConnection(_document(), [row])
    result = await get_domain(_service_catalog(connection), 1, "admissions")

    assert result.document_id == 20
    assert result.academic_year == 2025
    assert result.rows[0].display == "10%"
    assert result.summary == "1 of 1 metrics verified"
    assert result.availability.verified == 1
    assert result.availability.available == 1
    payload = result.model_dump_json()
    assert "private evidence" in payload
    assert "provider_contract" not in payload
    assert "secret" not in payload
    selected_reads = [sql for sql, _ in connection.calls if "ORDER BY d.academic_year DESC" in sql]
    assert len(selected_reads) == 1


@pytest.mark.parametrize("document", [None, _document()])
async def test_get_domain_distinguishes_no_document_from_missing_packet(
    document: dict[str, Any] | None,
) -> None:
    result = await get_domain(_service_catalog(_DomainConnection(document, [])), 1, "admissions")
    assert result.availability.verified == 0
    if document is None:
        assert result.document_id is None
        assert "no active CDS document" in result.summary
    else:
        assert result.document_id == 20
        assert "no accepted packet" in result.summary


async def test_get_domain_partial_stale_and_definition_drift_use_pinned_manifest() -> None:
    metrics = {"admissions.rate": _verified(0.2, "20%")}
    row = _packet_row(
        "admissions",
        metrics,
        manifest_version="4.0.0",
        status="partial",
        definition_match=False,
    )
    result = await get_domain(
        _service_catalog(_DomainConnection(_document(currentness="stale"), [row])),
        1,
        "admissions",
    )
    assert result.rows[0].label == "Historical admission rate"
    # The historical manifest declares a "Term" context bound to enrollment.term,
    # but no enrollment packet is supplied here, so the binder never resolves and
    # the vintage renders year-only — which must carry the disclosure caveat.
    assert set(result.rows[0].caveat_kinds) == {
        "partial_packet",
        "definition_drift",
        "stale_edition",
        "vintage_period_unavailable",
    }
    assert result.definition_match is False


async def test_get_domain_counts_verified_source_absence_separately_from_available() -> None:
    unavailable = {
        "extraction_status": "verified",
        "availability_status": "not_in_template_version",
        "value": None,
        "raw_value": None,
        "evidence": {"page_number": 1, "excerpt": "template has no such row"},
    }
    row = _packet_row("admissions", {"admissions.rate": unavailable})

    result = await get_domain(
        _service_catalog(_DomainConnection(_document(), [row])), 1, "admissions"
    )

    assert result.availability.verified == 1
    assert result.availability.available == 0
    assert result.availability.not_in_template_version == 1
    assert result.summary == "1 of 1 metrics verified; 1 not in this template version"


async def test_get_domain_rejects_unsupported_packet_without_returning_zero_values() -> None:
    row = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    row["packet"]["extractor_version"] = "unknown"
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        await get_domain(_service_catalog(_DomainConnection(_document(), [row])), 1, "admissions")


async def test_get_domain_aggregates_same_document_cross_domain_binders() -> None:
    admissions = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    enrollment = _packet_row("enrollment", {"enrollment.term": _verified("Fall", "Fall 2025")})
    connection = _DomainConnection(_document(), [admissions, enrollment])
    result = await get_domain(_service_catalog(connection), 1, "admissions")

    assert "Term: Fall 2025" in result.rows[0].vintage
    domain_fetches = [params for sql, params in connection.calls if "domain_id=ANY" in sql]
    assert domain_fetches == [(1, 20, ["admissions", "enrollment"])]


async def test_get_domain_historical_cross_domain_binder_uses_historical_manifest() -> None:
    admissions = _packet_row(
        "admissions",
        {"admissions.rate": _verified(0.1, "10%")},
        manifest_version="4.0.0",
        definition_match=False,
    )
    enrollment = _packet_row(
        "enrollment",
        {"enrollment.term": _verified("Fall", "Fall 2025")},
        manifest_version="4.0.0",
        definition_match=False,
    )
    result = await get_domain(
        _service_catalog(_DomainConnection(_document(), [admissions, enrollment])),
        1,
        "admissions",
    )
    assert result.rows[0].label == "Historical admission rate"
    assert "Term: Fall 2025" in result.rows[0].vintage


async def test_get_domain_selects_newest_year_and_never_falls_back_to_older_packet() -> None:
    older = _packet_row("admissions", {"admissions.rate": _verified(0.9, "90%")})
    older["academic_year"] = 2024
    older["document_id"] = 10
    older["packet"]["academic_year"] = 2024
    documents = [
        _document(year=2024, document_id=10),
        _document(year=2025, document_id=20, manifest_version=None),
    ]
    connection = _DomainConnection(documents, [older])

    result = await get_domain(_service_catalog(connection), 1, "admissions")

    assert result.document_id == 20
    assert result.academic_year == 2025
    assert result.availability.verified == 0
    assert "no accepted packet" in result.summary
    packet_fetches = [params for sql, params in connection.calls if "domain_id=ANY" in sql]
    assert packet_fetches == [(1, 20, ["admissions"])]


async def test_get_domain_omits_missing_or_unavailable_binder_context() -> None:
    admissions = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    unavailable = {
        "extraction_status": "verified",
        "availability_status": "not_reported",
        "value": None,
        "raw_value": None,
        "evidence": {"page_number": 1, "excerpt": "not reported"},
    }
    enrollment = _packet_row("enrollment", {"enrollment.term": unavailable})
    for rows in ([admissions], [admissions, enrollment]):
        result = await get_domain(
            _service_catalog(_DomainConnection(_document(), rows)), 1, "admissions"
        )
        assert "Term:" not in result.rows[0].vintage


async def test_get_domain_same_domain_binder_is_deduplicated_in_one_packet_fetch() -> None:
    content = _manifest_content("5.0.1")
    content["domains"][0]["metrics"][0]["contexts"] = [
        {"id": "admissions.self", "label": "Rate", "refs": ["admissions.rate"]}
    ]
    manifest = compile_manifest("5.0.1", content, {"admissions": b"d" * 32})
    row = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    connection = _DomainConnection(_document(), [row])
    catalog = _service_catalog(connection, current_manifest=manifest)

    result = await get_domain(catalog, 1, "admissions")

    assert "Rate: 10%" in result.rows[0].vintage
    packet_fetches = [params for sql, params in connection.calls if "domain_id=ANY" in sql]
    assert packet_fetches == [(1, 20, ["admissions"])]


async def test_get_domain_rejects_inconsistent_binder_packet_contract() -> None:
    admissions = _packet_row("admissions", {"admissions.rate": _verified(0.1, "10%")})
    enrollment = _packet_row("enrollment", {"enrollment.term": _verified("Fall", "Fall 2025")})
    enrollment["packet"]["domain_id"] = "admissions"
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        await get_domain(
            _service_catalog(_DomainConnection(_document(), [admissions, enrollment])),
            1,
            "admissions",
        )


async def test_get_domain_verified_never_exceeds_current_configured_metrics() -> None:
    # A packet pinned to a superseded manifest (4.0.0) carries "admissions.rate",
    # a metric the current manifest no longer configures for this domain. The
    # availability summary's numerator (verified) and denominator (configured)
    # must stay commensurable with the *current* manifest, or coverage is
    # overstated (docs/DATABASE_GUIDE.md §6).
    current = compile_manifest(
        "5.1.0", {"domains": [{"id": "admissions", "title": "Admissions", "metrics": []}]}
    )
    row = _packet_row(
        "admissions", {"admissions.rate": _verified(0.2, "20%")}, manifest_version="4.0.0"
    )

    result = await get_domain(
        _service_catalog(_DomainConnection(_document(), [row]), current_manifest=current),
        1,
        "admissions",
    )

    assert result.availability.configured == 0
    assert result.availability.verified <= result.availability.configured
    assert result.summary == "0 of 0 metrics verified"
