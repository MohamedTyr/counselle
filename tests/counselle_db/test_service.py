"""Unit coverage for code-owned service executors.

The admissions-fit executor has a deliberately narrower transaction promise
than ``explore``: it snapshots the rendered page and the facts used to
estimate that page.  Explore's ancillary counts/options run through the
existing executor separately, so this test module pins the precise boundary.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from inspect import signature
from types import MappingProxyType, SimpleNamespace
from typing import Any, cast

import pytest
from structlog.testing import capture_logs

from counselle_db.admissions_fit_evidence import (
    admissions_fit_batch_read_receipt,
    admissions_fit_fact_value_row,
    observe_admissions_fit_explore,
    record_admissions_fit_batch_read_receipt,
)
from counselle_db.models import ServiceError
from counselle_db.service import (
    _ADMISSIONS_FIT_BENCHMARK_PAGE_SQL,
    _ADMISSIONS_FIT_EVIDENCE_SCHOOLS_SQL,
    _ADMISSIONS_FIT_FACTS_SQL,
    ADMISSIONS_FIT_EVIDENCE_CHUNK_SIZE,
    ADMISSIONS_FIT_FACT_KEYS,
    MAX_ADMISSIONS_FIT_PAGE_SCHOOLS,
    AdmissionsFitBenchmarkRequest,
    AdmissionsFitEvidenceSnapshot,
    explore_with_admissions_fit_facts,
    export_admissions_fit_evidence_snapshot,
    exported_admissions_fit_benchmark_snapshot,
    read_admissions_fit_benchmark_request,
)


class _Context:
    def __init__(self, value: object) -> None:
        self.value = value

    async def __aenter__(self) -> object:
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


class _TransactionContext(_Context):
    def __init__(self, connection: _Connection) -> None:
        super().__init__(connection)
        self.connection = connection

    async def __aenter__(self) -> object:
        assert not self.connection.in_transaction
        self.connection.in_transaction = True
        return self.connection

    async def __aexit__(self, *_: object) -> None:
        self.connection.in_transaction = False
        return None


class _Connection:
    def __init__(
        self, page_rows: Sequence[dict[str, Any]], fact_rows: Sequence[dict[str, Any]]
    ) -> None:
        self.page_rows = list(page_rows)
        self.fact_rows = list(fact_rows)
        self.fetch_calls: list[tuple[str, tuple[Any, ...], bool]] = []
        self.fetchval_calls: list[tuple[str, tuple[Any, ...], bool]] = []
        self.execute_calls: list[tuple[str, tuple[Any, ...], bool]] = []
        self.transactions: list[dict[str, object]] = []
        self.in_transaction = False
        self.exported_snapshot_id: object = "00000001-00000002-1"
        self.fail_fetchval = False
        self.fail_execute = False

    def transaction(self, **kwargs: object) -> _TransactionContext:
        self.transactions.append(kwargs)
        return _TransactionContext(self)

    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.fetch_calls.append((sql, params, self.in_transaction))
        if sql == _MAIN_SQL:
            return list(self.page_rows)
        if sql == _ADMISSIONS_FIT_EVIDENCE_SCHOOLS_SQL:
            return list(self.page_rows)
        if sql == _ADMISSIONS_FIT_BENCHMARK_PAGE_SQL:
            (page_size,) = params
            return list(self.page_rows[:page_size])
        if sql == _ADMISSIONS_FIT_FACTS_SQL:
            school_ids, fact_keys = params
            assert isinstance(school_ids, list)
            assert isinstance(fact_keys, list)
            return [
                row
                for row in self.fact_rows
                # A real reader-view row always carries ``school_id``.  Let a
                # deliberately malformed fixture through so executor tests can
                # prove this optional-detail boundary is non-blocking.
                if row.get("school_id") is None or row.get("school_id") in school_ids
                if row.get("fact_key") in fact_keys
            ]
        raise AssertionError(f"unexpected SQL: {sql}")

    async def fetchval(self, sql: str, *params: Any) -> object:
        self.fetchval_calls.append((sql, params, self.in_transaction))
        if self.fail_fetchval:
            raise RuntimeError("snapshot export failed")
        if sql == "SELECT pg_export_snapshot()":
            return self.exported_snapshot_id
        raise AssertionError(f"unexpected fetchval SQL: {sql}")

    async def execute(self, sql: str, *params: Any) -> None:
        self.execute_calls.append((sql, params, self.in_transaction))
        if self.fail_execute:
            raise RuntimeError("snapshot import failed")


class _Pool:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection
        self.acquire_count = 0

    def acquire(self) -> _Context:
        self.acquire_count += 1
        return _Context(self.connection)


class _ConnectionPool:
    """Allocate a distinct source/consumer connection in deterministic tests."""

    def __init__(self, *connections: _Connection) -> None:
        self.connections = list(connections)
        self.acquire_count = 0
        self.release_count = 0

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_Connection]:
        if not self.connections:
            raise AssertionError("unexpected pool acquire")
        self.acquire_count += 1
        connection = self.connections.pop(0)
        try:
            yield connection
        finally:
            self.release_count += 1


_MAIN_SQL = "SELECT school_id, admit_rate FROM cds_library.school_explore WHERE state=$1"


def _page_row(school_id: object) -> dict[str, object]:
    return {"school_id": school_id, "admit_rate": 42}


def _fact_row(school_id: int, fact_key: str = "class_profile.sat_math_p25") -> dict[str, Any]:
    return {
        "school_id": school_id,
        "fact_key": fact_key,
        "tab": "admission",
        "section": "getting-in",
        "label": "SAT Math",
        "value": {"kind": "number", "value": 650},
        "display": "650",
        "unit": None,
        "value_type": "number",
        "value_num": 650,
        "value_text": None,
        "value_bool": None,
        "value_date": None,
        "reported_period": None,
        "reported_period_year": None,
        "observed_at": datetime(2026, 9, 15, tzinfo=UTC),
    }


def _catalog(
    page_rows: Sequence[dict[str, Any]], fact_rows: Sequence[dict[str, Any]] = ()
) -> tuple[Any, _Connection, _Pool]:
    connection = _Connection(page_rows, fact_rows)
    pool = _Pool(connection)
    return SimpleNamespace(pool=pool), connection, pool


def test_admissions_fit_fact_keys_are_the_closed_v1_contract() -> None:
    """The reader owns its own closed list; it never imports the app adapter."""
    assert ADMISSIONS_FIT_FACT_KEYS == (
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
    assert isinstance(ADMISSIONS_FIT_FACT_KEYS, tuple)
    assert "admissions.admit_rate" not in ADMISSIONS_FIT_FACT_KEYS
    assert "class_profile.average_gpa" not in ADMISSIONS_FIT_FACT_KEYS
    assert "class_profile.sat_total_p25" not in ADMISSIONS_FIT_FACT_KEYS


def test_admissions_fit_fact_keys_match_the_app_adapter_contract() -> None:
    """The import direction stays test-only: service must not import ``app``."""
    from app.facts.admissions_fit_inputs import ADMISSIONS_FIT_FACT_KEYS as adapter_fact_keys

    assert adapter_fact_keys == ADMISSIONS_FIT_FACT_KEYS


async def test_fit_executor_reads_page_then_one_bound_batch_in_same_snapshot() -> None:
    catalog, connection, pool = _catalog(
        [_page_row(7), _page_row(11)],
        [_fact_row(7), _fact_row(7, "class_profile.sat_math_p75")],
    )

    page_rows, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, ["CA"])
    )

    assert pool.acquire_count == 1
    assert connection.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert len(connection.fetch_calls) == 2  # Never one dependent query per card.
    assert connection.fetch_calls[0] == (_MAIN_SQL, ("CA",), True)
    fact_sql, fact_params, fact_in_transaction = connection.fetch_calls[1]
    assert fact_sql == _ADMISSIONS_FIT_FACTS_SQL
    assert fact_in_transaction is True
    assert "school_id=ANY($1::integer[])" in fact_sql
    assert "fact_key=ANY($2::text[])" in fact_sql
    assert fact_params == ([7, 11], list(ADMISSIONS_FIT_FACT_KEYS))

    assert page_rows == tuple([_page_row(7), _page_row(11)])
    assert tuple(row.fact_key for row in facts_by_school[7]) == (
        "class_profile.sat_math_p25",
        "class_profile.sat_math_p75",
    )
    assert facts_by_school[11] == ()
    assert isinstance(facts_by_school, MappingProxyType)
    assert connection.in_transaction is False
    with pytest.raises(TypeError):
        facts_by_school[7] = ()  # type: ignore[index]


async def test_fit_executor_records_only_aggregate_batch_timing_and_detail_drops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fixed batch measures only its own query and never logs a row identifier."""
    valid = _fact_row(7)
    missing_value = _fact_row(7, "class_profile.sat_math_p75")
    del missing_value["value"]
    invalid_detail = _fact_row(11)
    del invalid_detail["display"]
    missing_identity = _fact_row(11, "class_profile.sat_math_p75")
    del missing_identity["school_id"]
    catalog, connection, _ = _catalog(
        [_page_row(7), _page_row(11)],
        [valid, missing_value, invalid_detail, missing_identity],
    )
    clock = {"now": 0.0}

    async def timed_fetch(sql: str, *params: Any) -> list[dict[str, Any]]:
        rows = await original_fetch(sql, *params)
        # The page query is intentionally far slower.  A batch receipt of
        # seven seconds proves it begins after the page rather than timing the
        # whole executor request.
        clock["now"] += 50.0 if sql == _MAIN_SQL else 7.0
        return rows

    original_fetch = connection.fetch
    original_fact_value_row = admissions_fit_fact_value_row

    monkeypatch.setattr(connection, "fetch", timed_fetch)

    def slow_fact_value_row(record: Any, **kwargs: Any) -> object:
        # Parsing/deep-freezing can be comparatively expensive for a wide
        # page. That CPU work must not inflate the fixed database-query metric.
        clock["now"] += 11.0
        return original_fact_value_row(record, **kwargs)

    monkeypatch.setattr(
        "counselle_db.admissions_fit_evidence.admissions_fit_fact_value_row", slow_fact_value_row
    )
    monkeypatch.setattr(
        "counselle_db.admissions_fit_evidence._monotonic_clock", lambda: clock["now"]
    )

    with capture_logs() as logs:
        page_rows, facts_by_school = await explore_with_admissions_fit_facts(
            cast(Any, catalog), (_MAIN_SQL, ["CA"])
        )

    receipt = admissions_fit_batch_read_receipt()
    assert page_rows == tuple([_page_row(7), _page_row(11)])
    assert tuple(row.fact_key for row in facts_by_school[7]) == ("class_profile.sat_math_p25",)
    assert facts_by_school[11] == ()
    assert receipt.batch_query_latency_ms == 7000
    assert receipt.fact_row_drop_counts == {
        "invalid_detail_row": 1,
        "invalid_identity_or_fact_key": 1,
        "missing_value": 1,
    }
    # The observability seam remains one page + one fixed-key batch, not a
    # per-row or per-school logging/query path.
    assert len(connection.fetch_calls) == 2
    assert connection.fetch_calls[1][1][0] == [7, 11]
    assert logs == []


