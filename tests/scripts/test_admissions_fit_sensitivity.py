from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.facts.admissions_fit_inputs import ADMISSIONS_FIT_FACT_KEYS
from domain.admissions_fit import (
    FitCategory,
    FitEstimate,
    FitSignalSource,
    GpaBucket,
    GpaDistribution,
    ObservedDecimal,
    RankDistribution,
    SchoolFitInputs,
    StudentFitInputs,
    estimate_admissions_fit,
)
from scripts import admissions_fit_sensitivity as sensitivity

AS_OF = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


def _school(rate: str | None = "45") -> SchoolFitInputs:
    return SchoolFitInputs(admit_rate=Decimal(rate) if rate is not None else None)


def test_snapshot_is_canonical_sanitized_and_round_trips_without_profile_data() -> None:
    snapshot = sensitivity.build_snapshot(((42, _school()),))

    payload = sensitivity.canonical_snapshot_bytes(snapshot)
    restored = sensitivity.parse_snapshot_bytes(payload)

    assert payload == sensitivity.canonical_snapshot_bytes(restored)
    assert b"gpa_unweighted" not in payload
    assert b"sat_math" not in payload
    assert restored.schools == ((42, _school()),)
    assert sensitivity.sha256_hex(payload) == sensitivity.sha256_hex(
        sensitivity.canonical_snapshot_bytes(snapshot)
    )


def test_sensitivity_report_is_deterministic_and_covers_the_required_release_fields() -> None:
    snapshot = sensitivity.build_snapshot(((1, _school("19")), (2, _school("45"))))
    manifest = sensitivity.build_manifest(snapshot=snapshot, as_of=AS_OF)

    report = sensitivity.build_report(
        snapshot=snapshot,
        manifest=manifest,
        as_of=AS_OF,
        stale_after_days=120,
    )

    assert report == sensitivity.build_report(
        snapshot=snapshot,
        manifest=manifest,
        as_of=AS_OF,
        stale_after_days=120,
    )
    for heading in (
        "## Coverage by basis",
        "## Category transitions by baseline band",
        "## Auxiliary-evidence rejections",
        "## GPA and rank validation",
        "## Test-policy gating",
        "## Optional-source nullification",
        "## Boundary samples",
        "## Invariants and release gates",
        "entering_class_benchmark_not_cutoff",
    ):
        assert heading in report
    assert "PASS — no sub-20% school upgrades from Reach" in report
    assert "PASS — no estimate skips a category" in report
    assert "Nullification mismatches: 0" in report
    assert "Discriminating control failures: 0" in report
    assert (
        "The retained `school_id` values are public IPEDS UNITIDs (public school identifiers), "
        "not student identifiers or private data."
    ) in report


def test_manifest_pins_the_current_allowlist_exact_synthetic_profiles_and_snapshot_hash() -> None:
    snapshot = sensitivity.build_snapshot(((9, _school()),), source_fact_row_count=11)

    manifest = sensitivity.build_manifest(snapshot=snapshot, as_of=AS_OF)

    assert manifest["algorithm_version"] == "admissions-fit-v1"
    assert manifest["as_of"] == "2026-09-15T12:00:00Z"
    fact_keys = manifest["fact_keys"]
    assert isinstance(fact_keys, list)
    assert tuple(fact_keys) == ADMISSIONS_FIT_FACT_KEYS
    assert manifest["source_row_count"] == 1
    assert manifest["source_fact_row_count"] == 11
    assert manifest["input_sha256"] == sensitivity.sha256_hex(
        sensitivity.canonical_snapshot_bytes(snapshot)
    )
    assert manifest["synthetic_profiles"] == sensitivity.SYNTHETIC_PROFILES_MANIFEST


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-09-15T12:00:00Z", AS_OF),
        ("2026-09-15T14:00:00+02:00", AS_OF),
    ],
)
def test_parse_as_of_normalizes_an_explicit_offset_to_utc(raw: str, expected: datetime) -> None:
    assert sensitivity.parse_as_of(raw) == expected


