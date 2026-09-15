"""Deterministic, read-only release evidence for ``admissions-fit-v1``.

The artifact deliberately exports only the calculator's school-side domain
inputs.  It never reads a workspace Profile and it does not preserve arbitrary
crawler payloads.  Re-running with ``--snapshot`` and its ``--manifest`` uses
that immutable sanitized input rather than reaching the database again.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from types import MappingProxyType
from typing import Any

from app.facts.admissions_fit_inputs import (
    ADMISSIONS_FIT_FACT_KEYS,
    school_fit_inputs_from_facts,
)
from config.settings import get_settings
from counselle_db.db import create_pool
from counselle_db.service import export_admissions_fit_evidence_snapshot
from domain.admissions_fit import (
    ALGORITHM_VERSION,
    Assessment,
    CaveatCode,
    FitCategory,
    FitEstimate,
    FitFactor,
    GpaBucket,
    GpaDistribution,
    ObservedDecimal,
    RankDistribution,
    SchoolFitInputs,
    SchoolSatBands,
    ScoreBand,
    StudentFitInputs,
    TestPolicy,
    UnavailableReason,
    estimate_admissions_fit,
)

# Deliberate non-wire release-analysis parity seam: the report must count each
# optional source using the calculator's exact validation, even when the other
# academic source is a valid runtime fallback.
from domain.admissions_fit.calculator import _gpa_distribution_state, _rank_values

SCRIPT_VERSION = "admissions-fit-sensitivity-v2"
SNAPSHOT_VERSION = "admissions-fit-input-snapshot-v2"
MANIFEST_VERSION = "admissions-fit-manifest-v2"
DEFAULT_STALE_AFTER_DAYS = 120
_ARTIFACT_ROOT = Path("artifacts/admissions-fit")
_BOUNDARIES = (Decimal("20"), Decimal("50"))
_ADJUSTMENT_WINDOW = Decimal("12")


@dataclass(frozen=True, slots=True)
class SensitivitySnapshot:
    """A sorted, sanitized and replayable set of calculator school inputs."""

    schools: tuple[tuple[int, SchoolFitInputs], ...]
    # This is the raw fixed-key reader count before its strict adapter rejects
    # malformed / duplicate / out-of-contract values.  It is included in the
    # content-addressed snapshot because it cannot be reconstructed from the
    # post-adapter DTOs alone.
    source_fact_row_count: int = 0


@dataclass(frozen=True, slots=True)
class GateResult:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True, slots=True)
class SensitivityRun:
    school_id: int
    profile_id: str
    estimate: FitEstimate


@dataclass(frozen=True, slots=True)
class SourceNullificationProbe:
    """One non-PII, category-discriminating optional-source safety probe."""

    category: str
    unusable_school: SchoolFitInputs
    removed_school: SchoolFitInputs
    trusted_school: SchoolFitInputs
    student: StudentFitInputs


@dataclass(frozen=True, slots=True)
class SourceNullificationResult:
    """Aggregate only diagnostic categories; never school/profile identifiers."""

    check_count: int
    mismatch_count: int
    control_failure_count: int
    checks_by_category: Mapping[str, int]
    failure_categories: Mapping[str, int]


def _decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


SYNTHETIC_PROFILES: tuple[tuple[str, StudentFitInputs], ...] = (
    (
        "low-v1",
        StudentFitInputs(
            gpa_unweighted=Decimal("2.75"),
            gpa_scale=Decimal("4.0"),
            class_rank=Decimal("75"),
            class_size=Decimal("100"),
            sat_math=Decimal("450"),
            sat_ebrw=Decimal("450"),
            act_composite=Decimal("18"),
        ),
    ),
    (
        "middle-v1",
        StudentFitInputs(
            gpa_unweighted=Decimal("3.50"),
            gpa_scale=Decimal("4.0"),
            class_rank=Decimal("25"),
            class_size=Decimal("100"),
            sat_math=Decimal("600"),
            sat_ebrw=Decimal("600"),
            act_composite=Decimal("26"),
        ),
    ),
    (
        "high-v1",
        StudentFitInputs(
            gpa_unweighted=Decimal("4.00"),
            gpa_scale=Decimal("4.0"),
            class_rank=Decimal("1"),
            class_size=Decimal("100"),
            sat_math=Decimal("800"),
            sat_ebrw=Decimal("800"),
            act_composite=Decimal("36"),
        ),
    ),
)
SYNTHETIC_PROFILES_MANIFEST: tuple[dict[str, object], ...] = tuple(
    {
        "id": profile_id,
        "gpa_unweighted": _decimal_text(profile.gpa_unweighted),
        "gpa_scale": _decimal_text(profile.gpa_scale),
        "class_rank": _decimal_text(profile.class_rank),
        "class_size": _decimal_text(profile.class_size),
        "sat_math": _decimal_text(profile.sat_math),
        "sat_ebrw": _decimal_text(profile.sat_ebrw),
        "act_composite": _decimal_text(profile.act_composite),
    }
    for profile_id, profile in SYNTHETIC_PROFILES
)


def _datetime_text(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_as_of(value: str) -> datetime:
    """Parse an explicit timezone-aware timestamp into canonical UTC."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("--as-of must be an ISO-8601 timestamp with a UTC offset") from exc
    if parsed.tzinfo is None:
        raise ValueError("--as-of must be an ISO-8601 timestamp with a UTC offset")
    return parsed.astimezone(UTC)