async def test_explore_with_admissions_fit_facts_empty_page_skips_dependent_query() -> None:
    catalog, connection, pool = _catalog([])

    page_rows, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, ["CA"])
    )

    assert page_rows == ()
    assert facts_by_school == {}
    assert isinstance(facts_by_school, MappingProxyType)
    assert pool.acquire_count == 1
    assert connection.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert connection.fetch_calls == [(_MAIN_SQL, ("CA",), True)]
    assert connection.in_transaction is False


async def test_fit_executor_drops_only_malformed_optional_detail_rows() -> None:
    valid = _fact_row(7)
    no_observation = _fact_row(7, "class_profile.sat_math_p75")
    no_observation["observed_at"] = None
    missing_required_field = _fact_row(11)
    del missing_required_field["display"]
    catalog, connection, _ = _catalog(
        [_page_row(7), _page_row(11)],
        [valid, no_observation, missing_required_field],
    )

    page_rows, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, ["CA"])
    )

    # Optional unusable evidence cannot erase the page or a remaining fact.
    assert page_rows == tuple([_page_row(7), _page_row(11)])
    assert tuple(row.fact_key for row in facts_by_school[7]) == ("class_profile.sat_math_p25",)
    assert facts_by_school[11] == ()
    assert connection.in_transaction is False


