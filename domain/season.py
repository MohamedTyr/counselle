"""Admission-season context (ARCHITECTURE §16) — pure lookup, calendar passed in.

The phase table is a versioned data asset (``config/assets/season_calendar.yaml``);
callers load it and pass the rows here. Entering-class rule: Jun-Dec windows
belong to the cycle entering fall of ``year + 1``; Jan-May to fall of ``year``.
Season awareness is *context*, never a deadline tracker — school-specific dates
are data, fetched and cited like any value.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MonthSpan(BaseModel):
    """An inclusive calendar-month range (never wraps the year end)."""

    start: int = Field(ge=1, le=12)
    end: int = Field(ge=1, le=12)

    @model_validator(mode="after")
    def _never_wraps(self) -> "MonthSpan":
        if self.start > self.end:
            raise ValueError(f"month span must not wrap the year: {self.start} > {self.end}")
        return self


class SeasonWindow(BaseModel):
    """One row of the season-calendar asset."""

    months: MonthSpan
    phase: str
    description: str
    entering_class: Literal["next_fall", "this_fall"]


class Season(BaseModel):
    """Where in the admissions cycle today falls, for prompt context."""

    phase: str
    description: str
    entering_class: str  # e.g. "Fall 2027"
    cycle_note: str


def admission_season(today: date, calendar: list[SeasonWindow]) -> Season:
    """Resolve today's cycle phase + active entering class from the calendar."""
    for window in calendar:
        if window.months.start <= today.month <= window.months.end:
            year = today.year + 1 if window.entering_class == "next_fall" else today.year
            entering = f"Fall {year}"
            return Season(
                phase=window.phase,
                description=window.description,
                entering_class=entering,
                cycle_note=(
                    f"It is the {window.phase} phase of the admissions cycle "
                    f"for the class entering {entering}."
                ),
            )
    raise ValueError(f"no season window covers month {today.month}")  # data/programmer error