def _nonnegative_count(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def build_snapshot(
    rows: Iterable[tuple[int, SchoolFitInputs]], *, source_fact_row_count: int = 0
) -> SensitivitySnapshot:
    """Freeze valid school-side calculator inputs in a canonical school-id order."""
    schools: list[tuple[int, SchoolFitInputs]] = []
    seen: set[int] = set()
    for school_id, school in rows:
        if isinstance(school_id, bool) or not isinstance(school_id, int) or school_id <= 0:
            raise ValueError("snapshot school ids must be positive integers")
        if school_id in seen or not isinstance(school, SchoolFitInputs):
            raise ValueError("snapshot school ids and inputs must be unique and typed")
        seen.add(school_id)
        schools.append((school_id, school))
    return SensitivitySnapshot(
        tuple(sorted(schools, key=lambda item: item[0])),
        _nonnegative_count(source_fact_row_count, "snapshot source_fact_row_count"),
    )


def _observed_payload(value: ObservedDecimal | None) -> dict[str, str | None] | None:
    if value is None:
        return None
    return {"observed_at": _datetime_text(value.observed_at), "value": _decimal_text(value.value)}


def _band_payload(value: ScoreBand | None) -> dict[str, object] | None:
    if value is None:
        return None
    return {"p25": _observed_payload(value.p25), "p75": _observed_payload(value.p75)}


def _school_payload(school: SchoolFitInputs) -> dict[str, object]:
    distribution = school.gpa_distribution
    rank = school.rank_distribution
    return {
        "act": _band_payload(school.act),
        "admit_rate": _decimal_text(school.admit_rate),
        "gpa_distribution": None
        if distribution is None
        else {
            "buckets": [
                {
                    "lower": _decimal_text(bucket.lower),
                    "percentage": _decimal_text(bucket.percentage),
                    "upper": _decimal_text(bucket.upper),
                }
                for bucket in distribution.buckets
            ],
            "complete": distribution.complete,
            "observed_at": _datetime_text(distribution.observed_at),
            "scale": distribution.scale,
            "value_type": distribution.value_type,
        },
        "rank_distribution": None
        if rank is None
        else {
            "top_half": _observed_payload(rank.top_half),
            "top_quarter": _observed_payload(rank.top_quarter),
            "top_tenth": _observed_payload(rank.top_tenth),
        },
        "sat": None
        if school.sat is None
        else {
            "ebrw": _band_payload(school.sat.ebrw),
            "math": _band_payload(school.sat.math),
        },
        "stale_optional_facts": school.stale_optional_facts,
        "test_policy": school.test_policy.value,
    }


def _snapshot_payload(snapshot: SensitivitySnapshot) -> dict[str, object]:
    return {
        "schema_version": SNAPSHOT_VERSION,
        "source_fact_row_count": snapshot.source_fact_row_count,
        "schools": [
            {"school_id": school_id, "school": _school_payload(school)}
            for school_id, school in snapshot.schools
        ],
    }


def canonical_snapshot_bytes(snapshot: SensitivitySnapshot) -> bytes:
    """Return the immutable content-addressed representation of the input."""
    return (
        json.dumps(
            _snapshot_payload(snapshot),
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _decimal_from_snapshot(value: object, label: str) -> Decimal | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"snapshot {label} must be a decimal string or null")
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"snapshot {label} is not a decimal") from exc
    if not parsed.is_finite():
        raise ValueError(f"snapshot {label} must be finite")
    return parsed


def _datetime_from_snapshot(value: object, label: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"snapshot {label} must be an ISO timestamp or null")
    try:
        return parse_as_of(value)
    except ValueError as exc:
        raise ValueError(f"snapshot {label} is invalid") from exc


def _required_decimal(value: object, label: str) -> Decimal:
    parsed = _decimal_from_snapshot(value, label)
    if parsed is None:
        raise ValueError(f"snapshot {label} must be a decimal")
    return parsed


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"snapshot {label} must be an object")
    return value


def _observed_from_snapshot(value: object, label: str) -> ObservedDecimal | None:
    if value is None:
        return None
    payload = _mapping(value, label)
    return ObservedDecimal(
        value=_decimal_from_snapshot(payload.get("value"), f"{label}.value"),
        observed_at=_datetime_from_snapshot(payload.get("observed_at"), f"{label}.observed_at"),
    )


def _band_from_snapshot(value: object, label: str) -> ScoreBand | None:
    if value is None:
        return None
    payload = _mapping(value, label)
    return ScoreBand(
        p25=_observed_from_snapshot(payload.get("p25"), f"{label}.p25"),
        p75=_observed_from_snapshot(payload.get("p75"), f"{label}.p75"),
    )