@pytest.mark.parametrize("raw", ("2026-09-15", "not-a-date", "2026-09-15T12:00:00"))
def test_parse_as_of_rejects_missing_timezone(raw: str) -> None:
    with pytest.raises(ValueError, match="UTC offset"):
        sensitivity.parse_as_of(raw)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("input_sha256", "0" * 64, "SHA-256"),
        ("script_version", "admissions-fit-sensitivity-v0", "script version"),
        ("source_row_count", 2, "source row count"),
        ("source_fact_row_count", 1, "source fact row count"),
        ("algorithm_version", "admissions-fit-v0", "algorithm version"),
        ("fact_keys", [], "fact-key"),
        ("synthetic_profiles", [], "synthetic profiles"),
    ],
    ids=(
        "input-hash",
        "script-version",
        "school-row-count",
        "fact-row-count",
        "algorithm-version",
        "fact-key-list",
        "synthetic-profiles",
    ),
)
def test_snapshot_replay_rejects_each_tampered_pinned_provenance_field(
    field: str, value: object, message: str
) -> None:
    snapshot = sensitivity.build_snapshot(((1, _school()),), source_fact_row_count=3)
    manifest = sensitivity.build_manifest(snapshot=snapshot, as_of=AS_OF)

    with pytest.raises(ValueError, match=message):
        sensitivity.validate_replay_manifest(
            snapshot=snapshot,
            manifest={**manifest, field: value},
            as_of=AS_OF,
        )


def test_snapshot_replay_rejects_an_as_of_mismatch() -> None:
    snapshot = sensitivity.build_snapshot(((1, _school()),))
    manifest = sensitivity.build_manifest(snapshot=snapshot, as_of=AS_OF)

    with pytest.raises(ValueError, match="--as-of"):
        sensitivity.validate_replay_manifest(
            snapshot=snapshot,
            manifest=manifest,
            as_of=datetime(2026, 9, 16, tzinfo=UTC),
        )


def test_snapshot_binds_the_raw_fixed_fact_count_and_replay_report_bytes() -> None:
    snapshot = sensitivity.build_snapshot(
        ((1, _school("19")), (2, _school("45"))), source_fact_row_count=23
    )
    manifest = sensitivity.build_manifest(snapshot=snapshot, as_of=AS_OF)
    snapshot_bytes = sensitivity.canonical_snapshot_bytes(snapshot)
    report = sensitivity.build_report(
        snapshot=snapshot,
        manifest=manifest,
        as_of=AS_OF,
        stale_after_days=120,
    )

    restored = sensitivity.parse_snapshot_bytes(snapshot_bytes)
    replay_manifest = dict(manifest)
    assert (
        sensitivity.validate_replay_manifest(
            snapshot=restored, manifest=replay_manifest, as_of=AS_OF
        )
        == 120
    )
    assert restored.source_fact_row_count == 23
    assert sensitivity.build_report(
        snapshot=restored,
        manifest=replay_manifest,
        as_of=AS_OF,
        stale_after_days=120,
    ).encode("utf-8") == report.encode("utf-8")


def test_replay_rejects_a_fact_count_changed_inside_the_content_addressed_snapshot() -> None:
    original = sensitivity.build_snapshot(((1, _school()),), source_fact_row_count=3)
    manifest = sensitivity.build_manifest(snapshot=original, as_of=AS_OF)
    tampered = sensitivity.build_snapshot(((1, _school()),), source_fact_row_count=4)
    hash_rewritten_manifest = {
        **manifest,
        "input_sha256": sensitivity.sha256_hex(sensitivity.canonical_snapshot_bytes(tampered)),
    }

    with pytest.raises(ValueError, match="source fact row count"):
        sensitivity.validate_replay_manifest(
            snapshot=tampered,
            manifest=hash_rewritten_manifest,
            as_of=AS_OF,
        )


