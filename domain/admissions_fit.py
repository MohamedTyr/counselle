"""The admit-rate planning category shown on every Explore card.

The category is a pure function of the school's own published admit rate.
It is a statement about the school -- how many applicants it admits -- and
never a prediction about one student, so no student value is an input and
none can be inferred from the result.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum

# The conventional admit-rate bands. Below `_REACH_BELOW` even a strong
# applicant cannot count on a seat; from `_TARGET_BELOW` up, most applicants
# are admitted. Both are exclusive upper bounds: 20% is a Target, 50% a Safety.
_REACH_BELOW = Decimal("20")
_TARGET_BELOW = Decimal("50")
_MIN_RATE = Decimal("0")
_MAX_RATE = Decimal("100")


class FitCategory(StrEnum):
    """The card's planning categories; none is an admission probability."""

    REACH = "Reach"
    TARGET = "Target"
    SAFETY = "Safety"
    UNKNOWN = "Unknown"


@dataclass(frozen=True, slots=True)
class FitEstimate:
    """One category and the exact rate it was derived from.

    The rate travels with the category so the card can never print a number
    that disagrees with the badge beside it.
    """

    category: FitCategory
    admit_rate: Decimal | None


def estimate_admissions_fit(admit_rate: object) -> FitEstimate:
    """Classify a school by admit rate; an unusable rate classifies nothing.

    ``admit_rate`` is on the 0-100 percentage-point scale that
    ``cds_library.school_explore`` stores. Anything outside it -- absent,
    non-numeric, infinite, negative, above 100 -- is not evidence, and
    yields ``UNKNOWN`` rather than a guessed band.
    """
    rate = _valid_rate(admit_rate)
    if rate is None:
        return FitEstimate(FitCategory.UNKNOWN, None)
    if rate < _REACH_BELOW:
        return FitEstimate(FitCategory.REACH, rate)
    if rate < _TARGET_BELOW:
        return FitEstimate(FitCategory.TARGET, rate)
    return FitEstimate(FitCategory.SAFETY, rate)


def _valid_rate(value: object) -> Decimal | None:
    """Parse a stored percentage without a binary-float round trip."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, Decimal):
        rate = value
    elif isinstance(value, (int, float, str)):
        try:
            rate = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    else:
        return None
    return rate if rate.is_finite() and _MIN_RATE <= rate <= _MAX_RATE else None


__all__ = ["FitCategory", "FitEstimate", "estimate_admissions_fit"]
