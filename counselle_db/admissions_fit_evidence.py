"""Immutable DTOs and read-receipt instrumentation for fit release evidence.

The SQL reader remains intentionally in :mod:`counselle_db.service`; this
module contains no query text and exposes no connection to callers.
"""

from __future__ import annotations

import math
import time
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, MutableMapping, Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from types import MappingProxyType
from typing import Any, ParamSpec, TypeVar, cast

from pydantic import ValidationError

from counselle_db.models import FactValueRow
from domain.admissions_fit import SchoolFactValidationFailure

P = ParamSpec("P")
T = TypeVar("T")

_FACT_ROW_DROP_REASONS = frozenset(
    {
        "not_mapping",
        "invalid_identity_or_fact_key",
        "missing_value",
        "invalid_detail_row",
    }
)
_FIT_BASES = frozenset({"school_rate", "personalized", "missing_admit_rate"})
_FIT_CATEGORIES = frozenset({"Reach", "Target", "Safety", "Unknown"})
_APPLIED_SIGNAL_TYPES = frozenset(
    {
        "academic:gpa_distribution",
        "academic:class_rank",
        "testing:sat",
        "testing:act",
        "testing:sat_and_act",
    }
)
_UNAVAILABLE_REASONS = frozenset(
    {
        "profile_gpa_missing",
        "profile_gpa_invalid",
        "gpa_scale_incompatible",
        "gpa_distribution_unavailable",
        "gpa_distribution_stale",
        "gpa_distribution_invalid",
        "profile_rank_unavailable",
        "rank_disabled",
        "rank_distribution_unavailable",
        "rank_distribution_stale",
        "rank_distribution_invalid",
        "profile_test_missing",
        "test_score_invalid",
        "incomplete_sat_comparison",
        "test_band_unavailable",
        "test_band_stale",
        "test_band_invalid",
        "test_policy_not_required_or_unknown",
    }
)
_VALIDATION_FAILURE_REASONS = frozenset(reason.value for reason in SchoolFactValidationFailure)

# Deliberately a module-level seam rather than wall-clock time: both the fixed
# detail query and its request wrapper use it, so their timing is deterministic
# under tests and immune to system-clock jumps in production.
_monotonic_clock: Callable[[], float] = time.monotonic


@dataclass(frozen=True, slots=True)
class AdmissionsFitBatchReadReceipt:
    """The non-identifying facts-batch and adapter receipt for one request."""

    batch_query_latency_ms: int | None
    fact_row_drop_counts: Mapping[str, int]
    validation_failure_counts: Mapping[str, int]


_EMPTY_FACT_ROW_DROP_COUNTS: Mapping[str, int] = MappingProxyType({})
_EMPTY_VALIDATION_FAILURE_COUNTS: Mapping[str, int] = MappingProxyType({})
_EMPTY_BATCH_READ_RECEIPT = AdmissionsFitBatchReadReceipt(
    batch_query_latency_ms=None,
    fact_row_drop_counts=_EMPTY_FACT_ROW_DROP_COUNTS,
    validation_failure_counts=_EMPTY_VALIDATION_FAILURE_COUNTS,
)
_batch_read_receipt: ContextVar[AdmissionsFitBatchReadReceipt] = ContextVar(
    "admissions_fit_batch_read_receipt",
    default=_EMPTY_BATCH_READ_RECEIPT,
)


def admissions_fit_monotonic_seconds() -> float:
    """Return the injectable monotonic clock used by admissions-fit telemetry."""
    return _monotonic_clock()


def reset_admissions_fit_batch_read_receipt() -> None:
    """Clear a task-local receipt before an Explore request or test double runs."""
    _batch_read_receipt.set(_EMPTY_BATCH_READ_RECEIPT)


def admissions_fit_batch_read_receipt() -> AdmissionsFitBatchReadReceipt:
    """Return only aggregate timing and row-validation counters for this task."""
    return _batch_read_receipt.get()