def _school_from_snapshot(value: object) -> SchoolFitInputs:
    payload = _mapping(value, "school")
    distribution_value = payload.get("gpa_distribution")
    distribution: GpaDistribution | None = None
    if distribution_value is not None:
        distribution_payload = _mapping(distribution_value, "gpa_distribution")
        buckets_value = distribution_payload.get("buckets")
        if not isinstance(buckets_value, list):
            raise ValueError("snapshot gpa_distribution.buckets must be a list")
        buckets = tuple(
            GpaBucket(
                lower=_required_decimal(
                    _mapping(item, "gpa bucket").get("lower"), "gpa.lower"
                ),
                upper=_decimal_from_snapshot(
                    _mapping(item, "gpa bucket").get("upper"), "gpa.upper"
                ),
                percentage=_required_decimal(
                    _mapping(item, "gpa bucket").get("percentage"), "gpa.percentage"
                ),
            )
            for item in buckets_value
        )
        complete = distribution_payload.get("complete")
        value_type = distribution_payload.get("value_type")
        scale = distribution_payload.get("scale")
        if (
            not isinstance(complete, bool)
            or not isinstance(value_type, str)
            or not isinstance(scale, str)
        ):
            raise ValueError("snapshot gpa_distribution has invalid scalar fields")
        distribution = GpaDistribution(
            value_type=value_type,
            scale=scale,
            complete=complete,
            observed_at=_datetime_from_snapshot(
                distribution_payload.get("observed_at"), "gpa_distribution.observed_at"
            ),
            buckets=buckets,
        )

    rank_value = payload.get("rank_distribution")
    rank: RankDistribution | None = None
    if rank_value is not None:
        rank_payload = _mapping(rank_value, "rank_distribution")
        rank = RankDistribution(
            top_tenth=_observed_from_snapshot(rank_payload.get("top_tenth"), "rank.top_tenth"),
            top_quarter=_observed_from_snapshot(
                rank_payload.get("top_quarter"), "rank.top_quarter"
            ),
            top_half=_observed_from_snapshot(rank_payload.get("top_half"), "rank.top_half"),
        )

    sat_value = payload.get("sat")
    sat: SchoolSatBands | None = None
    if sat_value is not None:
        sat_payload = _mapping(sat_value, "sat")
        sat = SchoolSatBands(
            math=_band_from_snapshot(sat_payload.get("math"), "sat.math"),
            ebrw=_band_from_snapshot(sat_payload.get("ebrw"), "sat.ebrw"),
        )
    policy = payload.get("test_policy")
    if not isinstance(policy, str):
        raise ValueError("snapshot test_policy is invalid")
    try:
        test_policy = TestPolicy(policy)
    except (TypeError, ValueError) as exc:
        raise ValueError("snapshot test_policy is invalid") from exc
    stale_optional_facts = payload.get("stale_optional_facts")
    if not isinstance(stale_optional_facts, bool):
        raise ValueError("snapshot stale_optional_facts is invalid")
    return SchoolFitInputs(
        admit_rate=_decimal_from_snapshot(payload.get("admit_rate"), "admit_rate"),
        stale_optional_facts=stale_optional_facts,
        gpa_distribution=distribution,
        rank_distribution=rank,
        sat=sat,
        act=_band_from_snapshot(payload.get("act"), "act"),
        test_policy=test_policy,
    )


def parse_snapshot_bytes(value: bytes) -> SensitivitySnapshot:
    """Parse a previously exported sanitized input without contacting the DB."""
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("snapshot is not valid JSON") from exc
    root = _mapping(payload, "root")
    if root.get("schema_version") != SNAPSHOT_VERSION:
        raise ValueError("snapshot schema version is unsupported")
    schools_value = root.get("schools")
    if not isinstance(schools_value, list):
        raise ValueError("snapshot schools must be a list")
    source_fact_row_count = _nonnegative_count(
        root.get("source_fact_row_count"), "snapshot source_fact_row_count"
    )
    rows: list[tuple[int, SchoolFitInputs]] = []
    for item in schools_value:
        row = _mapping(item, "school row")
        school_id = row.get("school_id")
        if isinstance(school_id, bool) or not isinstance(school_id, int):
            raise ValueError("snapshot school_id must be an integer")
        rows.append((school_id, _school_from_snapshot(row.get("school"))))
    parsed = build_snapshot(rows, source_fact_row_count=source_fact_row_count)
    if canonical_snapshot_bytes(parsed) != value:
        raise ValueError("snapshot is not canonical or has unsupported fields")
    return parsed


def build_manifest(
    *,
    snapshot: SensitivitySnapshot,
    as_of: datetime,
    stale_after_days: int = DEFAULT_STALE_AFTER_DAYS,
) -> dict[str, object]:
    """Describe the versioned calculation inputs without including student data."""
    if stale_after_days < 0:
        raise ValueError("stale days must be non-negative")
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "as_of": _datetime_text(as_of),
        "fact_keys": list(ADMISSIONS_FIT_FACT_KEYS),
        "facts_stale_days": stale_after_days,
        "input_sha256": sha256_hex(canonical_snapshot_bytes(snapshot)),
        "manifest_version": MANIFEST_VERSION,
        "script_version": SCRIPT_VERSION,
        "source_fact_row_count": snapshot.source_fact_row_count,
        "source_row_count": len(snapshot.schools),
        "synthetic_profiles": SYNTHETIC_PROFILES_MANIFEST,
    }


def validate_replay_manifest(
    *, snapshot: SensitivitySnapshot, manifest: Mapping[str, object], as_of: datetime
) -> int:
    """Reject a mismatched replay rather than silently changing evidence inputs."""
    if manifest.get("manifest_version") != MANIFEST_VERSION:
        raise ValueError("manifest version is unsupported")
    if manifest.get("algorithm_version") != ALGORITHM_VERSION:
        raise ValueError("manifest algorithm version does not match the calculator")
    if manifest.get("script_version") != SCRIPT_VERSION:
        raise ValueError("manifest script version does not match the replay script")
    if manifest.get("as_of") != _datetime_text(as_of):
        raise ValueError("--as-of must exactly match the exported manifest")
    fact_keys = manifest.get("fact_keys")
    if not isinstance(fact_keys, list | tuple) or tuple(fact_keys) != ADMISSIONS_FIT_FACT_KEYS:
        raise ValueError("manifest fixed fact-key list does not match the calculator")
    synthetic_profiles = manifest.get("synthetic_profiles")
    if (
        not isinstance(synthetic_profiles, list | tuple)
        or tuple(synthetic_profiles) != SYNTHETIC_PROFILES_MANIFEST
    ):
        raise ValueError("manifest synthetic profiles do not match the release contract")
    expected_hash = manifest.get("input_sha256")
    actual_hash = sha256_hex(canonical_snapshot_bytes(snapshot))
    if not isinstance(expected_hash, str) or expected_hash != actual_hash:
        raise ValueError("snapshot SHA-256 does not match the manifest")
    source_row_count = _nonnegative_count(
        manifest.get("source_row_count"), "manifest source row count"
    )
    if source_row_count != len(snapshot.schools):
        raise ValueError("manifest source row count does not match the snapshot")
    source_fact_row_count = _nonnegative_count(
        manifest.get("source_fact_row_count"), "manifest source fact row count"
    )
    if source_fact_row_count != snapshot.source_fact_row_count:
        raise ValueError("manifest source fact row count does not match the snapshot")
    stale_after_days = manifest.get("facts_stale_days")
    if (
        isinstance(stale_after_days, bool)
        or not isinstance(stale_after_days, int)
        or stale_after_days < 0
    ):
        raise ValueError("manifest facts_stale_days is invalid")
    return stale_after_days


