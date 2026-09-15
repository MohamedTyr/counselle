from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest

from scripts import admissions_fit_benchmark as benchmark


def _series(*values: float) -> tuple[float, ...]:
    return tuple(values)


def test_p95_and_report_retain_raw_timings_and_enforce_all_release_gates() -> None:
    measurements = (
        benchmark.PageMeasurement(
            page_size=1,
            before_ms=_series(*range(1, 21)),
            after_ms=_series(*range(2, 22)),
            before_statement_count=1,
            after_statement_count=2,
            before_transaction_count=1,
            after_transaction_count=1,
        ),
        benchmark.PageMeasurement(
            page_size=24,
            before_ms=_series(*range(3, 23)),
            after_ms=_series(*range(4, 24)),
            before_statement_count=1,
            after_statement_count=2,
            before_transaction_count=1,
            after_transaction_count=1,
        ),
        benchmark.PageMeasurement(
            page_size=100,
            before_ms=_series(*range(5, 25)),
            after_ms=_series(*range(6, 26)),
            before_statement_count=1,
            after_statement_count=2,
            before_transaction_count=1,
            after_transaction_count=1,
        ),
    )

    report = benchmark.build_report(measurements, expected_page_sizes=(1, 24, 100))

    assert benchmark.p95(_series(*range(1, 21))) == 19.0
    assert "raw_before_ms" in report
    assert "raw_after_ms" in report
    assert "PASS — p95 incremental latency is below 100 ms" in report
    assert "PASS — statement and transaction counts are constant with page size" in report


def test_benchmark_report_rejects_over_budget_latency_and_variable_query_counts() -> None:
    over_budget = benchmark.PageMeasurement(
        page_size=1,
        before_ms=(1.0,) * 20,
        after_ms=(102.0,) * 20,
        before_statement_count=1,
        after_statement_count=2,
        before_transaction_count=1,
        after_transaction_count=1,
    )
    changed_count = benchmark.PageMeasurement(
        page_size=24,
        before_ms=(1.0,) * 20,
        after_ms=(2.0,) * 20,
        before_statement_count=2,
        after_statement_count=2,
        before_transaction_count=1,
        after_transaction_count=1,
    )

    with pytest.raises(ValueError, match="p95 incremental"):
        benchmark.validate_measurements((over_budget,), expected_page_sizes=(1,))
    with pytest.raises(ValueError, match="constant"):
        benchmark.validate_measurements(
            (replace(over_budget, after_ms=(2.0,) * 20), changed_count),
            expected_page_sizes=(1, 24),
        )


def test_benchmark_argument_contract_requires_a_sensitivity_artifact_directory() -> None:
    parser = benchmark.build_parser()

    args = parser.parse_args(["--artifact-dir", "artifacts/admissions-fit/example"])

    assert args.artifact_dir.name == "example"
    assert args.iterations == 20
    assert args.warmups == 1


def test_benchmark_refuses_remote_or_single_connection_pools_before_acquiring() -> None:
    remote = SimpleNamespace(db_ro_dsn="postgresql://reader@db.example.test/cd", db_pool_max=2)
    too_small = SimpleNamespace(db_ro_dsn="postgresql://reader@localhost/cd", db_pool_max=1)

    with pytest.raises(ValueError, match="non-local"):
        benchmark.validate_benchmark_settings(remote)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="db_pool_max >= 2"):
        benchmark.validate_benchmark_settings(too_small)  # type: ignore[arg-type]
