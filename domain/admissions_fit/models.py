"""Immutable domain inputs and closed output vocabulary for admissions-fit-v1.

The app-layer adapter parses Profile and facts-store rows into these small,
already-normalized DTOs.  This package intentionally has no dependency on
those outer representations or on their persistence details.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal

type AlgorithmVersion = Literal["admissions-fit-v1"]


class FitCategory(StrEnum):
    """The card's planning categories; none is an admission probability."""

    REACH = "Reach"
    TARGET = "Target"
    SAFETY = "Safety"
    UNKNOWN = "Unknown"


class FitBasis(StrEnum):
    SCHOOL_RATE = "school_rate"
    PERSONALIZED = "personalized"
    MISSING_ADMIT_RATE = "missing_admit_rate"


class EvidenceLevel(StrEnum):
    BASELINE_ONLY = "baseline_only"
    ONE_COMPARISON = "one_comparison"
    TWO_COMPARISONS = "two_comparisons"


class FitFactor(StrEnum):
    ACADEMIC = "academic"
    TESTING = "testing"


class FitSignalSource(StrEnum):
    GPA_DISTRIBUTION = "gpa_distribution"
    CLASS_RANK = "class_rank"
    SAT = "sat"
    ACT = "act"
    SAT_AND_ACT = "sat_and_act"


class Assessment(StrEnum):
    STRONG = "strong"
    NEUTRAL = "neutral"
    WEAK = "weak"
    UNAVAILABLE = "unavailable"


class TestPolicy(StrEnum):
    """Only the adapter-proven required code permits a test adjustment."""

    REQUIRED = "required"
    NOT_REQUIRED_OR_UNKNOWN = "not_required_or_unknown"


class SchoolFactValidationFailure(StrEnum):
    """Closed structural-failure codes for optional school-side fit evidence.

    These codes are deliberately separate from ``UnavailableReason``: a
    valid fallback may make a factor usable while the adapter still needs to
    report that one of its other optional source rows was malformed.  They
    are aggregate telemetry vocabulary only and never part of the fit wire
    response.
    """

    GPA_DISTRIBUTION_INVALID = "gpa_distribution_invalid"
    RANK_DISTRIBUTION_INVALID = "rank_distribution_invalid"
    TEST_BAND_INVALID = "test_band_invalid"
    TEST_POLICY_INVALID = "test_policy_invalid"


class UnavailableReason(StrEnum):
    """Bounded, UI-copy-independent explanations for a skipped factor."""

    PROFILE_GPA_MISSING = "profile_gpa_missing"
    PROFILE_GPA_INVALID = "profile_gpa_invalid"
    GPA_SCALE_INCOMPATIBLE = "gpa_scale_incompatible"
    GPA_DISTRIBUTION_UNAVAILABLE = "gpa_distribution_unavailable"
    GPA_DISTRIBUTION_STALE = "gpa_distribution_stale"
    GPA_DISTRIBUTION_INVALID = "gpa_distribution_invalid"
    PROFILE_RANK_UNAVAILABLE = "profile_rank_unavailable"
    RANK_DISABLED = "rank_disabled"
    RANK_DISTRIBUTION_UNAVAILABLE = "rank_distribution_unavailable"
    RANK_DISTRIBUTION_STALE = "rank_distribution_stale"
    RANK_DISTRIBUTION_INVALID = "rank_distribution_invalid"
    PROFILE_TEST_MISSING = "profile_test_missing"
    TEST_SCORE_INVALID = "test_score_invalid"
    INCOMPLETE_SAT_COMPARISON = "incomplete_sat_comparison"
    TEST_BAND_UNAVAILABLE = "test_band_unavailable"
    TEST_BAND_STALE = "test_band_stale"
    TEST_BAND_INVALID = "test_band_invalid"
    TEST_POLICY_NOT_REQUIRED_OR_UNKNOWN = "test_policy_not_required_or_unknown"