async def load_live_snapshot(
    *, as_of: datetime, stale_after_days: int
) -> SensitivitySnapshot:
    """Adapt the service-owned profile-free evidence snapshot for replay export."""
    settings = get_settings()
    pool = await create_pool(settings=settings)
    try:
        source_snapshot = await export_admissions_fit_evidence_snapshot(pool)
    finally:
        await pool.close()
    snapshot = build_snapshot(
        (
            (
                school.school_id,
                school_fit_inputs_from_facts(
                    admit_rate=school.admit_rate,
                    facts=source_snapshot.facts_by_school[school.school_id],
                    now=as_of,
                    stale_after_days=stale_after_days,
                ),
            )
            for school in source_snapshot.schools
        ),
        source_fact_row_count=source_snapshot.source_fact_row_count,
    )
    return snapshot


def _basis_name(estimate: FitEstimate) -> str:
    if estimate.category is FitCategory.UNKNOWN:
        return "Unknown"
    factors = {signal.factor for signal in estimate.signals}
    if factors == {FitFactor.ACADEMIC}:
        return "academic-only"
    if factors == {FitFactor.TESTING}:
        return "test-only"
    if factors == {FitFactor.ACADEMIC, FitFactor.TESTING}:
        return "both"
    return "admit-rate-only"


def run_sensitivity(
    *, snapshot: SensitivitySnapshot, as_of: datetime, stale_after_days: int
) -> tuple[SensitivityRun, ...]:
    """Evaluate every exact synthetic input against every sanitized school input."""
    return tuple(
        SensitivityRun(
            school_id=school_id,
            profile_id=profile_id,
            estimate=estimate_admissions_fit(
                school,
                profile,
                now=as_of,
                stale_after_days=stale_after_days,
            ),
        )
        for school_id, school in snapshot.schools
        for profile_id, profile in SYNTHETIC_PROFILES
    )


def _category_distance(left: FitCategory, right: FitCategory) -> int | None:
    order = {FitCategory.REACH: 0, FitCategory.TARGET: 1, FitCategory.SAFETY: 2}
    return None if left not in order or right not in order else abs(order[left] - order[right])


def _changed(run: SensitivityRun) -> bool:
    return run.estimate.category != run.estimate.baseline_category


def _estimate_signature(estimate: FitEstimate) -> tuple[object, ...]:
    return (
        estimate.category,
        estimate.baseline_category,
        estimate.basis,
        estimate.evidence_level,
        estimate.signals,
        estimate.unavailable,
        estimate.caveats,
        estimate.algorithm_version,
    )


def _effective_signal_signature(estimate: FitEstimate) -> tuple[object, ...]:
    """Compare only category-moving evidence, not truthful rejection diagnostics.

    A stale source and an absent source correctly have different unavailable
    reasons/caveats.  The release invariant is that neither can alter the
    category or create an applied signal, so those are the intentionally
    comparable fields.
    """
    return (estimate.category, estimate.basis, estimate.evidence_level, estimate.signals)


def _probe_observed(value: str, observed_at: datetime) -> ObservedDecimal:
    return ObservedDecimal(Decimal(value), observed_at)


def _probe_gpa(*, observed_at: datetime, value_type: str = "distribution") -> GpaDistribution:
    return GpaDistribution(
        value_type=value_type,
        scale="gpa",
        complete=True,
        observed_at=observed_at,
        buckets=(
            GpaBucket(Decimal("0"), Decimal("3.99"), Decimal("75")),
            GpaBucket(Decimal("4.0"), None, Decimal("25")),
        ),
    )


def _probe_weak_gpa(*, observed_at: datetime, value_type: str = "distribution") -> GpaDistribution:
    """A valid weak middle-v1 comparison, used to exercise GPA/rank precedence."""
    return GpaDistribution(
        value_type=value_type,
        scale="gpa",
        complete=True,
        observed_at=observed_at,
        buckets=(
            GpaBucket(Decimal("0"), Decimal("3.50"), Decimal("20")),
            GpaBucket(Decimal("3.51"), None, Decimal("80")),
        ),
    )


def _probe_rank(*, observed_at: datetime, malformed: bool = False) -> RankDistribution:
    # ``40, 25, 75`` is invalid/non-monotonic, but if a defective calculator
    # trusted it, its tier would still be category-moving for middle-v1.
    values = ("40", "25", "75") if malformed else ("10", "25", "75")
    return RankDistribution(*(_probe_observed(value, observed_at) for value in values))


def _probe_band(
    *, observed_at: datetime, lower: str, upper: str, malformed: bool = False
) -> ScoreBand:
    if malformed:
        lower, upper = upper, lower
    return ScoreBand(
        _probe_observed(lower, observed_at),
        _probe_observed(upper, observed_at),
    )


def _source_modes(
    *, as_of: datetime, stale_after_days: int
) -> tuple[tuple[str, datetime | None, bool], ...]:
    """The four unavailable shapes every timestamped optional source must reject."""
    return (
        ("missing", None, False),
        ("malformed", as_of, True),
        ("stale", as_of - timedelta(days=stale_after_days + 1), False),
        # Future observations must fail closed; this probe intentionally catches
        # a negative-age implementation that accidentally treats them as fresh.
        ("future", as_of + timedelta(microseconds=1), False),
    )