def test_validation_counts_include_an_invalid_source_hidden_by_academic_fallback() -> None:
    invalid_gpa = GpaDistribution(
        value_type="invalid",
        scale="invalid",
        complete=False,
        observed_at=AS_OF,
        buckets=(),
    )
    valid_gpa = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=AS_OF,
        buckets=(
            GpaBucket(Decimal("0"), Decimal("3.49"), Decimal("75")),
            GpaBucket(Decimal("3.50"), None, Decimal("25")),
        ),
    )
    valid_rank = RankDistribution(
        ObservedDecimal(Decimal("50"), AS_OF),
        ObservedDecimal(Decimal("75"), AS_OF),
        ObservedDecimal(Decimal("90"), AS_OF),
    )
    invalid_rank = RankDistribution(
        ObservedDecimal(None, AS_OF),
        ObservedDecimal(None, AS_OF),
        ObservedDecimal(None, AS_OF),
    )
    snapshot = sensitivity.build_snapshot(
        (
            (
                1,
                SchoolFitInputs(
                    Decimal("45"),
                    gpa_distribution=invalid_gpa,
                    rank_distribution=valid_rank,
                ),
            ),
            (
                2,
                SchoolFitInputs(
                    Decimal("45"),
                    gpa_distribution=valid_gpa,
                    rank_distribution=invalid_rank,
                ),
            ),
        )
    )

    counts = sensitivity.source_validation_counts(
        snapshot=snapshot,
        as_of=AS_OF,
        stale_after_days=120,
    )

    assert counts == {"gpa_distribution_invalid": 1, "rank_distribution_invalid": 1}

    profile = dict(sensitivity.SYNTHETIC_PROFILES)["middle-v1"]
    gpa_invalid_rank_usable = estimate_admissions_fit(
        snapshot.schools[0][1], profile, now=AS_OF, stale_after_days=120
    )
    rank_invalid_gpa_usable = estimate_admissions_fit(
        snapshot.schools[1][1], profile, now=AS_OF, stale_after_days=120
    )
    assert gpa_invalid_rank_usable.signals[0].source is FitSignalSource.CLASS_RANK
    assert rank_invalid_gpa_usable.signals[0].source is FitSignalSource.GPA_DISTRIBUTION


def test_stale_source_validation_uses_calculator_parity_without_applied_stale_signal() -> None:
    stale_at = AS_OF - timedelta(days=121)
    valid_gpa = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=AS_OF,
        buckets=(
            GpaBucket(Decimal("0"), Decimal("3.49"), Decimal("75")),
            GpaBucket(Decimal("3.50"), None, Decimal("25")),
        ),
    )
    valid_rank = RankDistribution(
        ObservedDecimal(Decimal("50"), AS_OF),
        ObservedDecimal(Decimal("75"), AS_OF),
        ObservedDecimal(Decimal("90"), AS_OF),
    )
    stale_gpa = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=stale_at,
        buckets=valid_gpa.buckets,
    )
    stale_rank = RankDistribution(
        ObservedDecimal(Decimal("50"), stale_at),
        ObservedDecimal(Decimal("75"), stale_at),
        ObservedDecimal(Decimal("90"), stale_at),
    )
    snapshot = sensitivity.build_snapshot(
        (
            (
                1,
                SchoolFitInputs(
                    Decimal("45"),
                    gpa_distribution=stale_gpa,
                    rank_distribution=valid_rank,
                ),
            ),
            (
                2,
                SchoolFitInputs(
                    Decimal("45"),
                    gpa_distribution=valid_gpa,
                    rank_distribution=stale_rank,
                ),
            ),
        )
    )

    counts = sensitivity.source_validation_counts(
        snapshot=snapshot,
        as_of=AS_OF,
        stale_after_days=120,
    )

    assert counts == {"gpa_distribution_stale": 1, "rank_distribution_stale": 1}
    profile = dict(sensitivity.SYNTHETIC_PROFILES)["middle-v1"]
    assert (
        estimate_admissions_fit(snapshot.schools[0][1], profile, now=AS_OF, stale_after_days=120)
        .signals[0]
        .source
        is FitSignalSource.CLASS_RANK
    )
    assert (
        estimate_admissions_fit(snapshot.schools[1][1], profile, now=AS_OF, stale_after_days=120)
        .signals[0]
        .source
        is FitSignalSource.GPA_DISTRIBUTION
    )