async def test_fit_executor_drops_detail_row_without_school_id() -> None:
    row_without_school_id = _fact_row(7)
    del row_without_school_id["school_id"]
    catalog, connection, _ = _catalog([_page_row(7)], [row_without_school_id])

    page_rows, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, [])
    )

    assert page_rows == tuple([_page_row(7)])
    assert facts_by_school == {7: ()}
    assert connection.in_transaction is False


async def test_fit_executor_deep_freezes_fact_json_without_breaking_adapter() -> None:
    source = _fact_row(7, "class_profile.gpa_distribution")
    source["value_type"] = "distribution"
    source["value"] = {
        "kind": "distribution",
        "value": {
            "scale": "gpa",
            "buckets": [
                {"label": "0.00 - 3.49", "lo": 0, "hi": 3.49, "pct": 5},
                {"label": "3.50 - 3.74", "lo": 3.5, "hi": 3.74, "pct": 15},
                {"label": "3.75 - 3.99", "lo": 3.75, "hi": 3.99, "pct": 35},
                {"label": "4.00 and Above", "lo": 4, "hi": None, "pct": 45},
            ],
            "omitted_buckets": [],
            "sums_to": 100,
            "metadata": {"nested": ["original"]},
        },
    }
    catalog, _, _ = _catalog([_page_row(7)], [source])

    _, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, [])
    )

    frozen_value = facts_by_school[7][0].value
    assert isinstance(frozen_value, Mapping)
    frozen_payload = frozen_value["value"]
    assert isinstance(frozen_payload, Mapping)
    frozen_buckets = frozen_payload["buckets"]
    frozen_nested = frozen_payload["metadata"]["nested"]
    assert isinstance(frozen_buckets, list)  # Compatibility for the Phase-2 adapter.
    assert isinstance(frozen_nested, list)
    with pytest.raises(TypeError):
        frozen_value["kind"] = "changed"  # type: ignore[index]
    with pytest.raises(TypeError):
        frozen_payload["scale"] = "changed"  # type: ignore[index]
    with pytest.raises((AttributeError, TypeError)):
        frozen_buckets.append({"label": "mutated"})
    with pytest.raises(TypeError):
        list.append(frozen_buckets, {"label": "mutated"})
    with pytest.raises((AttributeError, TypeError)):
        frozen_nested[0] = "mutated"

    # A tuple-backed compatibility wrapper must also protect its storage
    # attribute.  Otherwise a normal assignment can replace the complete
    # frozen payload after the service returned it.
    with pytest.raises(AttributeError):
        frozen_buckets._items = ()  # type: ignore[attr-defined]
    with pytest.raises(AttributeError):
        del frozen_buckets._items  # type: ignore[attr-defined]

    # The returned snapshot does not share any JSON container with its DB row.
    source["value"]["value"]["buckets"][0]["pct"] = 99
    source["value"]["value"]["metadata"]["nested"].append("mutated")
    assert frozen_buckets[0]["pct"] == 5
    assert frozen_nested == ["original"]

    from app.facts.admissions_fit_inputs import school_fit_inputs_from_facts

    fit_inputs = school_fit_inputs_from_facts(
        admit_rate=42,
        facts=facts_by_school[7],
        now=datetime(2026, 9, 15, tzinfo=UTC),
        stale_after_days=120,
    )
    assert fit_inputs.gpa_distribution is not None
    assert fit_inputs.gpa_distribution.complete is True


