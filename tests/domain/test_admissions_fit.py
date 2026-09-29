"""The admit-rate category is the whole algorithm, so its bands are pinned."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.admissions_fit import FitCategory, estimate_admissions_fit


@pytest.mark.parametrize(
    ("admit_rate", "category"),
    [
        (Decimal("0"), FitCategory.REACH),
        (Decimal("19.99"), FitCategory.REACH),
        (Decimal("20"), FitCategory.TARGET),
        (Decimal("49.99"), FitCategory.TARGET),
        (Decimal("50"), FitCategory.SAFETY),
        (Decimal("72"), FitCategory.SAFETY),
        (Decimal("100"), FitCategory.SAFETY),
    ],
)
def test_bands_are_exclusive_upper_bounds(admit_rate: Decimal, category: FitCategory) -> None:
    estimate = estimate_admissions_fit(admit_rate)
    assert estimate.category is category
    assert estimate.admit_rate == admit_rate


@pytest.mark.parametrize("admit_rate", [72, 72.0, "72"])
def test_a_stored_rate_classifies_whatever_its_python_type(admit_rate: object) -> None:
    assert estimate_admissions_fit(admit_rate).category is FitCategory.SAFETY


@pytest.mark.parametrize(
    "admit_rate",
    [
        None,
        True,
        "not a number",
        object(),
        Decimal("-0.01"),
        Decimal("100.01"),
        Decimal("NaN"),
        Decimal("Infinity"),
    ],
)
def test_an_unusable_rate_classifies_nothing(admit_rate: object) -> None:
    estimate = estimate_admissions_fit(admit_rate)
    assert estimate.category is FitCategory.UNKNOWN
    assert estimate.admit_rate is None
