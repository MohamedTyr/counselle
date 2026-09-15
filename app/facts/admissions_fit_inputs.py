"""Narrow, defensive translation into the admissions-fit domain contract.

This module is the only place where the estimator sees workspace ``Profile``
objects or ``current_school_facts`` rows.  It deliberately consumes a closed
fact-key tuple and turns an unusable optional row into an unavailable/invalid
domain shape; an unexpected row must never make a whole Explore card fail.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from app.workspace.models import Profile
from counselle_db.models import FactValueRow
from domain.admissions_fit import (
    GpaBucket,
    GpaDistribution,
    ObservedDecimal,
    RankDistribution,
    SchoolFitInputs,
    SchoolSatBands,
    ScoreBand,
    StudentFitInputs,
    TestPolicy,
)

# This is deliberately a tuple, rather than a caller-selected collection: the
# batch reader and adapter must have precisely one code-owned v1 allowlist.
ADMISSIONS_FIT_FACT_KEYS: tuple[str, ...] = (
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

_GPA_DISTRIBUTION_KEY = "class_profile.gpa_distribution"
_POLICY_KEY = "admissions.test_policy_sat_or_act"
_RANK_KEYS = (
    "class_profile.class_rank_top_tenth",
    "class_profile.class_rank_top_quarter",
    "class_profile.class_rank_top_half",
)
_SAT_MATH_KEYS = ("class_profile.sat_math_p25", "class_profile.sat_math_p75")
_SAT_EBRW_KEYS = ("class_profile.sat_ebrw_p25", "class_profile.sat_ebrw_p75")
_ACT_KEYS = ("class_profile.act_composite_p25", "class_profile.act_composite_p75")

_ZERO = Decimal("0")
_FOUR = Decimal("4")
_ONE = Decimal("1")
_THIRTY_SIX = Decimal("36")
_ONE_HUNDRED = Decimal("100")
_GPA_SUM_MIN = Decimal("99.5")
_GPA_SUM_MAX = Decimal("100.5")
_GPA_RANGE_LABEL = re.compile(r"^\s*(?P<lower>\d+(?:\.\d+)?)\s*[-–]\s*(?P<upper>\d+(?:\.\d+)?)\s*$")
_GPA_OPEN_LABEL = re.compile(r"^\s*(?P<lower>\d+(?:\.\d+)?)\s+(?:and|&)\s+above\s*$", re.IGNORECASE)


def student_fit_inputs_from_profile(profile: Profile | None) -> StudentFitInputs:
    """Select the exact saved-Profile fields comparable in admissions-fit-v1."""
    academics = profile.academics if isinstance(profile, Profile) else None
    testing = profile.testing if isinstance(profile, Profile) else None
    sat = testing.sat if testing is not None else None
    act = testing.act if testing is not None else None
    return StudentFitInputs(
        gpa_unweighted=_profile_decimal(
            academics.gpa_unweighted if academics is not None else None
        ),
        gpa_scale=_profile_decimal(academics.gpa_scale if academics is not None else None),
        class_rank=_profile_decimal(academics.class_rank if academics is not None else None),
        class_size=_profile_decimal(academics.class_size if academics is not None else None),
        school_ranks=academics.school_ranks if academics is not None else None,
        sat_math=_profile_decimal(sat.math if sat is not None else None),
        sat_ebrw=_profile_decimal(sat.ebrw if sat is not None else None),
        act_composite=_profile_decimal(act.composite if act is not None else None),
    )


def school_fit_inputs_from_facts(
    *,
    admit_rate: object,
    facts: Iterable[FactValueRow],
    now: datetime,
    stale_after_days: int,
) -> SchoolFitInputs:
    """Build one immutable school input without trusting optional fact rows.

    ``now`` is request-owned and explicit.  We retain a valid old observation
    for the domain calculator to report as stale, but never let future or
    malformed observation timestamps masquerade as fresh evidence.  Policy is
    intentionally more conservative: its DTO has no timestamp, so an old
    ``required`` row becomes ``not_required_or_unknown``.
    """
    rows = _unique_allowed_rows(facts)
    return SchoolFitInputs(
        admit_rate=_decimal(admit_rate),
        gpa_distribution=_gpa_distribution(rows.get(_GPA_DISTRIBUTION_KEY), now),
        rank_distribution=_rank_distribution(rows, now, stale_after_days),
        sat=SchoolSatBands(
            math=_score_band(
                rows, _SAT_MATH_KEYS, _SAT_MIN, _SAT_MAX, now, stale_after_days
            ),
            ebrw=_score_band(
                rows, _SAT_EBRW_KEYS, _SAT_MIN, _SAT_MAX, now, stale_after_days
            ),
        )
        if _has_any(rows, (*_SAT_MATH_KEYS, *_SAT_EBRW_KEYS))
        else None,
        act=_score_band(rows, _ACT_KEYS, _ACT_MIN, _ACT_MAX, now, stale_after_days),
        test_policy=_test_policy(rows.get(_POLICY_KEY), now, stale_after_days),
    )


_SAT_MIN = Decimal("200")
_SAT_MAX = Decimal("800")
_ACT_MIN = _ONE
_ACT_MAX = _THIRTY_SIX


def _profile_decimal(value: object) -> Decimal | None:
    """Profile fields are validated at their boundary; retain only finite decimals."""
    return _decimal(value)


def _decimal(value: object) -> Decimal | None:
    """Parse JSON/Profile numbers without a binary-float conversion round trip."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, Decimal):
        candidate = value
    elif isinstance(value, (int, float, str)):
        try:
            candidate = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    else:
        return None
    return candidate if candidate.is_finite() else None