@pytest.mark.parametrize("school_id", [None, False, -1, 0, "9"])
async def test_explore_with_admissions_fit_facts_rejects_invalid_page_school_ids_before_batch(
    school_id: object,
) -> None:
    catalog, connection, _ = _catalog([_page_row(school_id)])

    with pytest.raises(ServiceError, match="positive integer"):
        await explore_with_admissions_fit_facts(cast(Any, catalog), (_MAIN_SQL, []))

    assert connection.fetch_calls == [(_MAIN_SQL, (), True)]


async def test_fit_executor_rejects_duplicate_or_oversized_pages_before_batch() -> None:
    duplicate_catalog, duplicate_connection, _ = _catalog([_page_row(7), _page_row(7)])
    with pytest.raises(ServiceError, match="unique"):
        await explore_with_admissions_fit_facts(cast(Any, duplicate_catalog), (_MAIN_SQL, []))
    assert len(duplicate_connection.fetch_calls) == 1

    oversized_catalog, oversized_connection, _ = _catalog(
        [_page_row(school_id) for school_id in range(1, MAX_ADMISSIONS_FIT_PAGE_SCHOOLS + 2)]
    )
    with pytest.raises(ServiceError, match="page cap"):
        await explore_with_admissions_fit_facts(cast(Any, oversized_catalog), (_MAIN_SQL, []))
    assert len(oversized_connection.fetch_calls) == 1