def record_admissions_fit_batch_read_receipt(
    *,
    batch_query_latency_ms: int | None,
    fact_row_drop_counts: Mapping[str, int],
) -> None:
    """Publish an immutable bounded receipt without retaining any fact row."""
    valid_counts: dict[str, int] = {
        reason: count
        for reason, count in sorted(fact_row_drop_counts.items())
        if reason in _FACT_ROW_DROP_REASONS
        and isinstance(count, int)
        and not isinstance(count, bool)
        and count > 0
    }
    latency = (
        max(0, batch_query_latency_ms)
        if isinstance(batch_query_latency_ms, int) and not isinstance(batch_query_latency_ms, bool)
        else None
    )
    _batch_read_receipt.set(
        AdmissionsFitBatchReadReceipt(
            batch_query_latency_ms=latency,
            fact_row_drop_counts=MappingProxyType(valid_counts),
            validation_failure_counts=_batch_read_receipt.get().validation_failure_counts,
        )
    )


def record_admissions_fit_validation_failure_counts(
    counts: Mapping[SchoolFactValidationFailure, int],
) -> None:
    """Store one bounded adapter aggregate without retaining source values.

    The app assembler calls this once after adapting the page.  Keeping it in
    the task-local receipt lets the decorator log the aggregate on its one
    request event while leaving the Explore response unchanged.
    """
    valid_counts: dict[str, int] = {
        reason.value: count
        for reason, count in sorted(counts.items(), key=lambda item: str(item[0]))
        if reason.value in _VALIDATION_FAILURE_REASONS
        and isinstance(count, int)
        and not isinstance(count, bool)
        and count > 0
    }
    receipt = _batch_read_receipt.get()
    _batch_read_receipt.set(
        AdmissionsFitBatchReadReceipt(
            batch_query_latency_ms=receipt.batch_query_latency_ms,
            fact_row_drop_counts=receipt.fact_row_drop_counts,
            validation_failure_counts=MappingProxyType(valid_counts),
        )
    )


def admissions_fit_elapsed_ms(started_at: float) -> int | None:
    """Return a safe monotonic duration for an aggregate metric field."""
    elapsed = admissions_fit_monotonic_seconds() - started_at
    if not math.isfinite(elapsed):
        return None
    return max(0, int(elapsed * 1000))


def _fit_observation_counts(fits: Sequence[Any]) -> dict[str, dict[str, int]]:
    """Count only closed fit enums, never any card identity or Profile field."""
    bases: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    applied_signals: Counter[str] = Counter()
    unavailable: Counter[str] = Counter()
    for fit in fits:
        basis = getattr(fit, "basis", None)
        if basis in _FIT_BASES:
            bases[basis] += 1
        category = getattr(fit, "category", None)
        if category in _FIT_CATEGORIES:
            categories[category] += 1
        for signal in getattr(fit, "signals", ()):
            signal_type = f"{getattr(signal, 'factor', '')}:{getattr(signal, 'source', '')}"
            if signal_type in _APPLIED_SIGNAL_TYPES:
                applied_signals[signal_type] += 1
        for item in getattr(fit, "unavailable", ()):
            reason = getattr(item, "reason", None)
            if reason in _UNAVAILABLE_REASONS:
                unavailable[reason] += 1
    return {
        "basis_counts": dict(sorted(bases.items())),
        "category_counts": dict(sorted(categories.items())),
        "applied_signal_counts": dict(sorted(applied_signals.items())),
        "unavailable_reason_counts": dict(sorted(unavailable.items())),
    }


