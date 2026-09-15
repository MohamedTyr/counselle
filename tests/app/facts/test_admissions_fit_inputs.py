"""Contract tests for the admissions-fit Profile/current-fact adapter.

The calculator only receives frozen domain DTOs.  These tests pin the narrow
translation boundary: all Profile and facts-store shapes stay outside it, and
missing or malformed optional evidence stays harmless.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from app.facts.admissions_fit_inputs import (
    ADMISSIONS_FIT_FACT_KEYS,
    SchoolFitInputAdaptation,
    school_fit_input_adaptation_from_facts,
    school_fit_inputs_from_facts,
    student_fit_inputs_from_profile,
)
from app.workspace.models import Academics, ActScore, Profile, SatScore
from app.workspace.models import Testing as ProfileTesting
from counselle_db.models import FactValueRow
from domain.admissions_fit import (
    CaveatCode,
    FitBasis,
    FitEstimate,
    FitFactor,
    FitSignalSource,
    ObservedDecimal,
    SchoolFitInputs,
    estimate_admissions_fit,
)
from domain.admissions_fit import (
    TestPolicy as AdmissionsTestPolicy,
)

NOW = datetime(2026, 9, 15, tzinfo=UTC)
STALE_DAYS = 120
_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "admissions_fit"

_EXPECTED_FACT_KEYS = (
    "admissions.test_policy_sat_or_act",
    "class_profile.gpa_distribution",
    "class_profile.class_rank_top_tenth",
    "class_profile.class_rank_top_quarter",
    "class_profile.class_rank_top_half",
    "class_profile.sat_math_p25",
    "class_profile.sat_math_p75",
    "class_profile.sat_ebrw_p25",
    "class_profile.sat_ebrw_p75",
    "class_profile.act_composite_p25",
    "class_profile.act_composite_p75",
)


def _fixture_rows(name: str) -> tuple[FactValueRow, ...]:
    payload = json.loads((_FIXTURES / name).read_text(encoding="utf-8"))
    return tuple(FactValueRow.model_validate(row) for row in payload["current_school_facts"])


def _row(
    fact_key: str,
    *,
    value: object = None,
    value_type: str = "count",
    value_num: float | None = None,
    value_text: str | None = None,
    display: str = "value",
    observed_at: datetime = NOW,
) -> FactValueRow:
    return FactValueRow(
        fact_key=fact_key,
        tab="admission",
        section="getting-in",
        label=fact_key,
        value=value,
        display=display,
        unit=None,
        value_type=value_type,
        value_num=value_num,
        value_text=value_text,
        value_bool=None,
        value_date=None,
        reported_period=None,
        reported_period_year=None,
        observed_at=observed_at,
    )


def _school(
    rows: Iterable[FactValueRow] = (),
    *,
    admit_rate: object = "35",
    now: datetime = NOW,
    stale_after_days: int = STALE_DAYS,
) -> SchoolFitInputs:
    return school_fit_inputs_from_facts(
        admit_rate=admit_rate,
        facts=rows,
        now=now,
        stale_after_days=stale_after_days,
    )


def _adapt(
    rows: Iterable[FactValueRow] = (),
    *,
    admit_rate: object = "35",
    now: datetime = NOW,
    stale_after_days: int = STALE_DAYS,
) -> SchoolFitInputAdaptation:
    """Exercise the public adapter diagnostic seam without exposing raw rows."""
    return school_fit_input_adaptation_from_facts(
        admit_rate=admit_rate,
        facts=rows,
        now=now,
        stale_after_days=stale_after_days,
    )


def _estimate(school: SchoolFitInputs, profile: Profile) -> FitEstimate:
    return estimate_admissions_fit(
        school,
        student_fit_inputs_from_profile(profile),
        now=NOW,
        stale_after_days=STALE_DAYS,
    )


def test_closed_fact_allowlist_is_an_ordered_immutable_tuple_with_no_excluded_keys() -> None:
    assert ADMISSIONS_FIT_FACT_KEYS == _EXPECTED_FACT_KEYS
    assert isinstance(ADMISSIONS_FIT_FACT_KEYS, tuple)
    assert "class_profile.average_gpa" not in ADMISSIONS_FIT_FACT_KEYS
    assert "class_profile.sat_total_p25" not in ADMISSIONS_FIT_FACT_KEYS
    assert "admissions.selection_factor_standardized_tests" not in ADMISSIONS_FIT_FACT_KEYS


def test_empty_or_absent_profile_translates_to_an_empty_frozen_domain_input() -> None:
    absent = student_fit_inputs_from_profile(None)
    empty = student_fit_inputs_from_profile(Profile())

    assert absent == empty
    assert absent.gpa_unweighted is None
    assert absent.gpa_scale is None
    assert absent.class_rank is None
    assert absent.class_size is None
    assert absent.school_ranks is None
    assert absent.sat_math is None
    assert absent.sat_ebrw is None
    assert absent.act_composite is None


def test_profile_adapter_uses_only_allowlisted_decimal_academic_and_section_scores() -> None:
    profile = Profile.model_validate(
        {
            "academics": {
                "gpa_unweighted": "3.875",
                "gpa_weighted": "4.900",
                "gpa_scale": "4.0",
                "class_rank": 7,
                "class_size": 298,
                "school_ranks": False,
                "rigor_summary": "AP-heavy curriculum",
            },
            "testing": {
                "sat": {"total": 1570, "math": 790, "ebrw": 780},
                "act": {"composite": 35, "sections": {"english": "36"}},
            },
            "background": {"residence": {"state": "CA"}},
        }
    )

    result = student_fit_inputs_from_profile(profile)

    assert result.gpa_unweighted == Decimal("3.875")
    assert result.gpa_scale == Decimal("4.0")
    assert result.class_rank == Decimal("7")
    assert result.class_size == Decimal("298")
    assert result.school_ranks is False
    assert result.sat_math == Decimal("790")
    assert result.sat_ebrw == Decimal("780")
    assert result.act_composite == Decimal("35")
    assert not hasattr(result, "gpa_weighted")
    assert not hasattr(result, "sat_total")


def test_weighted_gpa_and_sat_total_cannot_substitute_for_their_allowlisted_counterparts() -> None:
    profile = Profile.model_validate(
        {
            "academics": {"gpa_weighted": "4.9", "gpa_scale": "4.0"},
            "testing": {"sat": {"total": 1600}},
        }
    )

    result = student_fit_inputs_from_profile(profile)

    assert result.gpa_unweighted is None
    assert result.gpa_scale == Decimal("4.0")
    assert result.sat_math is None
    assert result.sat_ebrw is None


def test_explicit_false_disables_rank_but_absent_school_ranks_preserves_reported_rank() -> None:
    disabled = student_fit_inputs_from_profile(
        Profile.model_validate(
            {"academics": {"class_rank": 1, "class_size": 100, "school_ranks": False}}
        )
    )
    unspecified = student_fit_inputs_from_profile(
        Profile.model_validate({"academics": {"class_rank": 1, "class_size": 100}})
    )

    assert disabled.school_ranks is False
    assert disabled.class_rank == Decimal("1")
    assert unspecified.school_ranks is None
    assert unspecified.class_size == Decimal("100")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("21.125", Decimal("21.125")),
        (21, Decimal("21")),
        (21.125, Decimal("21.125")),
        (Decimal("21.125"), Decimal("21.125")),
        (None, None),
        (True, None),
        ("NaN", None),
        ("Infinity", None),
        ("not-a-number", None),
        ({"rate": 21}, None),
    ],
)
def test_admit_rate_uses_decimal_parsing_without_binary_float_or_invalid_value_leakage(
    value: object, expected: Decimal | None
) -> None:
    assert _school(admit_rate=value).admit_rate == expected


def test_complete_current_facts_translate_to_the_exact_domain_shapes_and_source_observations() -> (
    None
):
    school = _school(_fixture_rows("complete_required_school.json"), admit_rate=21)

    assert school.admit_rate == Decimal("21")
    assert school.test_policy is AdmissionsTestPolicy.REQUIRED
    assert school.gpa_distribution is not None
    assert school.gpa_distribution.value_type == "distribution"
    assert school.gpa_distribution.scale == "gpa"
    assert school.gpa_distribution.complete is True
    assert school.gpa_distribution.observed_at is not None
    assert school.gpa_distribution.observed_at.tzinfo is not None
    assert tuple(
        (bucket.lower, bucket.upper, bucket.percentage)
        for bucket in school.gpa_distribution.buckets
    ) == (
        (Decimal("3.00"), Decimal("3.24"), Decimal("0.0")),
        (Decimal("3.25"), Decimal("3.49"), Decimal("5.0")),
        (Decimal("3.5"), Decimal("3.74"), Decimal("21.0")),
        (Decimal("3.75"), Decimal("3.99"), Decimal("53.0")),
        (Decimal("4.00"), None, Decimal("21.0")),
    )
    assert school.rank_distribution is not None
    assert school.rank_distribution.top_tenth is not None
    assert school.rank_distribution.top_tenth == ObservedDecimal(
        Decimal("50"), school.rank_distribution.top_tenth.observed_at
    )
    assert school.rank_distribution.top_quarter is not None
    assert school.rank_distribution.top_quarter.value == Decimal("84")
    assert school.rank_distribution.top_half is not None
    assert school.rank_distribution.top_half.value == Decimal("99")
    assert school.sat is not None
    assert school.sat.math is not None
    assert school.sat.math.p25 is not None and school.sat.math.p25.value == Decimal("620")
    assert school.sat.math.p75 is not None and school.sat.math.p75.value == Decimal("693")
    assert school.sat.ebrw is not None
    assert school.sat.ebrw.p25 is not None and school.sat.ebrw.p25.value == Decimal("618")
    assert school.sat.ebrw.p75 is not None and school.sat.ebrw.p75.value == Decimal("700")
    assert school.act is not None
    assert school.act.p25 is not None and school.act.p25.value == Decimal("26")
    assert school.act.p75 is not None and school.act.p75.value == Decimal("31")


def test_excluded_rows_and_raw_presentation_text_cannot_change_domain_inputs() -> None:
    facts = _fixture_rows("complete_required_school.json")
    decoys = (
        _row("class_profile.average_gpa", value_num=4.9, display="4.9 weighted average"),
        _row("class_profile.sat_total_p25", value_num=1400),
        _row("admissions.admit_rate_women", value_num=99),
        _row(
            "admissions.selection_factor_standardized_tests",
            value_text="very_important",
            value_type="enum",
        ),
    )

    assert _school(facts, admit_rate=21) == _school((*facts, *decoys), admit_rate=21)


@pytest.mark.parametrize("fixture", ("partial_gpa.json", "not_reported_gpa.json"))
def test_partial_or_not_reported_gpa_buckets_become_invalid_evidence_not_zero_percent(
    fixture: str,
) -> None:
    school = _school(_fixture_rows(fixture))

    assert school.gpa_distribution is not None
    assert school.gpa_distribution.complete is False
    assert school.gpa_distribution.buckets == ()
    result = _estimate(
        school,
        Profile.model_validate({"academics": {"gpa_unweighted": "4.0", "gpa_scale": "4.0"}}),
    )
    academic = next(item for item in result.unavailable if item.factor is FitFactor.ACADEMIC)
    assert academic.reason.value == "gpa_distribution_invalid"


def test_gpa_adapter_requires_complete_non_overlapping_normalized_distribution() -> None:
    valid = _row(
        "class_profile.gpa_distribution",
        value_type="distribution",
        value={
            "kind": "distribution",
            "value": {
                "scale": "gpa",
                "buckets": [
                    {"label": "0.00 - 3.49", "lo": 0, "hi": 3.49, "pct": 75},
                    {"label": "3.50 - 3.99", "lo": 3.5, "hi": 3.99, "pct": 20},
                    {"label": "4.00 and Above", "pct": 5},
                ],
                "omitted_buckets": [],
                "sums_to": 100,
            },
        },
    )
    overlapping = valid.model_copy(
        update={
            "value": {
                "kind": "distribution",
                "value": {
                    "scale": "gpa",
                    "buckets": [
                        {"label": "0.00 - 3.50", "lo": 0, "hi": 3.5, "pct": 75},
                        {"label": "3.50 - 4.00", "lo": 3.5, "hi": 4, "pct": 25},
                    ],
                    "omitted_buckets": [],
                    "sums_to": 100,
                },
            }
        }
    )
    missing_scale = valid.model_copy(
        update={"value": {"kind": "distribution", "value": {"buckets": []}}}
    )
    wrong_type = valid.model_copy(update={"value_type": "text"})

    usable = _school((valid,)).gpa_distribution
    assert usable is not None and usable.complete is True
    assert usable.buckets[-1].lower == Decimal("4.00")
    assert usable.buckets[-1].upper is None
    for invalid in (overlapping, missing_scale, wrong_type):
        distribution = _school((invalid,)).gpa_distribution
        assert distribution is not None
        assert distribution.complete is False
        assert distribution.buckets == ()


def test_gpa_label_aliases_from_the_normalized_store_are_strictly_parsed_without_raw_prose() -> (
    None
):
    row = _row(
        "class_profile.gpa_distribution",
        value_type="distribution",
        value={
            "kind": "distribution",
            "value": {
                "scale": "gpa",
                "buckets": [
                    {"label": "0.00 – 3.49", "lo": 0, "hi": 3.49, "pct": "75"},
                    {"label": "3.50 - 3.99", "lo": "3.5", "hi": "3.99", "pct": "20"},
                    {"label": "4.00 and Above", "pct": 5},
                ],
                "omitted_buckets": [],
                "sums_to": "100.0",
            },
        },
    )
    malformed_label = row.model_copy(
        update={
            "value": {
                "value": {
                    "scale": "gpa",
                    "buckets": [
                        {"label": "roughly excellent", "pct": 100},
                    ],
                    "omitted_buckets": [],
                    "sums_to": 100,
                }
            }
        }
    )

    valid = _school((row,)).gpa_distribution
    invalid = _school((malformed_label,)).gpa_distribution

    assert valid is not None and valid.complete is True
    assert invalid is not None and invalid.complete is False


def test_rank_adapter_requires_all_three_valid_monotonic_shares() -> None:
    valid_rows = tuple(
        _row(key, value_num=value, value_type="percent")
        for key, value in (
            ("class_profile.class_rank_top_tenth", 25),
            ("class_profile.class_rank_top_quarter", 55),
            ("class_profile.class_rank_top_half", 80),
        )
    )
    invalid = _school(_fixture_rows("invalid_rank_shares.json")).rank_distribution
    partial = _school(valid_rows[:2]).rank_distribution
    valid = _school(valid_rows).rank_distribution

    assert partial is None
    assert valid is not None
    assert valid.top_tenth is not None and valid.top_tenth.value == Decimal("25")
    assert valid.top_quarter is not None and valid.top_quarter.value == Decimal("55")
    assert valid.top_half is not None and valid.top_half.value == Decimal("80")
    assert invalid is not None
    assert invalid.top_tenth is not None and invalid.top_tenth.value is None


def test_score_bands_are_separate_and_accept_the_official_score_boundaries() -> None:
    rows = (
        _row("class_profile.sat_math_p25", value_num=200),
        _row("class_profile.sat_math_p75", value_num=800),
        _row("class_profile.sat_ebrw_p25", value_num=200),
        _row("class_profile.sat_ebrw_p75", value_num=800),
        _row("class_profile.act_composite_p25", value_num=1),
        _row("class_profile.act_composite_p75", value_num=36),
        _row("class_profile.sat_total_p25", value_num=400),
        _row("class_profile.sat_total_p75", value_num=1600),
    )

    school = _school(rows)

    assert school.sat is not None
    assert school.sat.math is not None
    assert school.sat.math.p25 is not None and school.sat.math.p25.value == Decimal("200")
    assert school.sat.math.p75 is not None and school.sat.math.p75.value == Decimal("800")
    assert school.sat.ebrw is not None
    assert school.sat.ebrw.p25 is not None and school.sat.ebrw.p25.value == Decimal("200")
    assert school.sat.ebrw.p75 is not None and school.sat.ebrw.p75.value == Decimal("800")
    assert school.act is not None
    assert school.act.p25 is not None and school.act.p25.value == Decimal("1")
    assert school.act.p75 is not None and school.act.p75.value == Decimal("36")
    assert not hasattr(school, "sat_total")


def test_missing_or_malformed_band_endpoint_does_not_break_a_valid_other_test_type() -> None:
    rows = (
        _row("class_profile.sat_math_p25", value_num=600),
        _row("class_profile.sat_math_p75", value_num=700),
        _row("class_profile.sat_ebrw_p25", value_num=float("nan")),
        _row("class_profile.sat_ebrw_p75", value_num=700),
        _row("class_profile.act_composite_p25", value_num=24),
        _row("class_profile.act_composite_p75", value_num=30),
    )

    school = _school(rows)

    assert school.sat is not None
    assert school.sat.ebrw is not None
    assert school.sat.ebrw.p25 is not None and school.sat.ebrw.p25.value is None
    assert school.act is not None
    assert school.act.p25 is not None and school.act.p25.value == Decimal("24")


def test_adapter_diagnostics_count_invalid_gpa_even_when_rank_fallback_applies() -> None:
    """The validation counter describes sources, not only the chosen signal."""
    source = _fixture_rows("complete_required_school.json")
    malformed = tuple(
        row.model_copy(update={"value_type": "text"})
        if row.fact_key == "class_profile.gpa_distribution"
        else row.model_copy(update={"value_num": 25})
        if row.fact_key == "class_profile.class_rank_top_tenth"
        else row
        for row in source
    )
    adaptation = _adapt(malformed)
    profile = Profile(
        academics=Academics(
            gpa_unweighted=Decimal("3.9"),
            gpa_scale=Decimal("4"),
            class_rank=5,
            class_size=100,
            school_ranks=True,
        )
    )

    assert adaptation.validation_failure_counts == {"gpa_distribution_invalid": 1}
    estimate = _estimate(adaptation.inputs, profile)
    assert estimate.signals[0].source is FitSignalSource.CLASS_RANK


def test_adapter_diagnostics_count_invalid_rank_even_when_gpa_fallback_applies() -> None:
    source = _fixture_rows("complete_required_school.json")
    malformed = tuple(
        row.model_copy(update={"value_num": 95})
        if row.fact_key == "class_profile.class_rank_top_tenth"
        else row.model_copy(update={"value_num": 50})
        if row.fact_key == "class_profile.class_rank_top_quarter"
        else row
        for row in source
    )
    adaptation = _adapt(malformed)
    profile = Profile(
        academics=Academics(
            gpa_unweighted=Decimal("4.0"),
            gpa_scale=Decimal("4"),
            class_rank=5,
            class_size=100,
            school_ranks=True,
        )
    )

    assert adaptation.validation_failure_counts == {"rank_distribution_invalid": 1}
    estimate = _estimate(adaptation.inputs, profile)
    assert estimate.signals[0].source is FitSignalSource.GPA_DISTRIBUTION


def test_adapter_diagnostics_count_invalid_sat_or_act_band_despite_valid_other_test() -> None:
    source = _fixture_rows("complete_required_school.json")
    invalid_sat = tuple(
        row.model_copy(update={"value_num": 800})
        if row.fact_key == "class_profile.sat_math_p25"
        else row
        for row in source
    )
    invalid_act = tuple(
        row.model_copy(update={"value_num": 32})
        if row.fact_key == "class_profile.act_composite_p25"
        else row
        for row in source
    )
    profile = Profile(
        testing=ProfileTesting(sat=SatScore(math=750, ebrw=750), act=ActScore(composite=34))
    )

    sat_adaptation = _adapt(invalid_sat)
    act_adaptation = _adapt(invalid_act)

    assert sat_adaptation.validation_failure_counts == {"test_band_invalid": 1}
    assert act_adaptation.validation_failure_counts == {"test_band_invalid": 1}
    assert _estimate(sat_adaptation.inputs, profile).signals[0].source is FitSignalSource.ACT
    assert _estimate(act_adaptation.inputs, profile).signals[0].source is FitSignalSource.SAT


def test_adapter_diagnostics_count_malformed_or_unknown_policy_but_not_absence_or_staleness() -> (
    None
):
    malformed = _row("admissions.test_policy_sat_or_act", value_type="text", value_text="required")
    unknown = _row(
        "admissions.test_policy_sat_or_act", value_type="enum", value_text="unrecognized"
    )
    known_not_reported = _row(
        "admissions.test_policy_sat_or_act", value_type="enum", value_text="not_reported"
    )
    stale = _row(
        "admissions.test_policy_sat_or_act",
        value_type="enum",
        value_text="required",
        observed_at=NOW - timedelta(days=STALE_DAYS + 1),
    )

    assert _adapt((malformed,)).validation_failure_counts == {"test_policy_invalid": 1}
    assert _adapt((unknown,)).validation_failure_counts == {"test_policy_invalid": 1}
    assert _adapt((known_not_reported,)).validation_failure_counts == {}
    assert _adapt((stale,)).validation_failure_counts == {}
    assert _adapt(()).validation_failure_counts == {}
    assert _adapt(_fixture_rows("not_reported_gpa.json")).validation_failure_counts == {}


def test_adapter_diagnostics_do_not_count_stale_malformed_school_sources() -> None:
    """Freshness wins for telemetry just as it does for adjustment eligibility."""
    stale = NOW - timedelta(days=STALE_DAYS + 1)
    stale_gpa = _row(
        "class_profile.gpa_distribution",
        value_type="text",
        value={"kind": "distribution", "value": {"scale": "gpa"}},
        observed_at=stale,
    )
    stale_rank = (
        _row(
            "class_profile.class_rank_top_tenth",
            value_type="text",
            value_num=95,
            observed_at=stale,
        ),
        _row("class_profile.class_rank_top_quarter", value_num=50, observed_at=stale),
        _row("class_profile.class_rank_top_half", value_num=80, observed_at=stale),
    )
    stale_act = (
        _row(
            "class_profile.act_composite_p25",
            value_type="text",
            value_num=32,
            observed_at=stale,
        ),
        _row("class_profile.act_composite_p75", value_num=31, observed_at=stale),
    )

    assert _adapt((stale_gpa,)).validation_failure_counts == {}
    assert _adapt(stale_rank).validation_failure_counts == {}
    assert _adapt(stale_act).validation_failure_counts == {}


@pytest.mark.parametrize(
    "value_text",
    (
        "considered_if_submitted",
        "not_used_if_submitted",
        "recommended",
        "required_for_some",
        "not_reported",
        "REQUIRED",
        None,
    ),
)
def test_only_the_exact_current_normalized_required_policy_code_can_enable_testing(
    value_text: str | None,
) -> None:
    row = _row(
        "admissions.test_policy_sat_or_act",
        value_type="enum",
        value_text=value_text,
    )

    assert _school((row,)).test_policy is AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN
    assert (
        _school(
            (_row("admissions.test_policy_sat_or_act", value_type="enum", value_text="required"),)
        ).test_policy
        is AdmissionsTestPolicy.REQUIRED
    )


def test_missing_malformed_stale_or_future_policy_is_conservatively_not_required() -> None:
    stale = NOW - timedelta(days=STALE_DAYS + 1)
    future = NOW + timedelta(seconds=1)
    malformed = _row("admissions.test_policy_sat_or_act", value_type="text", value_text="required")

    assert _school(()).test_policy is AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN
    assert (
        _school(
            (_row("admissions.test_policy_sat_or_act", value_text="required", observed_at=stale),)
        ).test_policy
        is AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN
    )
    assert (
        _school(
            (_row("admissions.test_policy_sat_or_act", value_text="required", observed_at=future),)
        ).test_policy
        is AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN
    )
    assert _school((malformed,)).test_policy is AdmissionsTestPolicy.NOT_REQUIRED_OR_UNKNOWN


def test_stale_boundary_and_future_observations_use_closed_reason_codes() -> None:
    profile = Profile.model_validate({"academics": {"gpa_unweighted": "4", "gpa_scale": "4"}})
    source = _fixture_rows("complete_required_school.json")
    exactly_at_boundary = tuple(
        row.model_copy(update={"observed_at": NOW - timedelta(days=STALE_DAYS)}) for row in source
    )
    stale = tuple(
        row.model_copy(update={"observed_at": NOW - timedelta(days=STALE_DAYS + 1)})
        for row in source
    )
    future = tuple(
        row.model_copy(update={"observed_at": NOW + timedelta(seconds=1)}) for row in source
    )

    boundary = _estimate(_school(exactly_at_boundary), profile)
    stale_result = _estimate(_school(stale), profile)
    future_result = _estimate(_school(future), profile)

    assert boundary.basis is FitBasis.PERSONALIZED
    stale_academic = next(
        item for item in stale_result.unavailable if item.factor is FitFactor.ACADEMIC
    )
    future_academic = next(
        item for item in future_result.unavailable if item.factor is FitFactor.ACADEMIC
    )
    assert stale_academic.reason.value == "gpa_distribution_stale"
    assert future_academic.reason.value == "gpa_distribution_invalid"
    assert CaveatCode.STALE_OPTIONAL_FACTS in stale_result.caveats
    assert CaveatCode.STALE_OPTIONAL_FACTS not in future_result.caveats


def test_stale_malformed_gpa_is_caveated_even_when_current_rank_fallback_wins() -> None:
    """Provenance survives a malformed source and does not depend on the winner."""
    source = _fixture_rows("complete_required_school.json")
    stale_malformed_gpa = next(
        row
        for row in source
        if row.fact_key == "class_profile.gpa_distribution"
    ).model_copy(
        update={
            "value_type": "text",
            "observed_at": NOW - timedelta(days=STALE_DAYS + 1),
        }
    )
    rank_rows = tuple(
        row.model_copy(
            update={
                "value_num": 10
                if row.fact_key.endswith("top_tenth")
                else 50
                if row.fact_key.endswith("top_quarter")
                else 80,
                "observed_at": NOW,
            }
        )
        for row in source
        if row.fact_key.startswith("class_profile.class_rank_")
    )
    profile = Profile.model_validate(
        {
            "academics": {
                "gpa_unweighted": "4",
                "gpa_scale": "4",
                "class_rank": 1,
                "class_size": 100,
            }
        }
    )

    result = _estimate(_school((stale_malformed_gpa, *rank_rows), admit_rate=45), profile)

    assert result.signals[0].source is FitSignalSource.CLASS_RANK
    assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats


def test_stale_invalid_rank_is_caveated_even_when_current_gpa_wins() -> None:
    source = _fixture_rows("complete_required_school.json")
    gpa = next(
        row.model_copy(update={"observed_at": NOW})
        for row in source
        if row.fact_key == "class_profile.gpa_distribution"
    )
    stale_invalid_rank = tuple(
        row.model_copy(
            update={
                "value_num": 95 if row.fact_key.endswith("top_tenth") else 50,
                "observed_at": NOW - timedelta(days=STALE_DAYS + 1),
            }
        )
        for row in source
        if row.fact_key.startswith("class_profile.class_rank_")
    )
    profile = Profile.model_validate(
        {
            "academics": {
                "gpa_unweighted": "4",
                "gpa_scale": "4",
                "class_rank": 1,
                "class_size": 100,
            }
        }
    )

    result = _estimate(_school((gpa, *stale_invalid_rank), admit_rate=45), profile)

    assert result.signals[0].source is FitSignalSource.GPA_DISTRIBUTION
    assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats


def test_stale_malformed_sat_band_is_caveated_even_when_current_act_wins() -> None:
    source = _fixture_rows("complete_required_school.json")
    stale_malformed_sat = tuple(
        row.model_copy(
            update={
                "value_type": "text" if row.fact_key.endswith("p25") else row.value_type,
                "observed_at": NOW - timedelta(days=STALE_DAYS + 1),
            }
        )
        for row in source
        if row.fact_key.startswith("class_profile.sat_")
    )
    act_rows = tuple(
        row.model_copy(update={"observed_at": NOW})
        for row in source
        if row.fact_key.startswith("class_profile.act_")
    )
    policy = next(
        row.model_copy(update={"observed_at": NOW})
        for row in source
        if row.fact_key == "admissions.test_policy_sat_or_act"
    )
    profile = Profile.model_validate(
        {"testing": {"sat": {"math": 800, "ebrw": 800}, "act": {"composite": 36}}}
    )

    result = _estimate(_school((*stale_malformed_sat, *act_rows, policy), admit_rate=45), profile)

    assert result.signals[0].source is FitSignalSource.ACT
    assert CaveatCode.STALE_OPTIONAL_FACTS in result.caveats


def test_fresh_complete_optional_facts_do_not_claim_stale_provenance() -> None:
    profile = Profile.model_validate({"academics": {"gpa_unweighted": "4", "gpa_scale": "4"}})

    result = _estimate(
        _school(
            tuple(
                row.model_copy(update={"observed_at": NOW})
                for row in _fixture_rows("complete_required_school.json")
            ),
            admit_rate=45,
        ),
        profile,
    )

    assert result.signals[0].source is FitSignalSource.GPA_DISTRIBUTION
    assert CaveatCode.STALE_OPTIONAL_FACTS not in result.caveats


def test_bad_optional_gpa_fact_cannot_throw_or_discard_valid_rank_and_test_inputs() -> None:
    rows = list(_fixture_rows("complete_required_school.json"))
    index = next(
        index for index, row in enumerate(rows) if row.fact_key == "class_profile.gpa_distribution"
    )
    rows[index] = rows[index].model_copy(update={"value": {"bad": object()}})
    profile = Profile.model_validate(
        {
            "academics": {"class_rank": 26, "class_size": 100},
            "testing": {"sat": {"math": 800, "ebrw": 800}},
        }
    )

    school = _school(tuple(rows), admit_rate=45)
    result = _estimate(school, profile)

    assert school.gpa_distribution is not None and school.gpa_distribution.complete is False
    assert school.rank_distribution is not None
    assert school.sat is not None
    assert result.basis is FitBasis.PERSONALIZED
    assert {signal.factor for signal in result.signals} == {FitFactor.ACADEMIC, FitFactor.TESTING}


def test_row_order_or_duplicates_cannot_change_unavailable_reason_priority() -> None:
    malformed_gpa = _row(
        "class_profile.gpa_distribution",
        value_type="distribution",
        value={"value": {"scale": "gpa", "buckets": [], "omitted_buckets": [], "sums_to": 0}},
    )
    stale_rank = (
        _row(
            "class_profile.class_rank_top_tenth",
            value_num=20,
            value_type="percent",
            observed_at=NOW - timedelta(days=STALE_DAYS + 1),
        ),
        _row("class_profile.class_rank_top_quarter", value_num=50, value_type="percent"),
        _row("class_profile.class_rank_top_half", value_num=80, value_type="percent"),
    )
    profile = Profile.model_validate(
        {"academics": {"gpa_unweighted": "4", "gpa_scale": "4", "class_rank": 1, "class_size": 100}}
    )
    first = _estimate(_school((malformed_gpa, *stale_rank)), profile)
    second = _estimate(
        _school(
            tuple(reversed((malformed_gpa, malformed_gpa, *stale_rank))),
        ),
        profile,
    )

    first_reason = next(item for item in first.unavailable if item.factor is FitFactor.ACADEMIC)
    second_reason = next(item for item in second.unavailable if item.factor is FitFactor.ACADEMIC)
    assert first_reason == second_reason
    assert first_reason.reason.value == "rank_distribution_stale"


def test_adapter_requires_explicit_now_and_stale_window_and_never_reads_the_clock() -> None:
    with pytest.raises(TypeError):
        school_fit_inputs_from_facts(admit_rate=35, facts=())  # type: ignore[call-arg]