async def test_fit_executor_honors_a_caller_supplied_page_cap_above_the_default() -> None:
    configured_cap = MAX_ADMISSIONS_FIT_PAGE_SCHOOLS + 1
    catalog, connection, _ = _catalog(
        [_page_row(school_id) for school_id in range(1, configured_cap + 1)],
        [_fact_row(configured_cap)],
    )

    page_rows, facts_by_school = await explore_with_admissions_fit_facts(
        cast(Any, catalog), (_MAIN_SQL, []), max_page_size=configured_cap
    )

    assert len(page_rows) == configured_cap
    assert facts_by_school[configured_cap][0].fact_key == "class_profile.sat_math_p25"
    assert len(connection.fetch_calls) == 2


@pytest.mark.parametrize("max_page_size", [None, False, 0, -1, "101"])
async def test_fit_executor_rejects_an_invalid_caller_supplied_page_cap_before_page_fetch(
    max_page_size: object,
) -> None:
    catalog, connection, _ = _catalog([_page_row(7)])

    with pytest.raises(ServiceError, match="max_page_size.*positive integer"):
        await explore_with_admissions_fit_facts(
            cast(Any, catalog), (_MAIN_SQL, []), max_page_size=cast(Any, max_page_size)
        )

    assert connection.fetch_calls == []


async def test_fit_executor_rejects_page_above_caller_supplied_cap_before_detail_fetch() -> None:
    catalog, connection, _ = _catalog([_page_row(7), _page_row(11)])

    with pytest.raises(ServiceError, match="page cap"):
        await explore_with_admissions_fit_facts(
            cast(Any, catalog), (_MAIN_SQL, []), max_page_size=1
        )

    assert connection.fetch_calls == [(_MAIN_SQL, (), True)]


def test_admissions_fit_fact_batch_is_read_only_and_cannot_claim_ancillary_explore_queries() -> (
    None
):
    """The one-statement API makes counts/options/tail queries visibly external.

    ``explore_with_admissions_fit_facts`` receives exactly one page statement,
    then owns only the fact batch.  Its generated SQL is a reader-view SELECT;
    it cannot write facts or alter grants/schema.
    """
    normalized = " ".join(_ADMISSIONS_FIT_FACTS_SQL.upper().split())
    assert normalized.startswith("SELECT ")
    assert "CURRENT_SCHOOL_FACTS" in normalized
    assert not any(word in normalized for word in (" INSERT ", " UPDATE ", " DELETE ", " ALTER "))