def observe_admissions_fit_explore(
    logger: Any,
) -> Callable[[Callable[P, Awaitable[T]]], Callable[P, Awaitable[T]]]:
    """Emit one aggregate request metric on either Explore success or failure.

    The wrapped function's response is inspected only for its already-safe
    fit enums. Exceptions are deliberately re-raised unchanged and never
    attached to telemetry, because their text could contain inputs or IDs.
    """

    def decorate(function: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @wraps(function)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            started_at = admissions_fit_monotonic_seconds()
            reset_admissions_fit_batch_read_receipt()
            outcome = "failed"
            counts = _fit_observation_counts(())
            try:
                response = await function(*args, **kwargs)
                response_any = cast(Any, response)
                counts = _fit_observation_counts(
                    tuple(school.fit for school in response_any.schools)
                )
                outcome = "succeeded"
                return response
            finally:
                receipt = admissions_fit_batch_read_receipt()
                logger.info(
                    "admissions_fit_explore_observed",
                    outcome=outcome,
                    **counts,
                    validation_failure_counts=dict(receipt.validation_failure_counts),
                    fact_row_drop_counts=dict(receipt.fact_row_drop_counts),
                    batch_query_latency_ms=receipt.batch_query_latency_ms,
                    total_explore_latency_ms=admissions_fit_elapsed_ms(started_at),
                )

        return wrapper

    return decorate


@dataclass(frozen=True, slots=True)
class AdmissionsFitEvidenceSchool:
    """One school identifier and canonical ``school_explore`` admit rate."""

    school_id: int
    admit_rate: object


@dataclass(frozen=True, slots=True)
class AdmissionsFitEvidenceSnapshot:
    """Profile-free canonical rate and fixed-key fact inputs."""

    schools: tuple[AdmissionsFitEvidenceSchool, ...]
    facts_by_school: Mapping[int, tuple[FactValueRow, ...]]
    source_fact_row_count: int


@dataclass(slots=True)
class _AdmissionsFitSnapshotLease:
    active: bool = True


@dataclass(frozen=True, slots=True)
class AdmissionsFitBenchmarkSnapshot:
    """Opaque PostgreSQL snapshot handle valid only inside its context."""

    _snapshot_id: str
    _lease: _AdmissionsFitSnapshotLease


@dataclass(frozen=True, slots=True)
class AdmissionsFitBenchmarkRequest:
    """One actual request receipt plus its immutable source inputs."""

    snapshot: AdmissionsFitEvidenceSnapshot
    select_count: int
    transaction_count: int


class _ObservedBenchmarkConnection:
    """Proxy that derives the request receipt from actual connection calls."""

    __slots__ = ("_connection", "select_count", "transaction_count")

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self.select_count = 0
        self.transaction_count = 0

    def transaction(self, **kwargs: object) -> Any:
        self.transaction_count += 1
        return self._connection.transaction(**kwargs)

    async def fetch(self, sql: str, *params: Any) -> Any:
        self.select_count += 1
        return await self._connection.fetch(sql, *params)

    async def fetchrow(self, sql: str, *params: Any) -> Any:
        self.select_count += 1
        return await self._connection.fetchrow(sql, *params)

    async def fetchval(self, sql: str, *params: Any) -> Any:
        self.select_count += 1
        return await self._connection.fetchval(sql, *params)

    async def execute(self, sql: str, *params: Any) -> Any:
        if sql.lstrip().upper().startswith("SELECT"):
            self.select_count += 1
        return await self._connection.execute(sql, *params)


class _FrozenJsonList(Sequence[Any]):
    """Immutable JSON array retaining the adapter's ``isinstance(..., list)`` guard."""

    __slots__ = ("_items",)

    def __init__(self, values: Sequence[Any]) -> None:
        object.__setattr__(self, "_items", tuple(_freeze_json(value) for value in values))

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __getattribute__(self, name: str) -> Any:
        return list if name == "__class__" else super().__getattribute__(name)

    def __getitem__(self, index: int | slice) -> Any:
        return self._items[index]

    def __len__(self) -> int:
        return len(self._items)

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, Sequence)
            and not isinstance(other, (str, bytes, bytearray))
            and bool(self._items == tuple(other))
        )

    def __repr__(self) -> str:
        return repr(list(self._items))


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return _FrozenJsonList(value)
    if isinstance(value, tuple):
        return tuple(_freeze_json(item) for item in value)
    return value


def admissions_fit_fact_value_row(
    record: Any,
    *,
    allowed_school_ids: frozenset[int],
    allowed_fact_keys: frozenset[str],
    fact_row_drop_counts: MutableMapping[str, int] | None = None,
) -> tuple[int, FactValueRow] | None:
    """Drop invalid optional enrichment while preserving a valid page."""

    def drop(reason: str) -> None:
        if fact_row_drop_counts is not None:
            fact_row_drop_counts[reason] = fact_row_drop_counts.get(reason, 0) + 1

    try:
        values = dict(record)
    except (TypeError, ValueError):
        drop("not_mapping")
        return None
    school_id, fact_key = values.pop("school_id", None), values.get("fact_key")
    if (
        isinstance(school_id, bool)
        or not isinstance(school_id, int)
        or school_id not in allowed_school_ids
        or not isinstance(fact_key, str)
        or fact_key not in allowed_fact_keys
    ):
        drop("invalid_identity_or_fact_key")
        return None
    if "value" not in values:
        drop("missing_value")
        return None
    try:
        return school_id, FactValueRow(**{**values, "value": _freeze_json(values["value"])})
    except (TypeError, ValueError, ValidationError):
        drop("invalid_detail_row")
        return None