def _source_nullification_probes(
    *, as_of: datetime, stale_after_days: int
) -> tuple[SourceNullificationProbe, ...]:
    """Build fixed, category-discriminating source removal probes.

    These are not applicant records.  They reuse the exact named release
    fixtures, vary only school-side source shapes, and retain only bounded
    source/mode labels in reporting.  Each trusted control is deliberately
    chosen to cross a category boundary so an implementation that applies the
    unusable value cannot make this gate pass vacuously.
    """
    high = dict(SYNTHETIC_PROFILES)["high-v1"]
    middle = dict(SYNTHETIC_PROFILES)["middle-v1"]
    rate_academic = Decimal("45")
    rate_testing = Decimal("46")
    rank = _probe_rank(observed_at=as_of)
    gpa = _probe_gpa(observed_at=as_of)
    sat_math = _probe_band(observed_at=as_of, lower="500", upper="700")
    sat_ebrw = _probe_band(observed_at=as_of, lower="500", upper="700")
    act = _probe_band(observed_at=as_of, lower="20", upper="30")
    probes: list[SourceNullificationProbe] = []

    for mode, observed_at, malformed in _source_modes(
        as_of=as_of, stale_after_days=stale_after_days
    ):
        unusable_gpa = (
            None
            if observed_at is None
            else _probe_gpa(
                observed_at=observed_at,
                value_type="invalid" if malformed else "distribution",
            )
        )
        probes.append(
            SourceNullificationProbe(
                f"gpa_distribution/{mode}",
                SchoolFitInputs(rate_academic, gpa_distribution=unusable_gpa),
                SchoolFitInputs(rate_academic),
                SchoolFitInputs(rate_academic, gpa_distribution=gpa),
                high,
            )
        )

        unusable_rank = (
            None
            if observed_at is None
            else _probe_rank(observed_at=observed_at, malformed=malformed)
        )
        probes.append(
            SourceNullificationProbe(
                f"rank_distribution/{mode}",
                SchoolFitInputs(rate_academic, rank_distribution=unusable_rank),
                SchoolFitInputs(rate_academic),
                SchoolFitInputs(rate_academic, rank_distribution=rank),
                high,
            )
        )

    for band_name in ("sat_math_band", "sat_ebrw_band"):
        for mode, observed_at, malformed in _source_modes(
            as_of=as_of, stale_after_days=stale_after_days
        ):
            unusable_band = (
                None
                if observed_at is None
                else _probe_band(
                    observed_at=observed_at,
                    lower="500",
                    upper="700",
                    malformed=malformed,
                )
            )
            sat = (
                SchoolSatBands(unusable_band, sat_ebrw)
                if band_name == "sat_math_band"
                else SchoolSatBands(sat_math, unusable_band)
            )
            probes.append(
                SourceNullificationProbe(
                    f"{band_name}/{mode}",
                    SchoolFitInputs(rate_testing, sat=sat, test_policy=TestPolicy.REQUIRED),
                    SchoolFitInputs(rate_testing, test_policy=TestPolicy.REQUIRED),
                    SchoolFitInputs(
                        rate_testing,
                        sat=SchoolSatBands(sat_math, sat_ebrw),
                        test_policy=TestPolicy.REQUIRED,
                    ),
                    high,
                )
            )

    for mode, observed_at, malformed in _source_modes(
        as_of=as_of, stale_after_days=stale_after_days
    ):
        unusable_sat = (
            None
            if observed_at is None
            else SchoolSatBands(
                _probe_band(
                    observed_at=observed_at,
                    lower="500",
                    upper="700",
                    malformed=malformed,
                ),
                _probe_band(
                    observed_at=observed_at,
                    lower="500",
                    upper="700",
                    malformed=malformed,
                ),
            )
        )
        probes.append(
            SourceNullificationProbe(
                f"complete_sat/{mode}",
                SchoolFitInputs(rate_testing, sat=unusable_sat, test_policy=TestPolicy.REQUIRED),
                SchoolFitInputs(rate_testing, test_policy=TestPolicy.REQUIRED),
                SchoolFitInputs(
                    rate_testing,
                    sat=SchoolSatBands(sat_math, sat_ebrw),
                    test_policy=TestPolicy.REQUIRED,
                ),
                high,
            )
        )

    complete_sat = SchoolSatBands(sat_math, sat_ebrw)
    probes.append(
        SourceNullificationProbe(
            "required_policy/complete_sat_not_required_or_unknown",
            SchoolFitInputs(
                rate_testing,
                sat=complete_sat,
                test_policy=TestPolicy.NOT_REQUIRED_OR_UNKNOWN,
            ),
            SchoolFitInputs(rate_testing, test_policy=TestPolicy.NOT_REQUIRED_OR_UNKNOWN),
            SchoolFitInputs(rate_testing, sat=complete_sat, test_policy=TestPolicy.REQUIRED),
            high,
        )
    )

    for mode, observed_at, malformed in _source_modes(
        as_of=as_of, stale_after_days=stale_after_days
    ):
        unusable_act = (
            None
            if observed_at is None
            else _probe_band(
                observed_at=observed_at,
                lower="20",
                upper="30",
                malformed=malformed,
            )
        )
        probes.append(
            SourceNullificationProbe(
                f"act_band/{mode}",
                SchoolFitInputs(rate_testing, act=unusable_act, test_policy=TestPolicy.REQUIRED),
                SchoolFitInputs(rate_testing, test_policy=TestPolicy.REQUIRED),
                SchoolFitInputs(rate_testing, act=act, test_policy=TestPolicy.REQUIRED),
                high,
            )
        )

    probes.append(
        SourceNullificationProbe(
            "required_policy/act_not_required_or_unknown",
            SchoolFitInputs(
                rate_testing,
                act=act,
                test_policy=TestPolicy.NOT_REQUIRED_OR_UNKNOWN,
            ),
            SchoolFitInputs(rate_testing, test_policy=TestPolicy.NOT_REQUIRED_OR_UNKNOWN),
            SchoolFitInputs(rate_testing, act=act, test_policy=TestPolicy.REQUIRED),
            high,
        )
    )

    weak_gpa = _probe_weak_gpa(observed_at=as_of)
    invalid_weak_gpa = replace(weak_gpa, value_type="invalid")
    malformed_strong_rank = _probe_rank(observed_at=as_of, malformed=True)
    probes.extend(
        (
            SourceNullificationProbe(
                "academic_fallback/gpa_unusable_rank_usable",
                SchoolFitInputs(
                    rate_academic,
                    gpa_distribution=invalid_weak_gpa,
                    rank_distribution=rank,
                ),
                SchoolFitInputs(rate_academic, rank_distribution=rank),
                SchoolFitInputs(
                    rate_academic,
                    gpa_distribution=weak_gpa,
                    rank_distribution=rank,
                ),
                middle,
            ),
            SourceNullificationProbe(
                "academic_fallback/rank_unusable_gpa_usable",
                SchoolFitInputs(
                    Decimal("25"),
                    gpa_distribution=weak_gpa,
                    rank_distribution=malformed_strong_rank,
                ),
                SchoolFitInputs(Decimal("25"), gpa_distribution=weak_gpa),
                SchoolFitInputs(Decimal("25"), rank_distribution=rank),
                middle,
            ),
            SourceNullificationProbe(
                "academic_fallback/both_unusable",
                SchoolFitInputs(
                    Decimal("25"),
                    gpa_distribution=invalid_weak_gpa,
                    rank_distribution=malformed_strong_rank,
                ),
                SchoolFitInputs(Decimal("25")),
                SchoolFitInputs(Decimal("25"), gpa_distribution=weak_gpa),
                middle,
            ),
        )
    )
    return tuple(probes)


