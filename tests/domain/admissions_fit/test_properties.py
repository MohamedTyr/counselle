"""Property-level honesty and boundary guards for admissions-fit-v1."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from domain.admissions_fit import (
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
    estimate_admissions_fit,
)
from domain.admissions_fit import TestPolicy as AdmissionsTestPolicy
from tests.domain.admissions_fit.test_calculator import (
    NOW,
    STALE_DAYS,
    complete_gpa_distribution,
    decimal,
    observed,
    score_band,
    valid_rank_distribution,
)

_TEST_DIRECTIONS = (Assessment.STRONG, Assessment.NEUTRAL, Assessment.WEAK)


def calculate(school: SchoolFitInputs, student: StudentFitInputs) -> FitEstimate:
    return estimate_admissions_fit(school, student, now=NOW, stale_after_days=STALE_DAYS)


def category_rank(category: FitCategory) -> int:
    return {
        FitCategory.REACH: 0,
        FitCategory.TARGET: 1,
        FitCategory.SAFETY: 2,
        FitCategory.UNKNOWN: -1,
    }[category]


def decision(result: FitEstimate) -> tuple[
    FitCategory,
    FitCategory,
    Decimal | None,
    FitBasis,
    EvidenceLevel,
    tuple[FitSignal, ...],
]:
    """Return the result fields that optional evidence is allowed to influence."""
    return (
        result.category,
        result.baseline_category,
        result.baseline_admit_rate,
        result.basis,
        result.evidence_level,
        result.signals,
    )


def rank_distribution_for_tier(tier: int) -> RankDistribution:
    shares = (
        (50, 50, 50),
        (49, 50, 50),
        (0, 49, 50),
        (0, 0, 49),
    )[tier]
    return RankDistribution(*(observed(value) for value in shares))


def rank_for_tier(tier: int) -> Decimal:
    return (decimal(1), decimal(11), decimal(26), decimal(51))[tier]


def sat_scores_for(direction: Assessment) -> tuple[Decimal, Decimal]:
    if direction is Assessment.STRONG:
        return decimal(800), decimal(800)
    if direction is Assessment.WEAK:
        return decimal(200), decimal(200)
    return decimal(650), decimal(650)


def act_score_for(direction: Assessment) -> Decimal:
    if direction is Assessment.STRONG:
        return decimal(36)
    if direction is Assessment.WEAK:
        return decimal(1)
    return decimal(27)


@given(
    rate=st.integers(min_value=0, max_value=100),
    invalid_upper=st.decimals(min_value="4.01", max_value="1000", places=2),
    invalid_p25=st.integers(min_value=700, max_value=800),
    invalid_p75=st.integers(min_value=200, max_value=699),
)
def test_arbitrary_malformed_optional_school_evidence_never_penalizes_or_personalizes(
    rate: int,
    invalid_upper: Decimal,
    invalid_p25: int,
    invalid_p75: int,
) -> None:
    """Malformed optional facts cannot turn into a weak signal or a thrown page."""
    profile = StudentFitInputs(
        gpa_unweighted=decimal(4),
        gpa_scale=decimal(4),
        class_rank=decimal(1),
        class_size=decimal(100),
        sat_math=decimal(800),
        sat_ebrw=decimal(800),
        act_composite=decimal(36),
    )
    baseline = calculate(SchoolFitInputs(admit_rate=decimal(rate)), profile)
    malformed = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=GpaDistribution(
            value_type="distribution",
            scale="gpa",
            complete=True,
            observed_at=NOW,
            buckets=(
                GpaBucket(decimal(0), decimal("3.99"), decimal(75)),
                GpaBucket(decimal(4), invalid_upper, decimal(25)),
            ),
        ),
        rank_distribution=RankDistribution(
            observed(100),
            observed(0),
            observed(0),
        ),
        sat=SchoolSatBands(
            math=score_band(invalid_p25, invalid_p75),
            ebrw=score_band(invalid_p25, invalid_p75),
        ),
        act=score_band(invalid_p25, invalid_p75),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )

    result = calculate(malformed, profile)

    assert decision(result) == decision(baseline)
    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()


@given(rate=st.integers(min_value=0, max_value=100), reported_share=st.integers(0, 100))
def test_absent_or_explicitly_not_reported_optional_evidence_is_exact_rate_decision(
    rate: int,
    reported_share: int,
) -> None:
    profile = StudentFitInputs(gpa_unweighted=decimal(4), gpa_scale=decimal(4))
    baseline = calculate(SchoolFitInputs(admit_rate=decimal(rate)), profile)
    explicitly_not_reported = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=GpaDistribution(
            value_type="distribution",
            scale="gpa",
            complete=False,
            observed_at=NOW,
            buckets=(GpaBucket(decimal(0), None, decimal(reported_share)),),
        ),
    )

    result = calculate(explicitly_not_reported, profile)

    assert decision(result) == decision(baseline)
    assert result.basis is FitBasis.SCHOOL_RATE


@given(
    rate=st.integers(min_value=0, max_value=100),
    source=st.sampled_from(("gpa", "rank", "sat", "act")),
    future_microseconds=st.integers(min_value=1, max_value=1_000_000),
)
def test_future_observed_optional_evidence_cannot_personalize_or_change_the_rate_decision(
    rate: int,
    source: str,
    future_microseconds: int,
) -> None:
    """Every optional source with future provenance is equivalent to no source."""
    future = NOW + timedelta(microseconds=future_microseconds)
    profile = StudentFitInputs(
        gpa_unweighted=decimal(4),
        gpa_scale=decimal(4),
        class_rank=decimal(1),
        class_size=decimal(100),
        sat_math=decimal(800),
        sat_ebrw=decimal(800),
        act_composite=decimal(36),
    )
    future_band = ScoreBand(
        ObservedDecimal(decimal(600), future),
        ObservedDecimal(decimal(700), future),
    )
    future_school = {
        "gpa": SchoolFitInputs(
            admit_rate=decimal(rate),
            gpa_distribution=replace(complete_gpa_distribution(), observed_at=future),
        ),
        "rank": SchoolFitInputs(
            admit_rate=decimal(rate),
            rank_distribution=RankDistribution(
                ObservedDecimal(decimal(20), future),
                ObservedDecimal(decimal(50), future),
                ObservedDecimal(decimal(85), future),
            ),
        ),
        "sat": SchoolFitInputs(
            admit_rate=decimal(rate),
            sat=SchoolSatBands(math=future_band, ebrw=future_band),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
        "act": SchoolFitInputs(
            admit_rate=decimal(rate),
            act=ScoreBand(
                ObservedDecimal(decimal(24), future),
                ObservedDecimal(decimal(30), future),
            ),
            test_policy=AdmissionsTestPolicy.REQUIRED,
        ),
    }[source]
    baseline = calculate(SchoolFitInputs(admit_rate=decimal(rate)), profile)

    result = calculate(future_school, profile)

    assert decision(result) == decision(baseline)
    assert result.basis is FitBasis.SCHOOL_RATE
    assert result.signals == ()
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


@given(
    rate=st.integers(min_value=0, max_value=100),
    upper=st.decimals(min_value="4.01", max_value="99", places=2),
)
def test_malformed_gpa_replaced_by_usable_rank_preserves_the_full_result(
    rate: int,
    upper: Decimal,
) -> None:
    profile = StudentFitInputs(
        gpa_unweighted=decimal(4),
        gpa_scale=decimal(4),
        class_rank=decimal(1),
        class_size=decimal(100),
    )
    rank_only = SchoolFitInputs(
        admit_rate=decimal(rate),
        rank_distribution=valid_rank_distribution(),
    )
    malformed_gpa = replace(
        rank_only,
        gpa_distribution=GpaDistribution(
            value_type="distribution",
            scale="gpa",
            complete=True,
            observed_at=NOW,
            buckets=(
                GpaBucket(decimal(0), decimal("3.99"), decimal(75)),
                GpaBucket(decimal(4), upper, decimal(25)),
            ),
        ),
    )

    assert calculate(malformed_gpa, profile) == calculate(rank_only, profile)


@given(
    rate=st.integers(min_value=0, max_value=100),
    invalid_p25=st.integers(min_value=24, max_value=36),
    invalid_p75=st.integers(min_value=1, max_value=23),
)
def test_malformed_act_after_usable_sat_preserves_the_full_result(
    rate: int,
    invalid_p25: int,
    invalid_p75: int,
) -> None:
    profile = StudentFitInputs(
        sat_math=decimal(800),
        sat_ebrw=decimal(800),
        act_composite=decimal(36),
    )
    sat_only = SchoolFitInputs(
        admit_rate=decimal(rate),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    malformed_act = replace(sat_only, act=score_band(invalid_p25, invalid_p75))

    assert calculate(malformed_act, profile) == calculate(sat_only, profile)


@given(
    rate=st.integers(min_value=0, max_value=100),
    gpa=st.sampled_from((decimal("2.5"), decimal(4))),
    test_direction=st.sampled_from(_TEST_DIRECTIONS),
)
def test_calculation_is_deterministic(rate: int, gpa: Decimal, test_direction: Assessment) -> None:
    sat_math, sat_ebrw = sat_scores_for(test_direction)
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=complete_gpa_distribution(),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    profile = StudentFitInputs(
        gpa_unweighted=gpa,
        gpa_scale=decimal(4),
        sat_math=sat_math,
        sat_ebrw=sat_ebrw,
    )

    assert calculate(school, profile) == calculate(school, profile)


@given(
    rate=st.integers(min_value=0, max_value=100),
    academic=st.sampled_from(tuple(Assessment)),
    testing=st.sampled_from(tuple(Assessment)),
)
def test_internal_adjustment_is_always_capped_to_twelve_points(
    rate: int,
    academic: Assessment,
    testing: Assessment,
) -> None:
    from domain.admissions_fit.calculator import _fit_index  # Deliberate non-wire invariant seam.

    assert abs(_fit_index(decimal(rate), academic, testing) - decimal(rate)) <= decimal(12)


@given(
    rate=st.integers(min_value=0, max_value=100),
    academic=st.sampled_from(tuple(Assessment)),
    testing=st.sampled_from(tuple(Assessment)),
)
def test_no_possible_adjustment_skips_a_category_boundary(
    rate: int,
    academic: Assessment,
    testing: Assessment,
) -> None:
    from domain.admissions_fit.calculator import _category_for, _fit_index

    adjusted_category = _category_for(_fit_index(decimal(rate), academic, testing))
    final_category = FitCategory.REACH if rate < 20 else adjusted_category

    assert abs(category_rank(final_category) - category_rank(_category_for(decimal(rate)))) <= 1


@given(rate=st.integers(min_value=0, max_value=19))
def test_sub_twenty_baseline_is_always_reach(rate: int) -> None:
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=complete_gpa_distribution(),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    profile = StudentFitInputs(
        gpa_unweighted=decimal(4),
        gpa_scale=decimal(4),
        sat_math=decimal(800),
        sat_ebrw=decimal(800),
    )

    assert calculate(school, profile).category is FitCategory.REACH


@given(
    rate=st.integers(min_value=20, max_value=100),
    school_tier=st.integers(min_value=0, max_value=3),
    stronger_tier=st.integers(min_value=0, max_value=3),
    distance=st.integers(min_value=0, max_value=3),
)
def test_stronger_fixed_rank_comparison_cannot_make_category_less_favorable(
    rate: int,
    school_tier: int,
    stronger_tier: int,
    distance: int,
) -> None:
    weaker_tier = min(stronger_tier + distance, 3)
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        rank_distribution=rank_distribution_for_tier(school_tier),
    )
    stronger_profile = StudentFitInputs(
        class_rank=rank_for_tier(stronger_tier),
        class_size=decimal(100),
    )
    weaker_profile = StudentFitInputs(
        class_rank=rank_for_tier(weaker_tier),
        class_size=decimal(100),
    )

    stronger = calculate(school, stronger_profile)
    weaker = calculate(school, weaker_profile)

    assert category_rank(stronger.category) >= category_rank(weaker.category)
    assert all(signal.source is FitSignalSource.CLASS_RANK for signal in stronger.signals)
    assert all(signal.source is FitSignalSource.CLASS_RANK for signal in weaker.signals)


@given(
    rate=st.integers(min_value=20, max_value=99),
    low=st.decimals(min_value="2.0", max_value="2.99", places=2),
    high=st.decimals(min_value="3.75", max_value="4.00", places=2),
)
def test_stronger_fixed_gpa_comparison_cannot_make_category_less_favorable(
    rate: int,
    low: Decimal,
    high: Decimal,
) -> None:
    school = SchoolFitInputs(admit_rate=decimal(rate), gpa_distribution=complete_gpa_distribution())
    low_profile = StudentFitInputs(gpa_unweighted=low, gpa_scale=decimal(4))
    high_profile = StudentFitInputs(gpa_unweighted=high, gpa_scale=decimal(4))

    assert category_rank(calculate(school, high_profile).category) >= category_rank(
        calculate(school, low_profile).category
    )


@given(rate=st.integers(min_value=20, max_value=100))
def test_weaker_fixed_complete_sat_comparison_cannot_make_category_more_favorable(
    rate: int,
) -> None:
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    strong = StudentFitInputs(sat_math=decimal(800), sat_ebrw=decimal(800))
    weak = StudentFitInputs(sat_math=decimal(200), sat_ebrw=decimal(200))

    assert category_rank(calculate(school, weak).category) <= category_rank(
        calculate(school, strong).category
    )


@given(
    rate=st.integers(min_value=0, max_value=100),
    gpa=st.sampled_from((decimal("2.5"), decimal(4))),
)
def test_gpa_and_rank_never_stack_even_when_both_are_usable(rate: int, gpa: Decimal) -> None:
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=complete_gpa_distribution(),
        rank_distribution=valid_rank_distribution(),
    )
    profile = StudentFitInputs(
        gpa_unweighted=gpa,
        gpa_scale=decimal(4),
        class_rank=decimal(1),
        class_size=decimal(100),
    )

    academic_signals = [
        signal
        for signal in calculate(school, profile).signals
        if signal.factor is FitFactor.ACADEMIC
    ]

    assert len(academic_signals) == 1
    assert academic_signals[0].source is FitSignalSource.GPA_DISTRIBUTION


@given(
    rate=st.integers(min_value=0, max_value=100),
    sat_direction=st.sampled_from(_TEST_DIRECTIONS),
    act_direction=st.sampled_from(_TEST_DIRECTIONS),
)
def test_sat_and_act_are_never_cherry_picked(
    rate: int,
    sat_direction: Assessment,
    act_direction: Assessment,
) -> None:
    sat_math, sat_ebrw = sat_scores_for(sat_direction)
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        act=score_band(24, 30),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    profile = StudentFitInputs(
        sat_math=sat_math,
        sat_ebrw=sat_ebrw,
        act_composite=act_score_for(act_direction),
    )

    result = calculate(school, profile)
    test_signals = [signal for signal in result.signals if signal.factor is FitFactor.TESTING]
    matching_non_neutral = (
        sat_direction is act_direction and sat_direction in {Assessment.STRONG, Assessment.WEAK}
    )

    if matching_non_neutral:
        assert test_signals == [
            FitSignal(FitFactor.TESTING, FitSignalSource.SAT_AND_ACT, sat_direction)
        ]
    else:
        assert test_signals == []
        assert result.category is result.baseline_category


@given(rate=st.integers(min_value=0, max_value=100))
def test_sat_sections_are_not_added_into_a_synthetic_total_band(rate: int) -> None:
    school = SchoolFitInputs(
        admit_rate=decimal(rate),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    # 800 + 600 equals the two p75 endpoints added together, yet the sections
    # disagree (strong/neutral) and therefore cannot create a total-score signal.
    profile = StudentFitInputs(sat_math=decimal(800), sat_ebrw=decimal(600))

    result = calculate(school, profile)

    assert all(signal.factor is not FitFactor.TESTING for signal in result.signals)
    assert result.category is result.baseline_category


@given(rate=st.integers(min_value=0, max_value=100))
def test_removing_each_optional_source_leaves_only_remaining_sources_or_rate_baseline(
    rate: int,
) -> None:
    both_sources = SchoolFitInputs(
        admit_rate=decimal(rate),
        gpa_distribution=complete_gpa_distribution(),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    full_profile = StudentFitInputs(
        gpa_unweighted=decimal(4),
        gpa_scale=decimal(4),
        sat_math=decimal(800),
        sat_ebrw=decimal(800),
    )
    academic_only_profile = replace(full_profile, sat_math=None, sat_ebrw=None)
    test_only_profile = StudentFitInputs(sat_math=decimal(800), sat_ebrw=decimal(800))
    no_academic_source = replace(both_sources, gpa_distribution=None)
    no_test_source = replace(both_sources, sat=None)
    no_optional_sources = SchoolFitInputs(admit_rate=decimal(rate))

    assert decision(calculate(no_test_source, full_profile)) == decision(
        calculate(both_sources, academic_only_profile)
    )
    assert decision(calculate(no_academic_source, full_profile)) == decision(
        calculate(both_sources, test_only_profile)
    )
    assert decision(calculate(no_optional_sources, full_profile)) == decision(
        calculate(no_optional_sources, StudentFitInputs())
    )


def test_precedence_replacements_are_explicit_exceptions_to_missing_signal_monotonicity() -> None:
    school = SchoolFitInputs(
        admit_rate=decimal(45),
        gpa_distribution=complete_gpa_distribution(),
        rank_distribution=valid_rank_distribution(),
        sat=SchoolSatBands(math=score_band(600, 700), ebrw=score_band(600, 700)),
        act=score_band(24, 30),
        test_policy=AdmissionsTestPolicy.REQUIRED,
    )
    rank_only = StudentFitInputs(class_rank=decimal(1), class_size=decimal(100))
    gpa_replaces_rank = replace(rank_only, gpa_unweighted=decimal("2.5"), gpa_scale=decimal(4))
    sat_only = StudentFitInputs(sat_math=decimal(800), sat_ebrw=decimal(800))
    conflicting_act = replace(sat_only, act_composite=decimal(18))

    assert calculate(school, rank_only).basis is FitBasis.PERSONALIZED
    assert calculate(school, gpa_replaces_rank).basis is FitBasis.PERSONALIZED
    assert calculate(school, sat_only).basis is FitBasis.PERSONALIZED
    assert calculate(school, conflicting_act).basis is FitBasis.SCHOOL_RATE