def _unique_allowed_rows(facts: Iterable[FactValueRow]) -> dict[str, FactValueRow]:
    """Keep exactly-one rows only; a duplicate has no deterministic source truth."""
    grouped: dict[str, list[FactValueRow]] = {}
    try:
        iterator = iter(facts)
    except TypeError:
        return {}
    for row in iterator:
        if not isinstance(row, FactValueRow):
            continue
        key = row.fact_key
        if key in ADMISSIONS_FIT_FACT_KEYS:
            grouped.setdefault(key, []).append(row)
    return {key: rows[0] for key, rows in grouped.items() if len(rows) == 1}


def _has_any(rows: Mapping[str, FactValueRow], keys: tuple[str, ...]) -> bool:
    return any(key in rows for key in keys)


def _gpa_distribution(row: FactValueRow | None, now: datetime) -> GpaDistribution | None:
    if row is None:
        return None
    observed_at = _observation(row, now)
    payload = _wrapped_value(row)
    if (
        row.value_type != "distribution"
        or not isinstance(row.value, Mapping)
        or row.value.get("kind") != "distribution"
        or payload is None
    ):
        return _invalid_gpa_distribution(observed_at)
    scale = payload.get("scale")
    buckets = payload.get("buckets")
    omitted = payload.get("omitted_buckets")
    declared_total = _decimal(payload.get("sums_to"))
    if (
        scale != "gpa"
        or not isinstance(buckets, list)
        or not buckets
        or not isinstance(omitted, list)
        or omitted
        or declared_total is None
        or not _between(declared_total, _GPA_SUM_MIN, _GPA_SUM_MAX)
    ):
        return _invalid_gpa_distribution(observed_at)
    parsed = tuple(_gpa_bucket(item) for item in buckets)
    if any(bucket is None for bucket in parsed):
        return _invalid_gpa_distribution(observed_at)
    typed = tuple(
        sorted(
            (bucket for bucket in parsed if isinstance(bucket, GpaBucket)),
            key=lambda item: item.lower,
        )
    )
    if not _valid_gpa_buckets(typed, declared_total):
        return _invalid_gpa_distribution(observed_at)
    return GpaDistribution(
        value_type="distribution",
        scale="gpa",
        complete=True,
        observed_at=observed_at,
        buckets=typed,
    )