def evaluate_optional_source_nullification(
    *,
    as_of: datetime,
    stale_after_days: int,
    estimator: Callable[..., FitEstimate] | None = None,
) -> SourceNullificationResult:
    """Prove unusable school-side evidence has exactly zero applied effect.

    Each probe performs two comparisons: unusable-versus-removed is the release
    assertion; trusted-versus-removed is a category-moving control that makes
    the assertion sensitive to accidental application of the unusable value.
    """
    estimate = estimate_admissions_fit if estimator is None else estimator
    checks_by_category: Counter[str] = Counter()
    failures: Counter[str] = Counter()
    mismatches = 0
    control_failures = 0
    for probe in _source_nullification_probes(as_of=as_of, stale_after_days=stale_after_days):
        unusable = estimate(
            probe.unusable_school,
            probe.student,
            now=as_of,
            stale_after_days=stale_after_days,
        )
        removed = estimate(
            probe.removed_school,
            probe.student,
            now=as_of,
            stale_after_days=stale_after_days,
        )
        trusted = estimate(
            probe.trusted_school,
            probe.student,
            now=as_of,
            stale_after_days=stale_after_days,
        )
        checks_by_category[probe.category] += 2
        if _effective_signal_signature(unusable) != _effective_signal_signature(removed):
            mismatches += 1
            failures[probe.category] += 1
        if _effective_signal_signature(trusted) == _effective_signal_signature(removed):
            control_failures += 1
            failures[f"control/{probe.category}"] += 1
    return SourceNullificationResult(
        check_count=sum(checks_by_category.values()),
        mismatch_count=mismatches,
        control_failure_count=control_failures,
        checks_by_category=MappingProxyType(dict(sorted(checks_by_category.items()))),
        failure_categories=MappingProxyType(dict(sorted(failures.items()))),
    )


def evaluate_release_gates(
    *,
    snapshot: SensitivitySnapshot,
    runs: Sequence[SensitivityRun],
    as_of: datetime,
    stale_after_days: int,
    nullification_estimator: Callable[..., FitEstimate] | None = None,
) -> tuple[GateResult, ...]:
    """Evaluate every mechanical §11 gate; owner review remains deliberately manual."""
    by_school = dict(snapshot.schools)
    rerun = run_sensitivity(snapshot=snapshot, as_of=as_of, stale_after_days=stale_after_days)
    same_outputs = all(
        _estimate_signature(first.estimate) == _estimate_signature(second.estimate)
        for first, second in zip(runs, rerun, strict=True)
    )
    no_reach_upgrade = all(
        not (
            (school.admit_rate is not None and school.admit_rate < Decimal("20"))
            and run.estimate.category is not FitCategory.REACH
        )
        for run in runs
        for school in (by_school[run.school_id],)
    )
    no_skipped_category = all(
        (distance := _category_distance(run.estimate.baseline_category, run.estimate.category))
        is None
        or distance <= 1
        for run in runs
    )
    changed_runs = tuple(run for run in runs if _changed(run))
    nonneutral_traceable = all(
        any(
            signal.assessment in {Assessment.STRONG, Assessment.WEAK}
            for signal in run.estimate.signals
        )
        and CaveatCode.ENTERING_CLASS_BENCHMARK_NOT_CUTOFF in run.estimate.caveats
        for run in changed_runs
    )
    within_window = all(
        run.estimate.baseline_admit_rate is not None
        and any(
            abs(run.estimate.baseline_admit_rate - boundary) <= _ADJUSTMENT_WINDOW
            for boundary in _BOUNDARIES
        )
        for run in changed_runs
    )
    nullification = evaluate_optional_source_nullification(
        as_of=as_of,
        stale_after_days=stale_after_days,
        estimator=nullification_estimator,
    )
    return (
        GateResult("no sub-20% school upgrades from Reach", no_reach_upgrade, "v1 Reach floor"),
        GateResult(
            "no estimate skips a category", no_skipped_category, "maximum one category movement"
        ),
        GateResult(
            "unusable optional sources nullify",
            nullification.mismatch_count == 0 and nullification.control_failure_count == 0,
            (
                f"checks={nullification.check_count}; mismatches={nullification.mismatch_count}; "
                f"control_failures={nullification.control_failure_count}"
            ),
        ),
        GateResult(
            "identical normalized inputs are deterministic", same_outputs, "same inputs re-run"
        ),
        GateResult(
            "changed estimates are within the 12-point boundary window",
            within_window,
            "crossed 20% or 50% threshold",
        ),
        GateResult(
            "changed estimates have non-neutral evidence and the benchmark caveat",
            nonneutral_traceable,
            "traceable changed rows",
        ),
    )


