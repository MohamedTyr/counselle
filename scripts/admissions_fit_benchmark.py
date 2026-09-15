"""Read-only, snapshot-consistent incremental benchmark for admissions-fit-v1.

This is intentionally a fit-path benchmark: it compares the single Explore
page query with that query plus its one fixed-key facts batch, adapter and pure
calculator.  It does not pretend to measure full HTTP endpoint latency.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.facts.admissions_fit_inputs import school_fit_inputs_from_facts
from config.settings import Settings, get_settings
from counselle_db.db import create_pool
from counselle_db.service import (
    AdmissionsFitBenchmarkSnapshot,
    exported_admissions_fit_benchmark_snapshot,
    read_admissions_fit_benchmark_request,
)
from domain.admissions_fit import estimate_admissions_fit
from scripts import admissions_fit_sensitivity as sensitivity

BENCHMARK_VERSION = "admissions-fit-benchmark-v1"
MEASURED_REQUESTS = 20
WARMUP_REQUESTS = 1
P95_INCREMENTAL_BUDGET_MS = 100.0


@dataclass(frozen=True, slots=True)
class PageMeasurement:
    """Raw millisecond samples plus logical request-path query receipts."""

    page_size: int
    before_ms: tuple[float, ...]
    after_ms: tuple[float, ...]
    before_statement_count: int
    after_statement_count: int
    before_transaction_count: int
    after_transaction_count: int


@dataclass(frozen=True, slots=True)
class _WorkloadSample:
    elapsed_ms: float
    select_count: int
    transaction_count: int


def p95(samples: Sequence[float]) -> float:
    """Nearest-rank p95; twenty samples use index 18, never interpolated."""
    if not samples:
        raise ValueError("p95 requires at least one sample")
    index = math.ceil(0.95 * len(samples)) - 1
    return float(sorted(samples)[index])


def _incremental_p95(measurement: PageMeasurement) -> float:
    return p95(measurement.after_ms) - p95(measurement.before_ms)


def validate_measurements(
    measurements: Sequence[PageMeasurement], *, expected_page_sizes: Sequence[int]
) -> None:
    """Fail closed on a changed request shape or the explicit interaction budget."""
    expected = tuple(expected_page_sizes)
    if tuple(measurement.page_size for measurement in measurements) != expected:
        raise ValueError("benchmark page sizes do not match the required one/default/maximum set")
    if any(
        len(measurement.before_ms) != MEASURED_REQUESTS
        or len(measurement.after_ms) != MEASURED_REQUESTS
        for measurement in measurements
    ):
        raise ValueError(
            f"each benchmark page size requires exactly {MEASURED_REQUESTS} raw samples"
        )
    counts = {
        (
            measurement.before_statement_count,
            measurement.after_statement_count,
            measurement.before_transaction_count,
            measurement.after_transaction_count,
        )
        for measurement in measurements
    }
    if counts != {(1, 2, 1, 1)}:
        raise ValueError(
            "statement and transaction counts must be constant with page size (1/2/1/1)"
        )
    over_budget = tuple(
        measurement.page_size
        for measurement in measurements
        if _incremental_p95(measurement) >= P95_INCREMENTAL_BUDGET_MS
    )
    if over_budget:
        raise ValueError(
            "p95 incremental latency must remain below 100 ms; failed page sizes "
            + ", ".join(str(size) for size in over_budget)
        )


def _raw_float_list(values: Sequence[float]) -> list[float]:
    return [round(float(value), 6) for value in values]


def _measurement_payload(measurement: PageMeasurement) -> dict[str, object]:
    return {
        "after_p95_ms": p95(measurement.after_ms),
        "before_p95_ms": p95(measurement.before_ms),
        "incremental_p95_ms": _incremental_p95(measurement),
        "logical_request_counts": {
            "after_selects": measurement.after_statement_count,
            "after_transactions": measurement.after_transaction_count,
            "before_selects": measurement.before_statement_count,
            "before_transactions": measurement.before_transaction_count,
        },
        "page_size": measurement.page_size,
        "raw_after_ms": _raw_float_list(measurement.after_ms),
        "raw_before_ms": _raw_float_list(measurement.before_ms),
    }


def build_report(
    measurements: Sequence[PageMeasurement], *, expected_page_sizes: Sequence[int]
) -> str:
    """Render a deterministic human-readable gate report from retained raw data."""
    gate_lines: tuple[str, ...]
    try:
        validate_measurements(measurements, expected_page_sizes=expected_page_sizes)
        gate_lines = (
            "- PASS — p95 incremental latency is below 100 ms",
            "- PASS — statement and transaction counts are constant with page size",
        )
    except ValueError as exc:
        gate_lines = (f"- FAIL — {exc}",)
    lines = [
        "# Admissions-fit v1 incremental benchmark",
        "",
        "| page size | before p95 (ms) | with-fit p95 (ms) | incremental p95 (ms) |",
        "| ---: | ---: | ---: | ---: |",
        *(
            (
                f"| {measurement.page_size} | {p95(measurement.before_ms):.6f} | "
                f"{p95(measurement.after_ms):.6f} | {_incremental_p95(measurement):.6f} |"
            )
            for measurement in measurements
        ),
        "",
        "## Raw timings",
        "",
        *(
            f"- page size {measurement.page_size}: "
            f"raw_before_ms={_raw_float_list(measurement.before_ms)}; "
            f"raw_after_ms={_raw_float_list(measurement.after_ms)}"
            for measurement in measurements
        ),
        "",
        "## Release gates",
        "",
        *gate_lines,
        "",
    ]
    return "\n".join(lines)


def benchmark_payload(
    *, measurements: Sequence[PageMeasurement], artifact_manifest: Mapping[str, object]
) -> dict[str, object]:
    """Machine-readable artifact that includes every raw timing and fixed input identity."""
    return {
        "algorithm_version": artifact_manifest["algorithm_version"],
        "as_of": artifact_manifest["as_of"],
        "benchmark_version": BENCHMARK_VERSION,
        "measurement_count": MEASURED_REQUESTS,
        "measurements": [_measurement_payload(measurement) for measurement in measurements],
        "sensitivity_input_sha256": artifact_manifest["input_sha256"],
        "sensitivity_snapshot_relation": (
            "independent sensitivity artifact; before/after measurements share the benchmark's "
            "own exported PostgreSQL snapshot"
        ),
        "snapshot_scope": "one exported local REPEATABLE READ, READ ONLY PostgreSQL snapshot",
        "warmup_count": WARMUP_REQUESTS,
    }


def is_local_postgres_dsn(dsn: str) -> bool:
    """Benchmarking is intentionally local-only; never echo the supplied DSN."""
    parsed = urlsplit(dsn)
    host = parsed.hostname
    return parsed.scheme.startswith("postgres") and host in {"localhost", "127.0.0.1", "::1"}


def validate_benchmark_settings(settings: Settings) -> None:
    """Fail before acquisition: an exported snapshot needs a second connection."""
    if not is_local_postgres_dsn(settings.db_ro_dsn):
        raise ValueError("benchmark refuses a non-local read-only database")
    if settings.db_pool_max < 2:
        raise ValueError("benchmark requires db_pool_max >= 2 for its shared read-only snapshot")


async def _measure_request(
    pool: Any,
    *,
    snapshot: AdmissionsFitBenchmarkSnapshot,
    page_size: int,
    max_page_size: int,
    as_of: datetime,
    stale_after_days: int,
    with_fit: bool,
) -> _WorkloadSample:
    """Time the service-owned request shape and its real instrumentation receipt."""
    started = time.perf_counter_ns()
    receipt = await read_admissions_fit_benchmark_request(
        pool,
        snapshot,
        page_size=page_size,
        include_facts=with_fit,
        max_page_size=max_page_size,
    )
    if with_fit:
        profile = dict(sensitivity.SYNTHETIC_PROFILES)["middle-v1"]
        for school in receipt.snapshot.schools:
            estimate_admissions_fit(
                school_fit_inputs_from_facts(
                    admit_rate=school.admit_rate,
                    facts=receipt.snapshot.facts_by_school[school.school_id],
                    now=as_of,
                    stale_after_days=stale_after_days,
                ),
                profile,
                now=as_of,
                stale_after_days=stale_after_days,
            )
    elapsed_ns = time.perf_counter_ns() - started
    return _WorkloadSample(
        elapsed_ms=elapsed_ns / 1_000_000,
        select_count=receipt.select_count,
        transaction_count=receipt.transaction_count,
    )


async def measure_live(
    *, settings: Settings, as_of: datetime, stale_after_days: int, page_sizes: Sequence[int]
) -> tuple[PageMeasurement, ...]:
    """Measure 1/default/max request-shaped paths on exactly one shared DB snapshot."""
    validate_benchmark_settings(settings)
    pool = await create_pool(settings=settings)
    try:
        async with exported_admissions_fit_benchmark_snapshot(pool) as snapshot:
            measurements: list[PageMeasurement] = []
            for page_size in page_sizes:
                for iteration in range(WARMUP_REQUESTS):
                    first_fit = iteration % 2 == 1
                    await _measure_request(
                        pool,
                        snapshot=snapshot,
                        page_size=page_size,
                        max_page_size=settings.facts_explore_max_page_size,
                        as_of=as_of,
                        stale_after_days=stale_after_days,
                        with_fit=first_fit,
                    )
                    await _measure_request(
                        pool,
                        snapshot=snapshot,
                        page_size=page_size,
                        max_page_size=settings.facts_explore_max_page_size,
                        as_of=as_of,
                        stale_after_days=stale_after_days,
                        with_fit=not first_fit,
                    )
                before: list[_WorkloadSample] = []
                after: list[_WorkloadSample] = []
                for iteration in range(MEASURED_REQUESTS):
                    first_fit = iteration % 2 == 1
                    first = await _measure_request(
                        pool,
                        snapshot=snapshot,
                        page_size=page_size,
                        max_page_size=settings.facts_explore_max_page_size,
                        as_of=as_of,
                        stale_after_days=stale_after_days,
                        with_fit=first_fit,
                    )
                    second = await _measure_request(
                        pool,
                        snapshot=snapshot,
                        page_size=page_size,
                        max_page_size=settings.facts_explore_max_page_size,
                        as_of=as_of,
                        stale_after_days=stale_after_days,
                        with_fit=not first_fit,
                    )
                    (after if first_fit else before).append(first)
                    (before if first_fit else after).append(second)
                before_select_counts = {sample.select_count for sample in before}
                after_select_counts = {sample.select_count for sample in after}
                before_transaction_counts = {sample.transaction_count for sample in before}
                after_transaction_counts = {sample.transaction_count for sample in after}
                if (
                    len(before_select_counts) != 1
                    or len(after_select_counts) != 1
                    or len(before_transaction_counts) != 1
                    or len(after_transaction_counts) != 1
                ):
                    raise ValueError(
                        "logical query or transaction counts varied within one page size"
                    )
                measurements.append(
                    PageMeasurement(
                        page_size=page_size,
                        before_ms=tuple(sample.elapsed_ms for sample in before),
                        after_ms=tuple(sample.elapsed_ms for sample in after),
                        before_statement_count=before_select_counts.pop(),
                        after_statement_count=after_select_counts.pop(),
                        before_transaction_count=before_transaction_counts.pop(),
                        after_transaction_count=after_transaction_counts.pop(),
                    )
                )
    finally:
        await pool.close()
    return tuple(measurements)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", required=True, type=Path)
    parser.add_argument("--iterations", type=int, default=MEASURED_REQUESTS, help=argparse.SUPPRESS)
    parser.add_argument("--warmups", type=int, default=WARMUP_REQUESTS, help=argparse.SUPPRESS)
    return parser


async def _run(args: argparse.Namespace) -> int:
    if args.iterations != MEASURED_REQUESTS or args.warmups != WARMUP_REQUESTS:
        raise ValueError(
            "the release benchmark requires exactly 20 measured requests and one warmup"
        )
    artifact_dir: Path = args.artifact_dir
    snapshot_path = artifact_dir / "input.json"
    manifest_path = artifact_dir / "manifest.json"
    if (artifact_dir / "benchmark.json").exists():
        raise ValueError("benchmark artifact already exists")
    snapshot = sensitivity.parse_snapshot_bytes(snapshot_path.read_bytes())
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, Mapping):
        raise ValueError("sensitivity manifest is not an object")
    as_of = sensitivity.parse_as_of(str(manifest.get("as_of", "")))
    stale_after_days = sensitivity.validate_replay_manifest(
        snapshot=snapshot,
        manifest=manifest,
        as_of=as_of,
    )
    settings = get_settings()
    page_sizes = (
        1,
        settings.facts_explore_page_size,
        settings.facts_explore_max_page_size,
    )
    measurements = await measure_live(
        settings=settings,
        as_of=as_of,
        stale_after_days=stale_after_days,
        page_sizes=page_sizes,
    )
    validate_measurements(measurements, expected_page_sizes=page_sizes)
    payload = benchmark_payload(measurements=measurements, artifact_manifest=manifest)
    (artifact_dir / "benchmark.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(artifact_dir / "benchmark.json")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"admissions-fit benchmark failed: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
