"""Deterministic, side-effect-free rules for ``admissions-fit-v1``.

The adjusted value is deliberately local to this module.  It selects a
planning category only; no result carries an individual admission probability
or exposes the intermediate index.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from domain.admissions_fit.models import (
    AlgorithmVersion,
    Assessment,
    CaveatCode,
    EvidenceLevel,
    FitBasis,
    FitCategory,
    FitEstimate,
    FitFactor,
    FitSignal,
    FitSignalSource,
    GpaBucket,
    GpaDistribution,
    ObservedDecimal,
    RankDistribution,
    SchoolFitInputs,
    SchoolSatBands,
    ScoreBand,
    StudentFitInputs,
    TestPolicy,
    UnavailableFactor,
    UnavailableReason,
)

ALGORITHM_VERSION: AlgorithmVersion = "admissions-fit-v1"

_ZERO = Decimal("0")
_FOUR = Decimal("4")
_TEN = Decimal("10")
_TWELVE = Decimal("12")
_TWENTY = Decimal("20")
_FIFTY = Decimal("50")
_ONE_HUNDRED = Decimal("100")
_GPA_SUM_MIN = Decimal("99.5")
_GPA_SUM_MAX = Decimal("100.5")
_ACADEMIC_REASON_PRIORITY: tuple[UnavailableReason, ...] = (
    UnavailableReason.GPA_DISTRIBUTION_STALE,
    UnavailableReason.RANK_DISTRIBUTION_STALE,
    UnavailableReason.GPA_DISTRIBUTION_INVALID,
    UnavailableReason.RANK_DISTRIBUTION_INVALID,
    UnavailableReason.GPA_SCALE_INCOMPATIBLE,
    UnavailableReason.PROFILE_GPA_INVALID,
    UnavailableReason.GPA_DISTRIBUTION_UNAVAILABLE,
    UnavailableReason.PROFILE_RANK_UNAVAILABLE,
    UnavailableReason.RANK_DISABLED,
    UnavailableReason.RANK_DISTRIBUTION_UNAVAILABLE,
    UnavailableReason.PROFILE_GPA_MISSING,
)
_TEST_REASON_PRIORITY: tuple[UnavailableReason, ...] = (
    UnavailableReason.TEST_BAND_STALE,
    UnavailableReason.TEST_BAND_INVALID,
    UnavailableReason.TEST_SCORE_INVALID,
    UnavailableReason.INCOMPLETE_SAT_COMPARISON,
    UnavailableReason.TEST_BAND_UNAVAILABLE,
    UnavailableReason.PROFILE_TEST_MISSING,
)


@dataclass(frozen=True, slots=True)
class _SignalResult:
    source: FitSignalSource | None
    assessment: Assessment
    reason: UnavailableReason | None = None
    stale_seen: bool = False

    @property
    def is_usable(self) -> bool:
        return self.assessment is not Assessment.UNAVAILABLE


def estimate_admissions_fit(
    school: SchoolFitInputs,
    student: StudentFitInputs,
    *,
    now: datetime,
    stale_after_days: int,
) -> FitEstimate:
    """Return the stable v1 planning category for immutable normalized inputs."""
    baseline_rate = _valid_rate(school.admit_rate)
    if baseline_rate is None:
        return _unknown_estimate()
    academic = _academic_signal(school, student, now, stale_after_days)
    testing = _testing_signal(school, student, now, stale_after_days)
    signals = _applied_signals(academic, testing)
    category = _category_for(_fit_index(baseline_rate, academic.assessment, testing.assessment))
    if baseline_rate < _TWENTY:
        category = FitCategory.REACH
    return _complete_estimate(baseline_rate, category, academic, testing, signals)


def _unknown_estimate() -> FitEstimate:
    return FitEstimate(
        category=FitCategory.UNKNOWN,
        baseline_category=FitCategory.UNKNOWN,
        baseline_admit_rate=None,
        basis=FitBasis.MISSING_ADMIT_RATE,
        evidence_level=EvidenceLevel.BASELINE_ONLY,
        signals=(),
        unavailable=(),
        caveats=(),
        algorithm_version=ALGORITHM_VERSION,
    )


def _complete_estimate(
    baseline_rate: Decimal,
    category: FitCategory,
    academic: _SignalResult,
    testing: _SignalResult,
    signals: tuple[FitSignal, ...],
) -> FitEstimate:
    personalized = bool(signals)
    unavailable = _unavailable_factors(academic, testing)
    caveats = _caveats(personalized, academic.stale_seen or testing.stale_seen)
    return FitEstimate(
        category=category,
        baseline_category=_category_for(baseline_rate),
        baseline_admit_rate=baseline_rate,
        basis=FitBasis.PERSONALIZED if personalized else FitBasis.SCHOOL_RATE,
        evidence_level=_evidence_level(len(signals)),
        signals=signals,
        unavailable=unavailable,
        caveats=caveats,
        algorithm_version=ALGORITHM_VERSION,
    )


def _valid_rate(value: Decimal | None) -> Decimal | None:
    return value if _finite_between(value, _ZERO, _ONE_HUNDRED) else None


def _category_for(rate: Decimal) -> FitCategory:
    if rate < _TWENTY:
        return FitCategory.REACH
    if rate < _FIFTY:
        return FitCategory.TARGET
    return FitCategory.SAFETY


def _fit_index(rate: Decimal, academic: Assessment, testing: Assessment) -> Decimal:
    """Bound the internal category-selection index; it is never serialized."""
    adjustment = _academic_adjustment(academic) + _test_adjustment(testing)
    bounded = min(max(adjustment, -_TWELVE), _TWELVE)
    return min(max(rate + bounded, _ZERO), _ONE_HUNDRED)


def _academic_adjustment(assessment: Assessment) -> Decimal:
    """Return the fixed v1 academic adjustment without a mutable rule table."""
    if assessment is Assessment.STRONG:
        return Decimal("8")
    if assessment is Assessment.WEAK:
        return Decimal("-8")
    return _ZERO


def _test_adjustment(assessment: Assessment) -> Decimal:
    """Return the fixed v1 testing adjustment without a mutable rule table."""
    if assessment is Assessment.STRONG:
        return Decimal("4")
    if assessment is Assessment.WEAK:
        return Decimal("-4")
    return _ZERO


def _academic_signal(
    school: SchoolFitInputs,
    student: StudentFitInputs,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    gpa = _gpa_signal(student, school.gpa_distribution, now, stale_after_days)
    if gpa.is_usable:
        return gpa
    rank = _rank_signal(student, school.rank_distribution, now, stale_after_days)
    if rank.is_usable:
        return _with_stale(rank, gpa.stale_seen)
    reason = _first_reason(_ACADEMIC_REASON_PRIORITY, gpa.reason, rank.reason)
    return _SignalResult(None, Assessment.UNAVAILABLE, reason, gpa.stale_seen or rank.stale_seen)


def _gpa_signal(
    student: StudentFitInputs,
    distribution: GpaDistribution | None,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    profile_reason = _gpa_profile_reason(student)
    if profile_reason is not None:
        return _unavailable(profile_reason)
    if not isinstance(distribution, GpaDistribution):
        return _unavailable(UnavailableReason.GPA_DISTRIBUTION_UNAVAILABLE)
    state = _gpa_distribution_state(distribution, now, stale_after_days)
    if state is not None:
        return _unavailable(state, state is UnavailableReason.GPA_DISTRIBUTION_STALE)
    assessment = _gpa_assessment(student.gpa_unweighted, distribution.buckets)
    if assessment is None:
        return _unavailable(UnavailableReason.GPA_DISTRIBUTION_INVALID)
    return _SignalResult(FitSignalSource.GPA_DISTRIBUTION, assessment)


def _gpa_profile_reason(student: StudentFitInputs) -> UnavailableReason | None:
    if student.gpa_unweighted is None:
        return UnavailableReason.PROFILE_GPA_MISSING
    if student.gpa_scale != _FOUR:
        return UnavailableReason.GPA_SCALE_INCOMPATIBLE
    if not _finite_between(student.gpa_unweighted, _ZERO, _FOUR):
        return UnavailableReason.PROFILE_GPA_INVALID
    return None


def _gpa_distribution_state(
    distribution: GpaDistribution,
    now: datetime,
    stale_after_days: int,
) -> UnavailableReason | None:
    if distribution.value_type != "distribution" or distribution.scale != "gpa":
        return UnavailableReason.GPA_DISTRIBUTION_INVALID
    if distribution.complete is not True or not distribution.buckets:
        return UnavailableReason.GPA_DISTRIBUTION_INVALID
    observation = _observation_state(distribution.observed_at, now, stale_after_days)
    if observation == "stale":
        return UnavailableReason.GPA_DISTRIBUTION_STALE
    if observation == "invalid" or not _valid_gpa_buckets(distribution.buckets):
        return UnavailableReason.GPA_DISTRIBUTION_INVALID
    return None


def _valid_gpa_buckets(buckets: tuple[GpaBucket, ...]) -> bool:
    if not isinstance(buckets, tuple):
        return False
    total = _ZERO
    previous_upper: Decimal | None = None
    for index, bucket in enumerate(buckets):
        if not isinstance(bucket, GpaBucket):
            return False
        # These are ranges on an explicitly 4.0-scale distribution.  A terminal
        # ``4.00 and Above`` bucket has no numeric upper endpoint, so its lower
        # bound of exactly 4.00 remains valid; any printed finite endpoint above
        # 4.00 is malformed rather than evidence about the student.
        if not _finite_between(bucket.lower, _ZERO, _FOUR):
            return False
        if not _finite_between(bucket.percentage, _ZERO, _ONE_HUNDRED):
            return False
        if bucket.upper is not None and not _finite_between(bucket.upper, bucket.lower, _FOUR):
            return False
        if bucket.upper is None and index != len(buckets) - 1:
            return False
        if previous_upper is not None and previous_upper >= bucket.lower:
            return False
        if previous_upper is None and index > 0:
            return False
        previous_upper = bucket.upper
        total += bucket.percentage
    return _GPA_SUM_MIN <= total <= _GPA_SUM_MAX


def _gpa_assessment(gpa: Decimal | None, buckets: tuple[GpaBucket, ...]) -> Assessment | None:
    if gpa is None:
        return None
    below = _ZERO
    containing: GpaBucket | None = None
    for bucket in buckets:
        if bucket.upper is not None and bucket.upper < gpa:
            below += bucket.percentage
        if bucket.lower <= gpa and (bucket.upper is None or gpa <= bucket.upper):
            containing = bucket
    if containing is None:
        return None
    through = below + containing.percentage
    if below >= Decimal("75"):
        return Assessment.STRONG
    if through <= Decimal("25"):
        return Assessment.WEAK
    return Assessment.NEUTRAL


def _rank_signal(
    student: StudentFitInputs,
    distribution: RankDistribution | None,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    profile_reason = _rank_profile_reason(student)
    if profile_reason is not None:
        return _unavailable(profile_reason)
    if not isinstance(distribution, RankDistribution):
        return _unavailable(UnavailableReason.RANK_DISTRIBUTION_UNAVAILABLE)
    values, state = _rank_values(distribution, now, stale_after_days)
    if state is not None:
        return _unavailable(state, state is UnavailableReason.RANK_DISTRIBUTION_STALE)
    assert values is not None
    student_tier = _student_rank_tier(student.class_rank, student.class_size)
    school_tier = _school_rank_tier(*values)
    assessment = _tier_assessment(student_tier, school_tier)
    return _SignalResult(FitSignalSource.CLASS_RANK, assessment)


def _rank_profile_reason(student: StudentFitInputs) -> UnavailableReason | None:
    if student.school_ranks is False:
        return UnavailableReason.RANK_DISABLED
    if not _valid_rank(student.class_rank, student.class_size):
        return UnavailableReason.PROFILE_RANK_UNAVAILABLE
    return None


def _rank_values(
    distribution: RankDistribution,
    now: datetime,
    stale_after_days: int,
) -> tuple[tuple[Decimal, Decimal, Decimal] | None, UnavailableReason | None]:
    observations = (distribution.top_tenth, distribution.top_quarter, distribution.top_half)
    if any(not isinstance(item, ObservedDecimal) for item in observations):
        return None, UnavailableReason.RANK_DISTRIBUTION_UNAVAILABLE
    asserted = tuple(item for item in observations if isinstance(item, ObservedDecimal))
    if any(_observed_state(item, now, stale_after_days) == "stale" for item in asserted):
        return None, UnavailableReason.RANK_DISTRIBUTION_STALE
    if any(_observed_state(item, now, stale_after_days) == "invalid" for item in asserted):
        return None, UnavailableReason.RANK_DISTRIBUTION_INVALID
    top_tenth = asserted[0].value
    top_quarter = asserted[1].value
    top_half = asserted[2].value
    if (
        not _finite_between(top_tenth, _ZERO, _ONE_HUNDRED)
        or not _finite_between(top_quarter, _ZERO, _ONE_HUNDRED)
        or not _finite_between(top_half, _ZERO, _ONE_HUNDRED)
    ):
        return None, UnavailableReason.RANK_DISTRIBUTION_INVALID
    assert top_tenth is not None and top_quarter is not None and top_half is not None
    if top_tenth > top_quarter or top_quarter > top_half:
        return None, UnavailableReason.RANK_DISTRIBUTION_INVALID
    return (top_tenth, top_quarter, top_half), None


def _valid_rank(rank: Decimal | None, class_size: Decimal | None) -> bool:
    if not _positive_finite(rank) or not _positive_finite(class_size):
        return False
    assert rank is not None and class_size is not None
    return (
        rank <= class_size
        and rank == rank.to_integral_value()
        and class_size == class_size.to_integral_value()
    )


def _student_rank_tier(rank: Decimal | None, class_size: Decimal | None) -> int:
    assert rank is not None and class_size is not None
    percentile = _ONE_HUNDRED * rank / class_size
    if percentile <= _TEN:
        return 0
    if percentile <= Decimal("25"):
        return 1
    if percentile <= _FIFTY:
        return 2
    return 3


def _school_rank_tier(top_tenth: Decimal, top_quarter: Decimal, top_half: Decimal) -> int:
    if top_tenth >= _FIFTY:
        return 0
    if top_quarter >= _FIFTY:
        return 1
    if top_half >= _FIFTY:
        return 2
    return 3


def _tier_assessment(student_tier: int, school_tier: int) -> Assessment:
    if student_tier < school_tier:
        return Assessment.STRONG
    if student_tier > school_tier:
        return Assessment.WEAK
    return Assessment.NEUTRAL


def _testing_signal(
    school: SchoolFitInputs,
    student: StudentFitInputs,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    sat = _sat_signal(student, school.sat, now, stale_after_days)
    act = _score_signal(
        student.act_composite,
        school.act,
        Decimal("1"),
        Decimal("36"),
        now,
        stale_after_days,
    )
    combined = _combine_test_types(sat, act)
    if not combined.is_usable:
        return combined
    if school.test_policy is not TestPolicy.REQUIRED:
        return _unavailable(
            UnavailableReason.TEST_POLICY_NOT_REQUIRED_OR_UNKNOWN,
            combined.stale_seen,
        )
    return combined


def _sat_signal(
    student: StudentFitInputs,
    bands: SchoolSatBands | None,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    math_band = bands.math if isinstance(bands, SchoolSatBands) else None
    ebrw_band = bands.ebrw if isinstance(bands, SchoolSatBands) else None
    math = _score_signal(
        student.sat_math,
        math_band,
        Decimal("200"),
        Decimal("800"),
        now,
        stale_after_days,
    )
    ebrw = _score_signal(
        student.sat_ebrw,
        ebrw_band,
        Decimal("200"),
        Decimal("800"),
        now,
        stale_after_days,
    )
    if math.is_usable and ebrw.is_usable:
        return _SignalResult(
            FitSignalSource.SAT,
            _combine_sat_sections(math.assessment, ebrw.assessment),
        )
    stale_seen = math.stale_seen or ebrw.stale_seen
    if math.is_usable or ebrw.is_usable:
        return _unavailable(UnavailableReason.INCOMPLETE_SAT_COMPARISON, stale_seen)
    return _unavailable(_sat_unavailable_reason(math.reason, ebrw.reason), stale_seen)


def _score_signal(
    score: Decimal | None,
    band: ScoreBand | None,
    minimum: Decimal,
    maximum: Decimal,
    now: datetime,
    stale_after_days: int,
) -> _SignalResult:
    if score is None:
        return _unavailable(UnavailableReason.PROFILE_TEST_MISSING)
    if not _valid_score(score, minimum, maximum):
        return _unavailable(UnavailableReason.TEST_SCORE_INVALID)
    values, state = _band_values(band, now, stale_after_days, minimum, maximum)
    if state is not None:
        return _unavailable(state, state is UnavailableReason.TEST_BAND_STALE)
    assert values is not None
    p25, p75 = values
    if score >= p75:
        return _SignalResult(None, Assessment.STRONG)
    if score < p25:
        return _SignalResult(None, Assessment.WEAK)
    return _SignalResult(None, Assessment.NEUTRAL)


def _band_values(
    band: ScoreBand | None,
    now: datetime,
    stale_after_days: int,
    minimum: Decimal,
    maximum: Decimal,
) -> tuple[tuple[Decimal, Decimal] | None, UnavailableReason | None]:
    if (
        not isinstance(band, ScoreBand)
        or not isinstance(band.p25, ObservedDecimal)
        or not isinstance(band.p75, ObservedDecimal)
    ):
        return None, UnavailableReason.TEST_BAND_UNAVAILABLE
    observations = (band.p25, band.p75)
    if any(_observed_state(item, now, stale_after_days) == "stale" for item in observations):
        return None, UnavailableReason.TEST_BAND_STALE
    if any(_observed_state(item, now, stale_after_days) == "invalid" for item in observations):
        return None, UnavailableReason.TEST_BAND_INVALID
    p25 = observations[0].value
    p75 = observations[1].value
    if not _valid_score(p25, minimum, maximum) or not _valid_score(p75, minimum, maximum):
        return None, UnavailableReason.TEST_BAND_INVALID
    assert p25 is not None and p75 is not None
    if p25 >= p75:
        return None, UnavailableReason.TEST_BAND_INVALID
    return (p25, p75), None


def _combine_sat_sections(math: Assessment, ebrw: Assessment) -> Assessment:
    if math is Assessment.STRONG and ebrw is Assessment.STRONG:
        return Assessment.STRONG
    if math is Assessment.WEAK and ebrw is Assessment.WEAK:
        return Assessment.WEAK
    return Assessment.NEUTRAL


def _combine_test_types(sat: _SignalResult, act: _SignalResult) -> _SignalResult:
    stale_seen = sat.stale_seen or act.stale_seen
    if sat.is_usable and act.is_usable:
        if sat.assessment is act.assessment and sat.assessment not in {Assessment.NEUTRAL}:
            return _SignalResult(FitSignalSource.SAT_AND_ACT, sat.assessment, stale_seen=stale_seen)
        return _SignalResult(FitSignalSource.SAT_AND_ACT, Assessment.NEUTRAL, stale_seen=stale_seen)
    if sat.is_usable:
        return _with_stale(_SignalResult(FitSignalSource.SAT, sat.assessment), stale_seen)
    if act.is_usable:
        return _with_stale(_SignalResult(FitSignalSource.ACT, act.assessment), stale_seen)
    return _unavailable(_first_reason(_TEST_REASON_PRIORITY, sat.reason, act.reason), stale_seen)


def _sat_unavailable_reason(
    math: UnavailableReason | None,
    ebrw: UnavailableReason | None,
) -> UnavailableReason:
    if (
        math is UnavailableReason.PROFILE_TEST_MISSING
        and ebrw is UnavailableReason.PROFILE_TEST_MISSING
    ):
        return UnavailableReason.PROFILE_TEST_MISSING
    return _first_reason(_TEST_REASON_PRIORITY, math, ebrw)


def _valid_score(value: Decimal | None, minimum: Decimal, maximum: Decimal) -> bool:
    if not _finite_between(value, minimum, maximum):
        return False
    assert value is not None
    return value == value.to_integral_value()


def _observed_state(
    observation: ObservedDecimal,
    now: datetime,
    stale_after_days: int,
) -> str:
    state = _observation_state(observation.observed_at, now, stale_after_days)
    if observation.value is None or state == "invalid":
        return "invalid"
    if state == "stale":
        return "stale"
    return "fresh"


def _observation_state(observed_at: datetime | None, now: datetime, stale_after_days: int) -> str:
    if not isinstance(observed_at, datetime) or not isinstance(now, datetime):
        return "invalid"
    if not isinstance(stale_after_days, int):
        return "invalid"
    try:
        return "stale" if now - observed_at > timedelta(days=max(stale_after_days, 0)) else "fresh"
    except (TypeError, OverflowError):
        return "invalid"


def _finite_between(value: Decimal | None, lower: Decimal, upper: Decimal) -> bool:
    if not isinstance(value, Decimal) or not value.is_finite():
        return False
    try:
        return lower <= value <= upper
    except InvalidOperation:
        return False


def _positive_finite(value: Decimal | None) -> bool:
    if not isinstance(value, Decimal) or not value.is_finite():
        return False
    try:
        return value >= Decimal("1")
    except InvalidOperation:
        return False


def _unavailable(reason: UnavailableReason, stale_seen: bool = False) -> _SignalResult:
    return _SignalResult(None, Assessment.UNAVAILABLE, reason, stale_seen)


def _with_stale(result: _SignalResult, stale_seen: bool) -> _SignalResult:
    return _SignalResult(
        result.source,
        result.assessment,
        result.reason,
        result.stale_seen or stale_seen,
    )


def _first_reason(
    priority: tuple[UnavailableReason, ...],
    *reasons: UnavailableReason | None,
) -> UnavailableReason:
    available = set(reasons)
    for reason in priority:
        if reason in available:
            return reason
    return UnavailableReason.PROFILE_TEST_MISSING


def _applied_signals(academic: _SignalResult, testing: _SignalResult) -> tuple[FitSignal, ...]:
    signals: list[FitSignal] = []
    if academic.source is not None and academic.assessment in {Assessment.STRONG, Assessment.WEAK}:
        signals.append(FitSignal(FitFactor.ACADEMIC, academic.source, academic.assessment))
    if testing.source is not None and testing.assessment in {Assessment.STRONG, Assessment.WEAK}:
        signals.append(FitSignal(FitFactor.TESTING, testing.source, testing.assessment))
    return tuple(signals)


def _unavailable_factors(
    academic: _SignalResult,
    testing: _SignalResult,
) -> tuple[UnavailableFactor, ...]:
    factors: list[UnavailableFactor] = []
    if academic.assessment is Assessment.UNAVAILABLE and academic.reason is not None:
        factors.append(UnavailableFactor(FitFactor.ACADEMIC, academic.reason))
    if testing.assessment is Assessment.UNAVAILABLE and testing.reason is not None:
        factors.append(UnavailableFactor(FitFactor.TESTING, testing.reason))
    return tuple(factors)


def _evidence_level(signal_count: int) -> EvidenceLevel:
    if signal_count == 0:
        return EvidenceLevel.BASELINE_ONLY
    if signal_count == 1:
        return EvidenceLevel.ONE_COMPARISON
    return EvidenceLevel.TWO_COMPARISONS


def _caveats(personalized: bool, stale_seen: bool) -> tuple[CaveatCode, ...]:
    caveats: list[CaveatCode] = []
    if personalized:
        caveats.append(CaveatCode.ENTERING_CLASS_BENCHMARK_NOT_CUTOFF)
    if stale_seen:
        caveats.append(CaveatCode.STALE_OPTIONAL_FACTS)
    return tuple(caveats)


__all__ = ["ALGORITHM_VERSION", "estimate_admissions_fit"]
