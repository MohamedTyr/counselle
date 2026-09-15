"""Validation and fallback vectors that keep optional evidence harmless."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import timedelta
from decimal import Decimal
from typing import cast

import pytest

from domain.admissions_fit import (
    Assessment,
    CaveatCode,
    FitBasis,
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
)
from domain.admissions_fit import (
    TestPolicy as AdmissionsTestPolicy,
)
from domain.admissions_fit.calculator import (
    _finite_between,
    _first_reason,
    _gpa_assessment,
    _school_rank_tier,
    _student_rank_tier,
    _tier_assessment,
)
from tests.domain.admissions_fit.test_calculator import (
    NOW,
    STALE_DAYS,
    complete_gpa_distribution,
    decimal,
    estimate,
    observed,
    school,
    student,
)


def unavailable(result: FitEstimate, factor: FitFactor) -> UnavailableFactor:
    item = next((candidate for candidate in result.unavailable if candidate.factor is factor), None)
    assert item is not None
    return item


def test_incompatible_scale_is_distinct_from_an_invalid_unweighted_gpa() -> None:
    incompatible = estimate(
        school(gpa=complete_gpa_distribution()),
        student(gpa=decimal(5), gpa_scale=decimal(5)),
    )
    invalid = estimate(
        school(gpa=complete_gpa_distribution()),
        student(gpa=decimal(5), gpa_scale=decimal(4)),
    )

    assert (
        unavailable(incompatible, FitFactor.ACADEMIC).reason
        is UnavailableReason.GPA_SCALE_INCOMPATIBLE
    )
    assert unavailable(invalid, FitFactor.ACADEMIC).reason is UnavailableReason.PROFILE_GPA_INVALID


def test_valid_profile_gpa_without_a_school_distribution_is_unavailable_not_weak() -> None:
    result = estimate(school(), student(gpa=decimal(4), gpa_scale=decimal(4)))

    assert result.basis is FitBasis.SCHOOL_RATE
    assert (
        unavailable(result, FitFactor.ACADEMIC).reason
        is UnavailableReason.GPA_DISTRIBUTION_UNAVAILABLE
    )


def test_student_gpa_in_a_valid_unprinted_gap_skips_the_distribution() -> None:
    distribution = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW,
        buckets=(
            GpaBucket(decimal(0), decimal(2), decimal(50)),
            GpaBucket(decimal(3), None, decimal(50)),
        ),
    )
    result = estimate(school(gpa=distribution), student(gpa=decimal("2.5"), gpa_scale=decimal(4)))

    assert (
        unavailable(result, FitFactor.ACADEMIC).reason is UnavailableReason.GPA_DISTRIBUTION_INVALID
    )


@pytest.mark.parametrize(
    "terminal_bucket",
    [
        GpaBucket(decimal("4.00"), None, decimal(25)),
        GpaBucket(decimal("3.75"), decimal("4.00"), decimal(25)),
    ],
)
def test_gpa_scale_accepts_a_closed_four_point_zero_endpoint_and_terminal_and_above_bucket(
    terminal_bucket: GpaBucket,
) -> None:
    distribution = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW,
        buckets=(
            GpaBucket(decimal(0), decimal("3.74"), decimal(75)),
            terminal_bucket,
        ),
    )

    result = estimate(school(gpa=distribution), student(gpa=decimal(4), gpa_scale=decimal(4)))

    assert result.basis is FitBasis.PERSONALIZED
    assert any(signal.source is FitSignalSource.GPA_DISTRIBUTION for signal in result.signals)


@pytest.mark.parametrize(
    "invalid_terminal_bucket",
    [
        GpaBucket(decimal("4.00"), decimal("4.01"), decimal(25)),
        GpaBucket(decimal("4.01"), None, decimal(25)),
    ],
)
def test_gpa_range_beyond_the_explicit_four_point_zero_scale_is_unavailable(
    invalid_terminal_bucket: GpaBucket,
) -> None:
    distribution = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW,
        buckets=(
            GpaBucket(decimal(0), decimal("3.99"), decimal(75)),
            invalid_terminal_bucket,
        ),
    )

    result = estimate(school(gpa=distribution), student(gpa=decimal(4), gpa_scale=decimal(4)))

    assert result.basis is FitBasis.SCHOOL_RATE
    assert (
        unavailable(result, FitFactor.ACADEMIC).reason is UnavailableReason.GPA_DISTRIBUTION_INVALID
    )


@pytest.mark.parametrize(
    "buckets",
    [
        (GpaBucket(decimal(-1), None, decimal(100)),),
        (GpaBucket(decimal(0), None, decimal(101)),),
        (GpaBucket(decimal(3), decimal(2), decimal(100)),),
        (
            GpaBucket(decimal(0), None, decimal(50)),
            GpaBucket(decimal(4), None, decimal(50)),
        ),
    ],
)
def test_malformed_gpa_bucket_shapes_are_unavailable_not_penalties(
    buckets: tuple[GpaBucket, ...],
) -> None:
    distribution = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW,
        buckets=buckets,
    )
    result = estimate(school(gpa=distribution), student(gpa=decimal(4), gpa_scale=decimal(4)))

    assert result.basis is FitBasis.SCHOOL_RATE
    assert (
        unavailable(result, FitFactor.ACADEMIC).reason is UnavailableReason.GPA_DISTRIBUTION_INVALID
    )


def test_explicit_rank_opt_out_and_absent_rank_distribution_are_not_negative_signals() -> None:
    opted_out = estimate(
        school(rank=RankDistribution(observed(50), observed(60), observed(80))),
        student(rank=decimal(1), class_size=decimal(100), school_ranks=False),
    )
    absent = estimate(school(), student(rank=decimal(1), class_size=decimal(100)))

    assert unavailable(opted_out, FitFactor.ACADEMIC).reason is UnavailableReason.RANK_DISABLED
    assert (
        unavailable(absent, FitFactor.ACADEMIC).reason
        is UnavailableReason.RANK_DISTRIBUTION_UNAVAILABLE
    )


@pytest.mark.parametrize(
    "distribution, reason",
    [
        (
            RankDistribution(None, observed(60), observed(80)),
            UnavailableReason.RANK_DISTRIBUTION_UNAVAILABLE,
        ),
        (
            RankDistribution(observed(50, age_days=STALE_DAYS + 1), observed(60), observed(80)),
            UnavailableReason.RANK_DISTRIBUTION_STALE,
        ),
        (
            RankDistribution(ObservedDecimal(None, NOW), observed(60), observed(80)),
            UnavailableReason.RANK_DISTRIBUTION_INVALID,
        ),
        (
            RankDistribution(ObservedDecimal(Decimal("NaN"), NOW), observed(60), observed(80)),
            UnavailableReason.RANK_DISTRIBUTION_INVALID,
        ),
    ],
)
def test_partial_stale_or_malformed_rank_observations_are_skipped(
    distribution: RankDistribution,
    reason: UnavailableReason,
) -> None:
    result = estimate(school(rank=distribution), student(rank=decimal(1), class_size=decimal(100)))

    assert unavailable(result, FitFactor.ACADEMIC).reason is reason
    if reason is UnavailableReason.RANK_DISTRIBUTION_STALE:
        assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats


@pytest.mark.parametrize(
    ("rank", "expected_tier"),
    [(1, 0), (11, 1), (26, 2), (51, 3)],
)
def test_student_rank_tiers_are_inclusive_at_the_documented_boundaries(
    rank: int,
    expected_tier: int,
) -> None:
    assert _student_rank_tier(decimal(rank), decimal(100)) == expected_tier


@pytest.mark.parametrize(
    ("shares", "expected_tier"),
    [((50, 50, 50), 0), ((49, 50, 60), 1), ((10, 49, 50), 2), ((10, 24, 49), 3)],
)
def test_school_rank_tiers_select_the_smallest_half_containing_tier(
    shares: tuple[int, int, int],
    expected_tier: int,
) -> None:
    assert _school_rank_tier(*(decimal(value) for value in shares)) == expected_tier


@pytest.mark.parametrize(
    ("student_tier", "school_tier", "expected"),
    [(0, 1, Assessment.STRONG), (2, 1, Assessment.WEAK), (1, 1, Assessment.NEUTRAL)],
)
def test_rank_tier_direction_is_consistent(
    student_tier: int,
    school_tier: int,
    expected: Assessment,
) -> None:
    assert _tier_assessment(student_tier, school_tier) is expected


def test_complete_act_can_be_the_only_required_test_comparison() -> None:
    result = estimate(
        school(
            act=ScoreBand(observed(24), observed(30)),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        student(act=decimal(32)),
    )

    signal = next(signal for signal in result.signals if signal.factor is FitFactor.TESTING)
    assert signal.source is FitSignalSource.ACT
    assert signal.assessment is Assessment.STRONG


@pytest.mark.parametrize(
    "band",
    [
        None,
        ScoreBand(ObservedDecimal(None, NOW), observed(30)),
        ScoreBand(ObservedDecimal(decimal(24), None), observed(30)),
    ],
)
def test_missing_or_malformed_test_bands_are_unavailable(
    band: ScoreBand | None,
) -> None:
    result = estimate(
        school(act=band, test_policy=AdmissionsTestPolicy.REQUIRED),
        student(act=decimal(32)),
    )

    assert unavailable(result, FitFactor.TESTING).reason in {
        UnavailableReason.TEST_BAND_UNAVAILABLE,
        UnavailableReason.TEST_BAND_INVALID,
    }


def test_invalid_test_score_is_unavailable_not_a_weak_score() -> None:
    result = estimate(
        school(
            act=ScoreBand(observed(24), observed(30)),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        student(act=decimal(37)),
    )

    assert unavailable(result, FitFactor.TESTING).reason is UnavailableReason.TEST_SCORE_INVALID


def test_stale_evidence_not_used_when_a_fresh_rank_is_available_still_discloses_staleness() -> None:
    result = estimate(
        school(
            gpa=complete_gpa_distribution(age_days=STALE_DAYS + 1),
            rank=RankDistribution(observed(20), observed(50), observed(80)),
        ),
        student(
            gpa=decimal(4),
            gpa_scale=decimal(4),
            rank=decimal(1),
            class_size=decimal(100),
        ),
    )

    assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats
    assert any(signal.source is FitSignalSource.CLASS_RANK for signal in result.signals)


def test_future_gpa_distribution_is_invalid_not_stale_and_falls_back_to_fresh_rank() -> None:
    """A fact cannot be observed after the estimate is calculated."""
    future_gpa = GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=NOW + timedelta(microseconds=1),
        buckets=complete_gpa_distribution().buckets,
    )
    profile = student(
        gpa=decimal(4),
        gpa_scale=decimal(4),
        rank=decimal(1),
        class_size=decimal(100),
    )
    rank_only = school(rank=RankDistribution(observed(20), observed(50), observed(85)))

    result = estimate(
        school(gpa=future_gpa, rank=rank_only.rank_distribution),
        profile,
    )

    assert result == estimate(rank_only, profile)
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


def test_future_rank_observations_are_invalid_not_stale_and_have_zero_effect() -> None:
    future = NOW + timedelta(microseconds=1)
    distribution = RankDistribution(
        ObservedDecimal(decimal(20), future),
        ObservedDecimal(decimal(50), future),
        ObservedDecimal(decimal(85), future),
    )
    profile = student(rank=decimal(1), class_size=decimal(100))
    baseline = estimate(school(), profile)

    result = estimate(school(rank=distribution), profile)

    assert result.category is baseline.category
    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()
    assert (
        unavailable(result, FitFactor.ACADEMIC).reason
        is UnavailableReason.RANK_DISTRIBUTION_INVALID
    )
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


@pytest.mark.parametrize(
    ("future_source", "expected_source"),
    [
        ("sat", FitSignalSource.ACT),
        ("act", FitSignalSource.SAT),
    ],
)
def test_future_test_band_is_invalid_not_stale_and_falls_back_to_fresh_test_type(
    future_source: str,
    expected_source: FitSignalSource,
) -> None:
    future = NOW + timedelta(microseconds=1)
    future_sat_band = ScoreBand(
        ObservedDecimal(decimal(600), future),
        ObservedDecimal(decimal(700), future),
    )
    future_act_band = ScoreBand(
        ObservedDecimal(decimal(24), future),
        ObservedDecimal(decimal(30), future),
    )
    fresh_sat = SchoolSatBands(
        math=ScoreBand(observed(600), observed(700)),
        ebrw=ScoreBand(observed(600), observed(700)),
    )
    fresh_act = ScoreBand(observed(24), observed(30))
    profile = student(sat_math=decimal(800), sat_ebrw=decimal(800), act=decimal(36))
    school_input = school(
        sat=SchoolSatBands(math=future_sat_band, ebrw=future_sat_band)
        if future_source == "sat"
        else fresh_sat,
        act=future_act_band if future_source == "act" else fresh_act,
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )

    result = estimate(school_input, profile)

    assert result.basis is FitBasis.PERSONALIZED
    assert result.signals == (FitSignal(FitFactor.TESTING, expected_source, Assessment.STRONG),)
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


def test_future_sat_alone_is_invalid_not_stale() -> None:
    future = NOW + timedelta(microseconds=1)
    future_sat_band = ScoreBand(
        ObservedDecimal(decimal(600), future),
        ObservedDecimal(decimal(700), future),
    )
    result = estimate(
        school(
            sat=SchoolSatBands(math=future_sat_band, ebrw=future_sat_band),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        student(sat_math=decimal(800), sat_ebrw=decimal(800)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert unavailable(result, FitFactor.TESTING).reason is UnavailableReason.TEST_BAND_INVALID
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


def test_future_act_alone_is_invalid_not_stale() -> None:
    future = NOW + timedelta(microseconds=1)
    future_act_band = ScoreBand(
        ObservedDecimal(decimal(24), future),
        ObservedDecimal(decimal(30), future),
    )
    result = estimate(
        school(act=future_act_band, test_policy=AdmissionsTestPolicy.REQUIRED),
        student(act=decimal(36)),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert unavailable(result, FitFactor.TESTING).reason is UnavailableReason.TEST_BAND_INVALID
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


@pytest.mark.parametrize(
    ("school_input", "profile", "expected_source"),
    [
        (
            school(gpa=complete_gpa_distribution(age_days=0)),
            student(gpa=decimal(4), gpa_scale=decimal(4)),
            FitSignalSource.GPA_DISTRIBUTION,
        ),
        (
            school(
                rank=RankDistribution(
                    observed(20, age_days=0),
                    observed(50, age_days=0),
                    observed(85, age_days=0),
                )
            ),
            student(rank=decimal(1), class_size=decimal(100)),
            FitSignalSource.CLASS_RANK,
        ),
        (
            school(
                sat=SchoolSatBands(
                    math=ScoreBand(observed(600, age_days=0), observed(700, age_days=0)),
                    ebrw=ScoreBand(observed(600, age_days=0), observed(700, age_days=0)),
                ),
                test_policy=AdmissionsTestPolicy.REQUIRED,
            ),
            student(sat_math=decimal(800), sat_ebrw=decimal(800)),
            FitSignalSource.SAT,
        ),
        (
            school(
                act=ScoreBand(observed(24, age_days=0), observed(30, age_days=0)),
                test_policy=AdmissionsTestPolicy.REQUIRED,
            ),
            student(act=decimal(36)),
            FitSignalSource.ACT,
        ),
    ],
)
def test_optional_evidence_observed_exactly_now_is_fresh(
    school_input: SchoolFitInputs,
    profile: StudentFitInputs,
    expected_source: FitSignalSource,
) -> None:
    result = estimate(school_input, profile)

    assert result.basis is FitBasis.PERSONALIZED
    factor = (
        FitFactor.ACADEMIC
        if expected_source in {FitSignalSource.GPA_DISTRIBUTION, FitSignalSource.CLASS_RANK}
        else FitFactor.TESTING
    )
    assert result.signals == (FitSignal(factor, expected_source, Assessment.STRONG),)
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


def test_frozen_dtos_cannot_be_mutated() -> None:
    profile = StudentFitInputs(gpa_unweighted=decimal(4), gpa_scale=decimal(4))

    with pytest.raises(FrozenInstanceError):
        profile.gpa_unweighted = decimal(3)  # type: ignore[misc]


def test_internal_validation_handles_signaling_nan_and_reason_fallback() -> None:
    assert not _finite_between(Decimal("sNaN"), decimal(0), decimal(100))
    assert _gpa_assessment(None, complete_gpa_distribution().buckets) is None
    assert _first_reason((), None) is UnavailableReason.PROFILE_TEST_MISSING


def test_malformed_runtime_optional_dtos_never_throw_or_change_the_rate_baseline() -> None:
    malformed = school(
        gpa=cast(GpaDistribution, "not-a-distribution"),
        rank=cast(RankDistribution, "not-a-rank-distribution"),
        sat=cast(SchoolSatBands, "not-sat-bands"),
        act=cast(ScoreBand, "not-an-act-band"),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    result = estimate(
        malformed,
        student(
            gpa=decimal(4),
            gpa_scale=decimal(4),
            rank=decimal(1),
            class_size=decimal(100),
            sat_math=decimal(800),
            sat_ebrw=decimal(800),
            act=decimal(36),
        ),
    )

    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()