async def test_evidence_export_uses_repeatable_read_and_closed_inputs() -> None:
    """The release artifact sees exactly the canonical Explore rate and fixed facts.

    This is intentionally a full-store operation, separate from the bounded
    page executor.  It must not expose another raw-facts or selected-key API.
    """
    catalog, connection, pool = _catalog(
        [_page_row(11), _page_row(7)],
        [
            _fact_row(7, "class_profile.sat_math_p75"),
            _fact_row(11, "class_profile.sat_math_p25"),
            _fact_row(7, "not.allowed"),
        ],
    )
    del catalog

    snapshot = await export_admissions_fit_evidence_snapshot(cast(Any, pool))

    assert isinstance(snapshot, AdmissionsFitEvidenceSnapshot)
    assert tuple((row.school_id, row.admit_rate) for row in snapshot.schools) == ((7, 42), (11, 42))
    assert snapshot.source_fact_row_count == 2
    assert tuple(row.fact_key for row in snapshot.facts_by_school[7]) == (
        "class_profile.sat_math_p75",
    )
    assert tuple(row.fact_key for row in snapshot.facts_by_school[11]) == (
        "class_profile.sat_math_p25",
    )
    assert isinstance(snapshot.facts_by_school, MappingProxyType)
    assert connection.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert connection.fetch_calls[0] == (_ADMISSIONS_FIT_EVIDENCE_SCHOOLS_SQL, (), True)
    fact_sql, fact_params, in_transaction = connection.fetch_calls[1]
    assert fact_sql == _ADMISSIONS_FIT_FACTS_SQL
    assert fact_params == ([7, 11], list(ADMISSIONS_FIT_FACT_KEYS))
    assert in_transaction is True
    assert connection.in_transaction is False