def _counter_lines(counter: Counter[Any]) -> list[str]:
    return [f"| {key} | {counter[key]} |" for key in sorted(counter)] or ["| none | 0 |"]


def source_validation_counts(
    *, snapshot: SensitivitySnapshot, as_of: datetime, stale_after_days: int
) -> Counter[str]:
    """Count invalid/stale GPA and rank evidence before calculator precedence.

    The public estimate reports the factor ultimately used. This source-side
    analysis therefore still counts an invalid GPA that a valid rank replaces,
    or an invalid rank that a valid GPA replaces, without widening the card
    response contract or reimplementing calculator categorization.
    """
    counts: Counter[str] = Counter()
    for _, school in snapshot.schools:
        distribution = school.gpa_distribution
        if distribution is not None:
            reason = _gpa_distribution_state(distribution, as_of, stale_after_days)
            if reason in {
                UnavailableReason.GPA_DISTRIBUTION_INVALID,
                UnavailableReason.GPA_DISTRIBUTION_STALE,
            }:
                counts[reason.value] += 1
        rank = school.rank_distribution
        if rank is not None:
            _, reason = _rank_values(rank, as_of, stale_after_days)
            if reason in {
                UnavailableReason.RANK_DISTRIBUTION_INVALID,
                UnavailableReason.RANK_DISTRIBUTION_STALE,
            }:
                counts[reason.value] += 1
    return counts


def _nearest_boundary_lines(
    snapshot: SensitivitySnapshot, runs: Sequence[SensitivityRun]
) -> list[str]:
    results: dict[int, dict[str, FitEstimate]] = defaultdict(dict)
    for run in runs:
        results[run.school_id][run.profile_id] = run.estimate
    lines: list[str] = []
    for boundary in _BOUNDARIES:
        closest = sorted(
            (
                (abs(school.admit_rate - boundary), school_id, school.admit_rate)
                for school_id, school in snapshot.schools
                if school.admit_rate is not None and school.admit_rate.is_finite()
            ),
            key=lambda item: (item[0], item[1]),
        )[:5]
        lines.append(f"### Nearest {boundary}% boundary")
        lines.append("")
        lines.append("| school_id | admit rate | low-v1 | middle-v1 | high-v1 |")
        lines.append("| ---: | ---: | --- | --- | --- |")
        lines.extend(
            "| {school_id} | {rate}% | {low} | {middle} | {high} |".format(
                school_id=school_id,
                rate=rate,
                low=results[school_id]["low-v1"].category.value,
                middle=results[school_id]["middle-v1"].category.value,
                high=results[school_id]["high-v1"].category.value,
            )
            for _, school_id, rate in closest
        )
        if not closest:
            lines.append("| none | n/a | n/a | n/a | n/a |")
        lines.append("")
    return lines