class CaveatCode(StrEnum):
    ENTERING_CLASS_BENCHMARK_NOT_CUTOFF = "entering_class_benchmark_not_cutoff"
    STALE_OPTIONAL_FACTS = "stale_optional_facts"


@dataclass(frozen=True, slots=True)
class ObservedDecimal:
    """One optional numeric fact and the instant it was observed."""

    value: Decimal | None
    observed_at: datetime | None


@dataclass(frozen=True, slots=True)
class GpaBucket:
    """A parsed, inclusive GPA interval; ``upper=None`` means open-ended."""

    lower: Decimal
    upper: Decimal | None
    percentage: Decimal


@dataclass(frozen=True, slots=True)
class GpaDistribution:
    """The adapter's normalized distribution payload and its observation time."""

    value_type: str
    scale: str
    complete: bool
    observed_at: datetime | None
    buckets: tuple[GpaBucket, ...]


@dataclass(frozen=True, slots=True)
class RankDistribution:
    """The three cumulative entering-class rank shares."""

    top_tenth: ObservedDecimal | None
    top_quarter: ObservedDecimal | None
    top_half: ObservedDecimal | None


@dataclass(frozen=True, slots=True)
class ScoreBand:
    """One section/composite middle-50 band with per-endpoint provenance."""

    p25: ObservedDecimal | None
    p75: ObservedDecimal | None


@dataclass(frozen=True, slots=True)
class SchoolSatBands:
    math: ScoreBand | None
    ebrw: ScoreBand | None


@dataclass(frozen=True, slots=True)
class SchoolFitInputs:
    """Only allowlisted school fields admitted to the v1 calculator."""

    admit_rate: Decimal | None
    # Provenance is intentionally a closed adapter-to-domain fact, rather
    # than a UI-layer annotation.  It remains true when an old optional row
    # was malformed or another fresh source won the fallback decision.
    stale_optional_facts: bool = False
    gpa_distribution: GpaDistribution | None = None
    rank_distribution: RankDistribution | None = None
    sat: SchoolSatBands | None = None
    act: ScoreBand | None = None
    test_policy: TestPolicy = TestPolicy.NOT_REQUIRED_OR_UNKNOWN


@dataclass(frozen=True, slots=True)
class StudentFitInputs:
    """Only allowlisted saved-Profile fields admitted to the v1 calculator."""

    gpa_unweighted: Decimal | None = None
    gpa_scale: Decimal | None = None
    class_rank: Decimal | None = None
    class_size: Decimal | None = None
    school_ranks: bool | None = None
    sat_math: Decimal | None = None
    sat_ebrw: Decimal | None = None
    act_composite: Decimal | None = None


@dataclass(frozen=True, slots=True)
class FitSignal:
    factor: FitFactor
    source: FitSignalSource
    assessment: Assessment


@dataclass(frozen=True, slots=True)
class UnavailableFactor:
    factor: FitFactor
    reason: UnavailableReason


@dataclass(frozen=True, slots=True)
class FitEstimate:
    """Wire-ready result deliberately excluding the internal adjusted index."""

    category: FitCategory
    baseline_category: FitCategory
    baseline_admit_rate: Decimal | None
    basis: FitBasis
    evidence_level: EvidenceLevel
    signals: tuple[FitSignal, ...]
    unavailable: tuple[UnavailableFactor, ...]
    caveats: tuple[CaveatCode, ...]
    algorithm_version: AlgorithmVersion


__all__ = [
    "AlgorithmVersion",
    "Assessment",
    "CaveatCode",
    "EvidenceLevel",
    "FitBasis",
    "FitCategory",
    "FitEstimate",
    "FitFactor",
    "FitSignal",
    "FitSignalSource",
    "GpaBucket",
    "GpaDistribution",
    "ObservedDecimal",
    "RankDistribution",
    "SchoolFitInputs",
    "SchoolSatBands",
    "ScoreBand",
    "SchoolFactValidationFailure",
    "StudentFitInputs",
    "TestPolicy",
    "UnavailableFactor",
    "UnavailableReason",
]
