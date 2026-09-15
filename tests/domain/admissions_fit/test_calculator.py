"""Golden vectors for ``admissions-fit-v1``.

These assert the published planning-category contract, not an individual
admission probability.  The calculator is deliberately exercised with
already-normalized domain values only; mapper and Profile decoding belong to
the adapter layer.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from domain.admissions_fit import (
    ALGORITHM_VERSION,
    Assessment,
    CaveatCode,
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
    UnavailableFactor,
    UnavailableReason,
    estimate_admissions_fit,
)
from domain.admissions_fit import (
    TestPolicy as AdmissionsTestPolicy,
)

NOW = datetime(2026, 1, 1, tzinfo=UTC)
STALE_DAYS = 120
DEFAULT_ADMIT_RATE = Decimal("35")


def decimal(value: str | int | float) -> Decimal:
    return Decimal(str(value))


def observed(value: str | int | float | None, *, age_days: int = 1) -> ObservedDecimal:
    return ObservedDecimal(
        value=None if value is None else decimal(value),
        observed_at=NOW - timedelta(days=age_days),
    )


def complete_gpa_distribution(*, age_days: int = 1) -> GpaDistribution:
    """A complete non-overlapping 4.0-scale distribution totaling exactly 100."""
    return GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW - timedelta(days=age_days),
        buckets=(
            GpaBucket(decimal("0"), decimal("2.99"), decimal("10")),
            GpaBucket(decimal("3.00"), decimal("3.49"), decimal("20")),
            GpaBucket(decimal("3.50"), decimal("3.74"), decimal("30")),
            GpaBucket(decimal("3.75"), decimal("3.99"), decimal("30")),
            GpaBucket(decimal("4.00"), None, decimal("10")),
        ),
    )


def valid_rank_distribution(*, age_days: int = 1) -> RankDistribution:
    return RankDistribution(
        top_tenth=observed(20, age_days=age_days),
        top_quarter=observed(50, age_days=age_days),
        top_half=observed(85, age_days=age_days),
    )


def score_band(
    p25: int,
    p75: int,
    *,
    age_days: int = 1,
) -> ScoreBand:
    return ScoreBand(
        p25=observed(p25, age_days=age_days),
        p75=observed(p75, age_days=age_days),
    )


def required_sat(*, age_days: int = 1) -> SchoolFitInputs:
    return school(
        sat=SchoolSatBands(
            math=score_band(600, 700, age_days=age_days),
            ebrw=score_band(600, 700, age_days=age_days),
        ),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )


def school(
    *,
    admit_rate: Decimal | None = DEFAULT_ADMIT_RATE,
    gpa: GpaDistribution | None = None,
    rank: RankDistribution | None = None,
    sat: SchoolSatBands | None = None,
    act: ScoreBand | None = None,
    test_policy: AdmissionsTestPolicy = AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN,
) -> SchoolFitInputs:
    return SchoolFitInputs(
        admit_rate=admit_rate,
        gpa_distribution=gpa,
        rank_distribution=rank,
        sat=sat,
        act=act,
        test_policy=test_policy,
    )


def student(
    *,
    gpa: Decimal | None = None,
    gpa_scale: Decimal | None = None,
    rank: Decimal | None = None,
    class_size: Decimal | None = None,
    school_ranks: bool | None = None,
    sat_math: Decimal | None = None,
    sat_ebrw: Decimal | None = None,
    act: Decimal | None = None,
) -> StudentFitInputs:
    return StudentFitInputs(
        gpa_unweighted=gpa,
        gpa_scale=gpa_scale,
        class_rank=rank,
        class_size=class_size,
        school_ranks=school_ranks,
        sat_math=sat_math,
        sat_ebrw=sat_ebrw,
        act_composite=act,
    )


def estimate(school_input: SchoolFitInputs, student_input: StudentFitInputs) -> FitEstimate:
    return estimate_admissions_fit(
        school_input,
        student_input,
        now=NOW,
        stale_after_days=STALE_DAYS,
    )


def applied(estimate_result: FitEstimate, factor: FitFactor) -> FitSignal | None:
    return next((signal for signal in estimate_result.signals if signal.factor is factor), None)


def unavailable(estimate_result: FitEstimate, factor: FitFactor) -> UnavailableFactor | None:
    return next((item for item in estimate_result.unavailable if item.factor is factor), None)


@pytest.mark.parametrize(
    "admit_rate",
    [None, decimal(-1), decimal("100.01"), Decimal("NaN"), Decimal("Infinity")],
)
def test_missing_or_invalid_admit_rate_is_unknown_even_with_complete_profile(
    admit_rate: Decimal | None,
) -> None:
    result = estimate(
        school(admit_rate=admit_rate, gpa=complete_gpa_distribution()),
        student(gpa=decimal(4), gpa_scale=decimal(4)),
    )

    assert result.category is FitCategory.UNKNOWN
    assert result.baseline_category is FitCategory.UNKNOWN
    assert result.baseline_admit_rate is None
    assert result.basis is FitBasis.MISSING_ADMIT_RATE
    assert result.signals == ()
    assert result.algorithm_version == ALGORITHM_VERSION


@pytest.mark.parametrize(
    ("admit_rate", "category"),
    [
        (decimal("19.9"), FitCategory.REACH),
        (decimal(20), FitCategory.TARGET),
        (decimal(50), FitCategory.SAFETY),
    ],
)
def test_empty_profile_uses_exact_admit_rate_baseline(
    admit_rate: Decimal,
    category: FitCategory,
) -> None:
    result = estimate(school(admit_rate=admit_rate), student())

    assert result.category is category
    assert result.baseline_category is category
    assert result.baseline_admit_rate == admit_rate
    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()


@pytest.mark.parametrize(
    ("gpa", "assessment"),
    [(decimal(4), Assessment.STRONG), (decimal("2.5"), Assessment.WEAK)],
)
def test_complete_gpa_distribution_applies_only_one_academic_adjustment(
    gpa: Decimal,
    assessment: Assessment,
) -> None:
    result = estimate(
        school(admit_rate=decimal(35), gpa=complete_gpa_distribution()),
        student(gpa=gpa, gpa_scale=decimal(4)),
    )

    signal = applied(result, FitFactor.ACADEMIC)
    assert result.category is FitCategory.TARGET
    assert result.basis is FitBasis.PERSONALIZED
    assert signal is not None
    assert signal.source is FitSignalSource.GPA_DISTRIBUTION
    assert signal.assessment is assessment
    assert CaveatCode.ENTERING_CLASS_BENCHMARK_NOT_CUTOFF in result.caveats


def test_strong_academic_and_required_strong_complete_test_crosses_one_boundary() -> None:
    result = estimate(
        replace(
            required_sat(), admit_rate=decimal(45), gpa_distribution=complete_gpa_distribution()
        ),
        student(
            gpa=decimal(4),
            gpa_scale=decimal(4),
            sat_math=decimal(750),
            sat_ebrw=decimal(750),
        ),
    )

    assert result.category is FitCategory.SAFETY
    assert result.basis is FitBasis.PERSONALIZED
    assert {signal.factor for signal in result.signals} == {FitFactor.ACADEMIC, FitFactor.TESTING}


def test_weak_academic_and_required_weak_complete_test_crosses_one_boundary() -> None:
    result = estimate(
        replace(
            required_sat(), admit_rate=decimal(55), gpa_distribution=complete_gpa_distribution()
        ),
        student(
            gpa=decimal("2.5"),
            gpa_scale=decimal(4),
            sat_math=decimal(550),
            sat_ebrw=decimal(550),
        ),
    )

    assert result.category is FitCategory.TARGET
    assert result.basis is FitBasis.PERSONALIZED


def test_sub_twenty_percent_school_remains_reach_for_strongest_profile() -> None:
    result = estimate(
        replace(
            required_sat(), admit_rate=decimal(19), gpa_distribution=complete_gpa_distribution()
        ),
        student(
            gpa=decimal(4),
            gpa_scale=decimal(4),
            sat_math=decimal(800),
            sat_ebrw=decimal(800),
        ),
    )

    assert result.category is FitCategory.REACH
    assert result.baseline_category is FitCategory.REACH


def test_gpa_bucket_endpoints_are_inclusive_and_never_interpolated() -> None:
    distribution = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW - timedelta(days=1),
        buckets=(
            GpaBucket(decimal(0), decimal("3.49"), decimal(25)),
            GpaBucket(decimal("3.50"), decimal("3.74"), decimal(50)),
            GpaBucket(decimal("3.75"), None, decimal(25)),
        ),
    )
    result = estimate(
        school(gpa=distribution),
        student(gpa=decimal("3.49"), gpa_scale=decimal(4)),
    )

    signal = applied(result, FitFactor.ACADEMIC)
    assert signal is not None
    assert signal.assessment is Assessment.WEAK


def test_overlapping_gpa_endpoints_reject_distribution_without_penalizing_student() -> None:
    overlapping = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW - timedelta(days=1),
        buckets=(
            GpaBucket(decimal(0), decimal("3.50"), decimal(50)),
            GpaBucket(decimal("3.50"), None, decimal(50)),
        ),
    )
    result = estimate(school(gpa=overlapping), student(gpa=decimal("3.5"), gpa_scale=decimal(4)))

    assert result.basis is FitBasis.SCHOOL_RATE
    reason = unavailable(result, FitFactor.ACADEMIC)
    assert reason is not None
    assert reason.reason is UnavailableReason.GPA_DISTRIBUTION_INVALID


def test_five_point_gpa_scale_skips_gpa_and_uses_valid_rank_fallback() -> None:
    result = estimate(
        school(gpa=complete_gpa_distribution(), rank=valid_rank_distribution()),
        student(
            gpa=decimal(5),
            gpa_scale=decimal(5),
            rank=decimal(1),
            class_size=decimal(100),
        ),
    )

    signal = applied(result, FitFactor.ACADEMIC)
    assert signal is not None
    assert signal.source is FitSignalSource.CLASS_RANK
    assert signal.assessment is Assessment.STRONG


@pytest.mark.parametrize(
    "distribution",
    [
        GpaDistribution(
            value_type="distribution",
            scale="gpa",
            complete=False,
            observed_at=NOW - timedelta(days=1),
            buckets=(GpaBucket(decimal(0), None, decimal("68.4")),),
        ),
        GpaDistribution(
            value_type="distribution",
            scale="gpa",
            complete=True,
            observed_at=NOW - timedelta(days=1),
            buckets=(GpaBucket(decimal(0), None, decimal("68.4")),),
        ),
    ],
)
def test_partial_or_explicitly_not_reported_gpa_distribution_is_never_zero_percent(
    distribution: GpaDistribution,
) -> None:
    result = estimate(
        school(gpa=distribution),
        student(gpa=decimal(4), gpa_scale=decimal(4)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert unavailable(result, FitFactor.ACADEMIC) is not None


def test_non_monotonic_rank_shares_are_unavailable() -> None:
    non_monotonic = RankDistribution(
        top_tenth=observed(60),
        top_quarter=observed(50),
        top_half=observed(80),
    )
    result = estimate(
        school(rank=non_monotonic),
        student(rank=decimal(1), class_size=decimal(100)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    reason = unavailable(result, FitFactor.ACADEMIC)
    assert reason is not None
    assert reason.reason is UnavailableReason.RANK_DISTRIBUTION_INVALID


def test_valid_gpa_deterministically_replaces_usable_rank_without_stacking() -> None:
    result = estimate(
        school(gpa=complete_gpa_distribution(), rank=valid_rank_distribution()),
        student(
            gpa=decimal("2.5"),
            gpa_scale=decimal(4),
            rank=decimal(1),
            class_size=decimal(100),
        ),
    )

    assert len([signal for signal in result.signals if signal.factor is FitFactor.ACADEMIC]) == 1
    signal = applied(result, FitFactor.ACADEMIC)
    assert signal is not None
    assert signal.source is FitSignalSource.GPA_DISTRIBUTION
    assert signal.assessment is Assessment.WEAK


def test_sat_mixed_sections_are_neutral_and_do_not_personalize() -> None:
    result = estimate(
        required_sat(),
        student(sat_math=decimal(750), sat_ebrw=decimal(550)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert applied(result, FitFactor.TESTING) is None
    assert unavailable(result, FitFactor.TESTING) is None


def test_one_usable_sat_section_is_incomplete_and_has_zero_effect() -> None:
    result = estimate(
        required_sat(),
        student(sat_math=decimal(750)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    reason = unavailable(result, FitFactor.TESTING)
    assert reason is not None
    assert reason.reason is UnavailableReason.INCOMPLETE_SAT_COMPARISON


def test_sat_and_act_disagreement_is_neutral_and_never_cherry_picked() -> None:
    result = estimate(
        school(
            sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
            act=score_band(24, 30),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        student(sat_math=decimal(750), sat_ebrw=decimal(750), act=decimal(18)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert applied(result, FitFactor.TESTING) is None
    assert unavailable(result, FitFactor.TESTING) is None


def test_agreeing_sat_and_act_apply_once_with_combined_source() -> None:
    result = estimate(
        school(
            sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
            act=score_band(24, 30),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        student(sat_math=decimal(750), sat_ebrw=decimal(750), act=decimal(32)),
    )

    signal = applied(result, FitFactor.TESTING)
    assert signal is not None
    assert signal.source is FitSignalSource.SAT_AND_ACT
    assert signal.assessment is Assessment.STRONG


@pytest.mark.parametrize("policy", list(AdmissionsTestPolicy))
@pytest.mark.parametrize("score", [decimal(750), decimal(550)])
def test_only_required_policy_can_apply_a_non_neutral_complete_test(
    policy: AdmissionsTestPolicy,
    score: Decimal,
) -> None:
    result = estimate(
        replace(required_sat(), test_policy=policy),
        student(sat_math=score, sat_ebrw=score),
    )

    signal = applied(result, FitFactor.TESTING)
    if policy is AdmissionsTestPolicy.REQUIRED:
        assert signal is not None
    else:
        assert signal is None
        reason = unavailable(result, FitFactor.TESTING)
        assert reason is not None
        assert reason.reason is UnavailableReason.TEST_POLICY_NOT_REQUIRED_OR_UNKNOWN


def test_stale_optional_facts_have_zero_effect_and_emit_stale_caveat() -> None:
    result = estimate(
        replace(
            required_sat(age_days=STALE_DAYS + 1),
            gpa_distribution=complete_gpa_distribution(age_days=STALE_DAYS + 1),
        ),
        student(gpa=decimal(4), gpa_scale=decimal(4), sat_math=decimal(750), sat_ebrw=decimal(750)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()
    assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats


def test_test_band_boundaries_follow_documented_rules() -> None:
    at_p25 = estimate(required_sat(), student(sat_math=decimal(600), sat_ebrw=decimal(600)))
    at_p75 = estimate(required_sat(), student(sat_math=decimal(700), sat_ebrw=decimal(700)))

    assert applied(at_p25, FitFactor.TESTING) is None
    at_p75_signal = applied(at_p75, FitFactor.TESTING)
    assert at_p75_signal is not None
    assert at_p75_signal.assessment is Assessment.STRONG


def test_complete_but_neutral_comparisons_remain_rate_based_without_unavailable_reason() -> None:
    result = estimate(
        replace(required_sat(), gpa_distribution=complete_gpa_distribution()),
        student(
            gpa=decimal("3.5"),
            gpa_scale=decimal(4),
            sat_math=decimal(650),
            sat_ebrw=decimal(650),
        ),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()
    assert result.unavailable == ()
    assert result.caveats == ()


def test_malformed_optional_school_data_never_throws_or_becomes_a_penalty() -> None:
    malformed = GpaDistribution(
        value_type="wrong",
        scale="wrong",
        complete=True,
        observed_at=NOW - timedelta(days=1),
        buckets=(GpaBucket(Decimal("NaN"), Decimal("Infinity"), Decimal("NaN")),),
    )
    invalid_band = ScoreBand(p25=observed(900), p75=observed(800))
    result = estimate(
        school(gpa=malformed, act=invalid_band, test_policy=AdmissionsTestPolicy.REQUIRED),
        student(gpa=decimal(4), gpa_scale=decimal(4), act=decimal(36)),
    )

    assert result.category is FitCategory.TARGET
    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()


def test_public_result_never_exposes_internal_fit_index() -> None:
    result = estimate(
        school(gpa=complete_gpa_distribution()), student(gpa=decimal(4), gpa_scale=decimal(4))
    )

    assert not hasattr(result, "fit_index")