async def test_evidence_export_chunks_the_fixed_batch_without_n_plus_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A complete export is bounded per fixed batch, never per school."""
    monkeypatch.setattr("counselle_db.service.ADMISSIONS_FIT_EVIDENCE_CHUNK_SIZE", 2)
    catalog, connection, pool = _catalog(
        [_page_row(1), _page_row(2), _page_row(3), _page_row(4), _page_row(5)],
        [_fact_row(1), _fact_row(3), _fact_row(5)],
    )
    del catalog

    snapshot = await export_admissions_fit_evidence_snapshot(cast(Any, pool))

    assert len(snapshot.schools) == 5
    batches = [call for call in connection.fetch_calls if call[0] == _ADMISSIONS_FIT_FACTS_SQL]
    assert len(batches) == 3
    assert [params[0] for _, params, _ in batches] == [[1, 2], [3, 4], [5]]
    assert all(params[1] == list(ADMISSIONS_FIT_FACT_KEYS) for _, params, _ in batches)
    assert len(batches) < len(snapshot.schools)
    assert ADMISSIONS_FIT_EVIDENCE_CHUNK_SIZE > 1


async def test_evidence_export_empty_store_has_no_detail_query() -> None:
    catalog, connection, pool = _catalog([])
    del catalog

    snapshot = await export_admissions_fit_evidence_snapshot(cast(Any, pool))

    assert snapshot.schools == ()
    assert snapshot.facts_by_school == {}
    assert snapshot.source_fact_row_count == 0
    assert connection.fetch_calls == [(_ADMISSIONS_FIT_EVIDENCE_SCHOOLS_SQL, (), True)]
    assert connection.in_transaction is False


async def test_evidence_export_rejects_bad_primary_rows_but_drops_malformed_optional_facts() -> (
    None
):
    bad_primary_catalog, bad_primary_connection, bad_primary_pool = _catalog([_page_row(False)])
    del bad_primary_catalog
    with pytest.raises(ServiceError, match="positive integer"):
        await export_admissions_fit_evidence_snapshot(cast(Any, bad_primary_pool))
    assert bad_primary_connection.fetch_calls == [(_ADMISSIONS_FIT_EVIDENCE_SCHOOLS_SQL, (), True)]

    malformed = _fact_row(7)
    del malformed["display"]
    optional_catalog, optional_connection, optional_pool = _catalog([_page_row(7)], [malformed])
    del optional_catalog
    snapshot = await export_admissions_fit_evidence_snapshot(cast(Any, optional_pool))
    assert snapshot.source_fact_row_count == 1
    assert snapshot.facts_by_school == {7: ()}
    assert optional_connection.in_transaction is False


async def test_benchmark_snapshot_scopes_imported_reads_and_uses_observed_receipts() -> None:
    source = _Connection([], [])
    consumer = _Connection([_page_row(7), _page_row(11)], [_fact_row(7)])
    pool = _ConnectionPool(source, consumer)

    async with exported_admissions_fit_benchmark_snapshot(cast(Any, pool)) as snapshot:
        request = await read_admissions_fit_benchmark_request(
            cast(Any, pool), snapshot, page_size=2, include_facts=True
        )

    assert isinstance(request, AdmissionsFitBenchmarkRequest)
    assert request.select_count == 2
    assert request.transaction_count == 1
    assert tuple(row.school_id for row in request.snapshot.schools) == (7, 11)
    assert request.snapshot.facts_by_school[11] == ()
    assert source.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert source.fetchval_calls == [("SELECT pg_export_snapshot()", (), True)]
    assert consumer.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert consumer.execute_calls == [("SET TRANSACTION SNAPSHOT '00000001-00000002-1'", (), True)]
    assert consumer.fetch_calls[0] == (_ADMISSIONS_FIT_BENCHMARK_PAGE_SQL, (2,), True)
    assert consumer.fetch_calls[1][0] == _ADMISSIONS_FIT_FACTS_SQL
    assert consumer.in_transaction is False
    assert source.in_transaction is False
    assert pool.acquire_count == pool.release_count == 2


async def test_benchmark_baseline_request_has_one_observed_read_and_an_empty_immutable_bundle() -> (
    None
):
    source = _Connection([], [])
    consumer = _Connection([_page_row(7)], [_fact_row(7)])
    pool = _ConnectionPool(source, consumer)

    async with exported_admissions_fit_benchmark_snapshot(cast(Any, pool)) as snapshot:
        request = await read_admissions_fit_benchmark_request(
            cast(Any, pool), snapshot, page_size=1, include_facts=False
        )

    assert request.select_count == 1
    assert request.transaction_count == 1
    assert request.snapshot.source_fact_row_count == 0
    assert request.snapshot.facts_by_school == {7: ()}
    assert consumer.fetch_calls == [(_ADMISSIONS_FIT_BENCHMARK_PAGE_SQL, (1,), True)]


async def test_benchmark_snapshot_cannot_escape_its_context_or_accept_a_bad_database_token() -> (
    None
):
    source = _Connection([], [])
    consumer = _Connection([_page_row(7)], [])
    pool = _ConnectionPool(source, consumer)
    async with exported_admissions_fit_benchmark_snapshot(cast(Any, pool)) as snapshot:
        active_snapshot = snapshot
    with pytest.raises(ServiceError, match="not active"):
        await read_admissions_fit_benchmark_request(
            cast(Any, pool), active_snapshot, page_size=1, include_facts=False
        )
    assert consumer.fetch_calls == []

    invalid_source = _Connection([], [])
    invalid_source.exported_snapshot_id = "injection'; SELECT 1"
    invalid_pool = _ConnectionPool(invalid_source)
    with pytest.raises(ServiceError, match="invalid exported snapshot"):
        async with exported_admissions_fit_benchmark_snapshot(cast(Any, invalid_pool)):
            raise AssertionError("invalid snapshot must not yield")
    assert invalid_source.in_transaction is False


def test_evidence_public_api_has_no_sql_or_fact_key_parameter() -> None:
    """Scripts receive a narrow release-evidence seam, not a DB escape hatch."""
    export_parameters = set(signature(export_admissions_fit_evidence_snapshot).parameters)
    benchmark_parameters = set(signature(read_admissions_fit_benchmark_request).parameters)

    assert export_parameters == {"pool"}
    assert benchmark_parameters == {
        "pool",
        "snapshot",
        "page_size",
        "include_facts",
        "max_page_size",
    }
    assert not {"sql", "statement", "keys", "fact_keys", "school_ids"} & benchmark_parameters


async def test_benchmark_snapshot_cleans_up_invalid_export_import() -> None:
    failed_source = _Connection([], [])
    failed_source.fail_fetchval = True
    failed_pool = _ConnectionPool(failed_source)
    with pytest.raises(RuntimeError, match="snapshot export failed"):
        async with exported_admissions_fit_benchmark_snapshot(cast(Any, failed_pool)):
            raise AssertionError("the snapshot context must not yield")
    assert failed_source.in_transaction is False
    assert failed_pool.acquire_count == failed_pool.release_count == 1

    source = _Connection([], [])
    failed_consumer = _Connection([_page_row(7)], [])
    failed_consumer.fail_execute = True
    pool = _ConnectionPool(source, failed_consumer)
    async with exported_admissions_fit_benchmark_snapshot(cast(Any, pool)) as snapshot:
        with pytest.raises(RuntimeError, match="snapshot import failed"):
            await read_admissions_fit_benchmark_request(
                cast(Any, pool), snapshot, page_size=1, include_facts=False
            )
    assert failed_consumer.in_transaction is False
    assert source.in_transaction is False
    assert pool.acquire_count == pool.release_count == 2


@pytest.mark.parametrize("page_size", [False, 0, -1, "1", MAX_ADMISSIONS_FIT_PAGE_SCHOOLS + 1])
async def test_benchmark_request_validates_its_bounded_page_shape_before_fetch(
    page_size: object,
) -> None:
    source = _Connection([], [])
    consumer = _Connection([_page_row(7)], [])
    pool = _ConnectionPool(source, consumer)
    async with exported_admissions_fit_benchmark_snapshot(cast(Any, pool)) as snapshot:
        with pytest.raises(ServiceError, match="page_size"):
            await read_admissions_fit_benchmark_request(
                cast(Any, pool), snapshot, page_size=cast(Any, page_size), include_facts=False
            )
    assert consumer.fetch_calls == []


async def test_explore_observation_receipts_are_isolated_between_concurrent_requests() -> None:
    """A request-level aggregate cannot borrow another task's batch receipt."""

    class _Logger:
        def __init__(self) -> None:
            self.records: list[dict[str, object]] = []

        def info(self, event: str, **kwargs: object) -> None:
            self.records.append({"event": event, **kwargs})

    logger = _Logger()
    ready = asyncio.Event()
    release = asyncio.Event()
    entered = 0

    @observe_admissions_fit_explore(logger)
    async def request(batch_latency_ms: int, drop_count: int) -> SimpleNamespace:
        nonlocal entered
        record_admissions_fit_batch_read_receipt(
            batch_query_latency_ms=batch_latency_ms,
            fact_row_drop_counts={"invalid_detail_row": drop_count},
        )
        entered += 1
        if entered == 2:
            ready.set()
        await release.wait()
        return SimpleNamespace(schools=())

    first: asyncio.Future[SimpleNamespace] = asyncio.ensure_future(request(7, 1))
    second: asyncio.Future[SimpleNamespace] = asyncio.ensure_future(request(13, 2))
    await ready.wait()
    release.set()
    await asyncio.gather(first, second)

    assert len(logger.records) == 2
    assert {
        (
            record["batch_query_latency_ms"],
            tuple(sorted(cast(dict[str, int], record["fact_row_drop_counts"]).items())),
        )
        for record in logger.records
    } == {
        (7, (("invalid_detail_row", 1),)),
        (13, (("invalid_detail_row", 2),)),
    }
    assert all(
        record["validation_failure_counts"] == {}
        and record["outcome"] == "succeeded"
        and record["event"] == "admissions_fit_explore_observed"
        for record in logger.records
    )