def test_exact_synthetic_profiles_are_immutable_calculator_inputs() -> None:
    assert (
        (
            "low-v1",
            StudentFitInputs(
                Decimal("2.75"),
                Decimal("4.0"),
                Decimal("75"),
                Decimal("100"),
                None,
                Decimal("450"),
                Decimal("450"),
                Decimal("18"),
            ),
        ),
        (
            "middle-v1",
            StudentFitInputs(
                Decimal("3.50"),
                Decimal("4.0"),
                Decimal("25"),
                Decimal("100"),
                None,
                Decimal("600"),
                Decimal("600"),
                Decimal("26"),
            ),
        ),
        (
            "high-v1",
            StudentFitInputs(
                Decimal("4.00"),
                Decimal("4.0"),
                Decimal("1"),
                Decimal("100"),
                None,
                Decimal("800"),
                Decimal("800"),
                Decimal("36"),
            ),
        ),
    ) == sensitivity.SYNTHETIC_PROFILES


def test_source_nullification_covers_every_optional_family_and_fallback_without_pii() -> None:
    result = sensitivity.evaluate_optional_source_nullification(
        as_of=AS_OF,
        stale_after_days=120,
    )

    expected_categories = {
        "gpa_distribution/missing",
        "gpa_distribution/malformed",
        "gpa_distribution/stale",
        "gpa_distribution/future",
        "rank_distribution/missing",
        "rank_distribution/malformed",
        "rank_distribution/stale",
        "rank_distribution/future",
        "sat_math_band/missing",
        "sat_math_band/malformed",
        "sat_math_band/stale",
        "sat_math_band/future",
        "sat_ebrw_band/missing",
        "sat_ebrw_band/malformed",
        "sat_ebrw_band/stale",
        "sat_ebrw_band/future",
        "act_band/missing",
        "act_band/malformed",
        "act_band/stale",
        "act_band/future",
        "required_policy/complete_sat_not_required_or_unknown",
        "required_policy/act_not_required_or_unknown",
        "academic_fallback/gpa_unusable_rank_usable",
        "academic_fallback/rank_unusable_gpa_usable",
        "academic_fallback/both_unusable",
    }

    assert result.check_count >= len(expected_categories)
    assert result.mismatch_count == 0
    assert result.control_failure_count == 0
    assert expected_categories <= set(result.checks_by_category)
    assert result.failure_categories == {}
    assert all(
        "school" not in category and "profile" not in category
        for category in result.checks_by_category
    )


def test_source_nullification_detects_an_injected_invalid_gpa_application() -> None:
    def faulty_estimator(
        school: SchoolFitInputs,
        student: StudentFitInputs,
        *,
        now: datetime,
        stale_after_days: int,
    ) -> FitEstimate:
        # Deliberately emulate the prohibited behavior: an invalid GPA payload
        # still produces a category-moving academic effect.
        result = estimate_admissions_fit(
            school,
            student,
            now=now,
            stale_after_days=stale_after_days,
        )
        if school.gpa_distribution is not None and school.gpa_distribution.value_type == "invalid":
            return replace(result, category=FitCategory.SAFETY)
        return result

    result = sensitivity.evaluate_optional_source_nullification(
        as_of=AS_OF,
        stale_after_days=120,
        estimator=faulty_estimator,
    )

    assert result.mismatch_count > 0
    assert result.failure_categories["gpa_distribution/malformed"] > 0


def test_release_gate_depends_on_zero_source_nullification_mismatches() -> None:
    snapshot = sensitivity.build_snapshot(((1, _school("45")),))
    runs = sensitivity.run_sensitivity(snapshot=snapshot, as_of=AS_OF, stale_after_days=120)

    def faulty_estimator(
        school: SchoolFitInputs,
        student: StudentFitInputs,
        *,
        now: datetime,
        stale_after_days: int,
    ) -> FitEstimate:
        result = estimate_admissions_fit(
            school,
            student,
            now=now,
            stale_after_days=stale_after_days,
        )
        if school.gpa_distribution is not None and school.gpa_distribution.value_type == "invalid":
            return replace(result, category=FitCategory.SAFETY)
        return result

    gates = sensitivity.evaluate_release_gates(
        snapshot=snapshot,
        runs=runs,
        as_of=AS_OF,
        stale_after_days=120,
        nullification_estimator=faulty_estimator,
    )

    gate = next(gate for gate in gates if gate.name == "unusable optional sources nullify")
    assert not gate.passed
    assert "mismatches=" in gate.detail
