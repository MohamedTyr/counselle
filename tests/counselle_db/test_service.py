"""Unit coverage for code-owned service executors.

The admissions-fit executor has a deliberately narrower transaction promise
than ``explore``: it snapshots the rendered page and the facts used to
estimate that page.  Explore's ancillary counts/options run through the
existing executor separately, so this test module pins the precise boundary.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from types import MappingProxyType, SimpleNamespace
from typing import Any, cast

import pytest

from counselle_db.models import ServiceError
from counselle_db.service import (
    _ADMISSIONS_FIT_FACTS_SQL,
    ADMISSIONS_FIT_FACT_KEYS,
    MAX_ADMISSIONS_FIT_PAGE_SCHOOLS,
    explore_with_admissions_fit_facts,
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
        self.transactions: list[dict[str, object]] = []
        self.in_transaction = False

    def transaction(self, **kwargs: object) -> _TransactionContext:
        self.transactions.append(kwargs)
        return _TransactionContext(self)

    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.fetch_calls.append((sql, params, self.in_transaction))
        if sql == _MAIN_SQL:
            return list(self.page_rows)
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


class _Pool:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection
        self.acquire_count = 0

    def acquire(self) -> _Context:
        self.acquire_count += 1
        return _Context(self.connection)


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