def _invalid_gpa_distribution(observed_at: datetime | None) -> GpaDistribution:
    """An explicit malformed-row sentinel maps to the domain's closed reason code."""
    return GpaDistribution(
        value_type="invalid",
        scale="invalid",
        complete=False,
        observed_at=observed_at,
        buckets=(),
    )


def _wrapped_value(row: FactValueRow) -> Mapping[str, Any] | None:
    if not isinstance(row.value, Mapping):
        return None
    payload = row.value.get("value")
    return payload if isinstance(payload, Mapping) else None


def _gpa_bucket(value: object) -> GpaBucket | None:
    if not isinstance(value, Mapping) or value.get("absence") is not None:
        return None
    label = value.get("label")
    if not isinstance(label, str):
        return None
    parsed_label = _parse_gpa_label(label)
    percentage = _decimal(value.get("pct"))
    if parsed_label is None or percentage is None:
        return None
    lower_from_label, upper_from_label = parsed_label
    raw_lower = value.get("lo")
    raw_upper = value.get("hi")
    lower = _decimal(raw_lower)
    upper = _decimal(raw_upper)
    if upper_from_label is None:
        if (raw_lower is not None and lower != lower_from_label) or raw_upper is not None:
            return None
    elif lower_from_label != lower or upper_from_label != upper:
        return None
    return GpaBucket(lower=lower_from_label, upper=upper_from_label, percentage=percentage)


def _parse_gpa_label(label: str) -> tuple[Decimal, Decimal | None] | None:
    range_match = _GPA_RANGE_LABEL.match(label)
    if range_match is not None:
        lower = _decimal(range_match["lower"])
        upper = _decimal(range_match["upper"])
        return (lower, upper) if lower is not None and upper is not None else None
    open_match = _GPA_OPEN_LABEL.match(label)
    if open_match is not None:
        lower = _decimal(open_match["lower"])
        return (lower, None) if lower is not None else None
    return None


def _valid_gpa_buckets(buckets: tuple[GpaBucket, ...], declared_total: Decimal) -> bool:
    total = _ZERO
    previous_upper: Decimal | None = None
    for index, bucket in enumerate(buckets):
        if not _between(bucket.lower, _ZERO, _FOUR) or not _between(
            bucket.percentage, _ZERO, _ONE_HUNDRED
        ):
            return False
        if bucket.upper is not None and (
            not _between(bucket.upper, bucket.lower, _FOUR) or bucket.upper < bucket.lower
        ):
            return False
        if bucket.upper is None and index != len(buckets) - 1:
            return False
        if previous_upper is not None and previous_upper >= bucket.lower:
            return False
        previous_upper = bucket.upper
        total += bucket.percentage
    return (
        _between(total, _GPA_SUM_MIN, _GPA_SUM_MAX)
        and _between(declared_total, _GPA_SUM_MIN, _GPA_SUM_MAX)
    )


def _rank_distribution(
    rows: Mapping[str, FactValueRow], now: datetime, stale_after_days: int
) -> RankDistribution | None:
    rank_rows = tuple(rows.get(key) for key in _RANK_KEYS)
    if any(row is None for row in rank_rows):
        return None
    typed_rows = tuple(row for row in rank_rows if isinstance(row, FactValueRow))
    if any(row.value_type != "percent" for row in typed_rows):
        return _invalid_rank_distribution(())
    observations = tuple(_observed_numeric(row, now) for row in typed_rows)
    if not _all_observations_valid(observations):
        return _invalid_rank_distribution(observations)
    values = tuple(item.value for item in observations)
    assert all(value is not None for value in values)
    typed_values = tuple(value for value in values if value is not None)
    if not _any_stale(observations, now, stale_after_days) and (
        any(not _between(value, _ZERO, _ONE_HUNDRED) for value in typed_values)
        or typed_values[0] > typed_values[1]
        or typed_values[1] > typed_values[2]
    ):
        return _invalid_rank_distribution(observations)
    return RankDistribution(
        top_tenth=observations[0], top_quarter=observations[1], top_half=observations[2]
    )