def build_report(
    *,
    snapshot: SensitivitySnapshot,
    manifest: Mapping[str, object],
    as_of: datetime,
    stale_after_days: int,
) -> str:
    """Render a timestamp-free report reproducible byte-for-byte from a snapshot."""
    pinned_stale_after_days = validate_replay_manifest(
        snapshot=snapshot, manifest=manifest, as_of=as_of
    )
    if stale_after_days != pinned_stale_after_days:
        raise ValueError("report stale days do not match the pinned manifest")
    runs = run_sensitivity(snapshot=snapshot, as_of=as_of, stale_after_days=stale_after_days)
    basis = Counter(_basis_name(run.estimate) for run in runs)
    transitions = Counter(
        f"{run.estimate.baseline_category.value} → {run.estimate.category.value}" for run in runs
    )
    rejected = Counter(
        unavailable.reason.value for run in runs for unavailable in run.estimate.unavailable
    )
    validation = source_validation_counts(
        snapshot=snapshot, as_of=as_of, stale_after_days=stale_after_days
    )
    policy = Counter(
        unavailable.reason.value
        for run in runs
        for unavailable in run.estimate.unavailable
        if unavailable.reason.value == "test_policy_not_required_or_unknown"
    )
    nullification = evaluate_optional_source_nullification(
        as_of=as_of,
        stale_after_days=stale_after_days,
    )
    gates = evaluate_release_gates(
        snapshot=snapshot, runs=runs, as_of=as_of, stale_after_days=stale_after_days
    )
    changed = tuple(run for run in runs if _changed(run))
    changed_rows = tuple(
        "| {school_id} | {profile_id} | {rate}% | {category} | {signals} | {caveat} |".format(
            school_id=run.school_id,
            profile_id=run.profile_id,
            rate=run.estimate.baseline_admit_rate,
            category=run.estimate.category.value,
            signals=", ".join(
                f"{signal.factor.value}:{signal.assessment.value}"
                for signal in run.estimate.signals
            ),
            caveat="yes"
            if CaveatCode.ENTERING_CLASS_BENCHMARK_NOT_CUTOFF in run.estimate.caveats
            else "no",
        )
        for run in changed
    ) or ("| none | n/a | n/a | n/a | n/a | n/a |",)
    nullification_categories = tuple(
        sorted(set(nullification.checks_by_category) | set(nullification.failure_categories))
    )
    lines = [
        "# Admissions-fit v1 sensitivity report",
        "",
        (
            "This is a deterministic, non-calibrated planning-heuristic release artifact, "
            "not an admission-probability report."
        ),
        "",
        f"- Algorithm: `{manifest['algorithm_version']}`",
        f"- Script: `{manifest['script_version']}`",
        f"- As of: `{manifest['as_of']}`",
        f"- Input SHA-256: `{manifest['input_sha256']}`",
        f"- School-side input rows: {manifest['source_row_count']}",
        f"- Fixed facts read: {manifest['source_fact_row_count']}",
        f"- Synthetic profiles: {', '.join(profile_id for profile_id, _ in SYNTHETIC_PROFILES)}",
        "",
        (
            "The exact admit-rate boundaries are **Reach** `<20%`, **Target** `<50%`, and "
            "**Safety** `≥50%`. Optional evidence is not a probability, and "
            "`entering_class_benchmark_not_cutoff` is mandatory on every changed category."
        ),
        "",
        "## Coverage by basis",
        "",
        "| basis | results |",
        "| --- | ---: |",
        *_counter_lines(basis),
        "",
        "## Category transitions by baseline band",
        "",
        "| transition | results |",
        "| --- | ---: |",
        *_counter_lines(transitions),
        "",
        "## Auxiliary-evidence rejections",
        "",
        "| reason | results |",
        "| --- | ---: |",
        *_counter_lines(rejected),
        "",
        "## GPA and rank validation",
        "",
        "| reason | results |",
        "| --- | ---: |",
        *_counter_lines(validation),
        "",
        "## Test-policy gating",
        "",
        "| reason | results |",
        "| --- | ---: |",
        *_counter_lines(policy),
        "",
        "## Optional-source nullification",
        "",
        (
            "Every nullification row is a fixed source/mode diagnostic only; no student value "
            "is retained. The separate boundary and changed-category tables intentionally retain "
            "school_id for owner review. The retained `school_id` values are public IPEDS UNITIDs "
            "(public school identifiers), not student identifiers or private data. Each "
            "source-removal assertion has a category-moving "
            "trusted control, so a nonzero mismatch or control failure blocks release."
        ),
        "",
        f"- Checks: {nullification.check_count}",
        f"- Nullification mismatches: {nullification.mismatch_count}",
        f"- Discriminating control failures: {nullification.control_failure_count}",
        "",
        "| diagnostic category | checks | failures |",
        "| --- | ---: | ---: |",
        *(
            f"| {category} | {nullification.checks_by_category.get(category, 0)} | "
            f"{nullification.failure_categories.get(category, 0)} |"
            for category in nullification_categories
        ),
        "",
        "## Boundary samples",
        "",
        *_nearest_boundary_lines(snapshot, runs),
        "## Changed-category rows",
        "",
        "| school_id | profile | baseline | category | applied signals | required caveat |",
        "| ---: | --- | ---: | --- | --- | --- |",
        *changed_rows,
        "",
        "## Invariants and release gates",
        "",
        *(f"- {'PASS' if gate.passed else 'FAIL'} — {gate.name}: {gate.detail}" for gate in gates),
        (
            "- MANUAL — owner review remains required for every `middle-v1` changed-category "
            "row and deterministic `low-v1`/`high-v1` boundary samples before personalized "
            "cards are enabled."
        ),
        "",
    ]
    return "\n".join(lines)


def automatic_gate_failures(report: str) -> tuple[str, ...]:
    return tuple(line for line in report.splitlines() if line.startswith("- FAIL —"))


def _load_manifest(path: Path) -> Mapping[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"could not load manifest {path}") from exc
    return MappingProxyType(dict(_mapping(payload, "manifest")))


def _artifact_dir(path: Path) -> None:
    if path.exists():
        raise ValueError(f"artifact path already exists: {path}")
    path.mkdir(parents=True, exist_ok=False)


def _write_artifact(
    *, output_dir: Path, snapshot: SensitivitySnapshot, manifest: Mapping[str, object], report: str
) -> None:
    _artifact_dir(output_dir)
    manifest_payload = {
        **manifest,
        "generated_at": _datetime_text(datetime.now(UTC)),
    }
    (output_dir / "input.json").write_bytes(canonical_snapshot_bytes(snapshot))
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "report.md").write_text(report, encoding="utf-8")


def _default_output_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    return _ARTIFACT_ROOT / stamp


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--as-of", required=True, type=parse_as_of, help="Explicit ISO-8601 UTC instant"
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--snapshot", type=Path, help="Previously exported sanitized input.json")
    parser.add_argument("--manifest", type=Path, help="Manifest paired with --snapshot")
    return parser


async def _run(args: argparse.Namespace) -> int:
    if (args.snapshot is None) != (args.manifest is None):
        raise ValueError("--snapshot and --manifest must be supplied together")
    output_dir = args.output_dir or _default_output_dir()
    if args.snapshot is not None:
        snapshot = parse_snapshot_bytes(args.snapshot.read_bytes())
        manifest = _load_manifest(args.manifest)
        stale_after_days = validate_replay_manifest(
            snapshot=snapshot, manifest=manifest, as_of=args.as_of
        )
    else:
        settings = get_settings()
        snapshot = await load_live_snapshot(
            as_of=args.as_of, stale_after_days=settings.facts_stale_days
        )
        stale_after_days = settings.facts_stale_days
        manifest = build_manifest(
            snapshot=snapshot,
            as_of=args.as_of,
            stale_after_days=stale_after_days,
        )
    report = build_report(
        snapshot=snapshot,
        manifest=manifest,
        as_of=args.as_of,
        stale_after_days=stale_after_days,
    )
    _write_artifact(output_dir=output_dir, snapshot=snapshot, manifest=manifest, report=report)
    print(output_dir)
    return 2 if automatic_gate_failures(report) else 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except (OSError, ValueError) as exc:
        print(f"admissions-fit sensitivity failed: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