def _invalid_rank_distribution(observations: tuple[ObservedDecimal, ...]) -> RankDistribution:
    stamps = tuple(item.observed_at for item in observations)
    return RankDistribution(
        top_tenth=ObservedDecimal(None, stamps[0] if stamps else None),
        top_quarter=ObservedDecimal(None, stamps[1] if len(stamps) > 1 else None),
        top_half=ObservedDecimal(None, stamps[2] if len(stamps) > 2 else None),
    )


def _score_band(
    rows: Mapping[str, FactValueRow],
    keys: tuple[str, str],
    minimum: Decimal,
    maximum: Decimal,
    now: datetime,
    stale_after_days: int,
) -> ScoreBand | None:
    low, high = (rows.get(key) for key in keys)
    if low is None or high is None:
        return None
    if low.value_type != "count" or high.value_type != "count":
        return _invalid_score_band(
            (
                ObservedDecimal(None, _observation(low, now)),
                ObservedDecimal(None, _observation(high, now)),
            )
        )
    observations = (_observed_numeric(low, now), _observed_numeric(high, now))
    if not _all_observations_valid(observations):
        return _invalid_score_band(observations)
    low_value, high_value = (item.value for item in observations)
    assert low_value is not None and high_value is not None
    if not _any_stale(observations, now, stale_after_days) and (
        not _between(low_value, minimum, maximum)
        or not _between(high_value, minimum, maximum)
        or low_value >= high_value
    ):
        return _invalid_score_band(observations)
    return ScoreBand(p25=observations[0], p75=observations[1])


def _invalid_score_band(observations: tuple[ObservedDecimal, ObservedDecimal]) -> ScoreBand:
    return ScoreBand(
        p25=ObservedDecimal(None, observations[0].observed_at),
        p75=ObservedDecimal(None, observations[1].observed_at),
    )


def _observed_numeric(row: FactValueRow, now: datetime) -> ObservedDecimal:
    return ObservedDecimal(_decimal(row.value_num), _observation(row, now))


def _all_observations_valid(observations: tuple[ObservedDecimal, ...]) -> bool:
    return all(item.value is not None and item.observed_at is not None for item in observations)


def _any_stale(
    observations: tuple[ObservedDecimal, ...], now: datetime, stale_after_days: int
) -> bool:
    """Preserve a stale-but-numeric source for the domain's stale reason path."""
    return any(
        item.observed_at is not None
        and not _is_current_observation(item.observed_at, now, stale_after_days)
        for item in observations
    )


def _test_policy(row: FactValueRow | None, now: datetime, stale_after_days: int) -> TestPolicy:
    if (
        row is not None
        and row.value_type == "enum"
        and row.value_text == "required"
        and _is_current_observation(_observation(row, now), now, stale_after_days)
    ):
        return TestPolicy.REQUIRED
    return TestPolicy.NOT_REQUIRED_OR_UNKNOWN


def _observation(row: FactValueRow, now: datetime) -> datetime | None:
    observed_at = row.observed_at
    if not _valid_now(now) or not isinstance(observed_at, datetime) or observed_at.tzinfo is None:
        return None
    try:
        return observed_at if observed_at <= now else None
    except TypeError:
        return None


def _is_current_observation(
    observed_at: datetime | None, now: datetime, stale_after_days: int
) -> bool:
    if not _valid_now(now) or observed_at is None or not isinstance(stale_after_days, int):
        return False
    try:
        return now - observed_at <= timedelta(days=max(stale_after_days, 0))
    except TypeError:
        return False


def _valid_now(value: object) -> bool:
    return isinstance(value, datetime) and value.tzinfo is not None


def _between(value: Decimal, minimum: Decimal, maximum: Decimal) -> bool:
    return value.is_finite() and minimum <= value <= maximum


__all__ = [
    "ADMISSIONS_FIT_FACT_KEYS",
    "school_fit_inputs_from_facts",
    "student_fit_inputs_from_profile",
]
