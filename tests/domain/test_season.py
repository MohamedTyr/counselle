"""Admission-season context (ARCHITECTURE §16; config/assets/season_calendar.yaml).

`admission_season(today, calendar)` is PURE — the test loads the YAML asset and
passes the windows in. Phase strings are pinned to the asset's stable identifiers.
Entering-class rule: Jun–Dec → fall of (year + 1); Jan–May → fall of (year).
"""

from datetime import date
from pathlib import Path

import yaml

from domain.season import Season, SeasonWindow, admission_season

CALENDAR_PATH = Path(__file__).resolve().parents[2] / "config" / "assets" / "season_calendar.yaml"


def _calendar() -> list[SeasonWindow]:
    rows = yaml.safe_load(CALENDAR_PATH.read_text())
    return [SeasonWindow.model_validate(row) for row in rows]


def test_mid_june_is_pre_application_for_next_falls_entering_class() -> None:
    # Arrange
    calendar = _calendar()

    # Act
    season = admission_season(date(2026, 6, 10), calendar)

    # Assert
    assert isinstance(season, Season)
    assert season.phase == "pre-application"
    assert season.entering_class == "Fall 2027"
    assert season.description.strip()


def test_early_november_is_early_deadlines_for_next_falls_entering_class() -> None:
    # Arrange
    calendar = _calendar()

    # Act
    season = admission_season(date(2026, 11, 5), calendar)

    # Assert
    assert season.phase == "early deadlines"
    assert season.entering_class == "Fall 2027"


def test_mid_april_is_decision_choose_for_this_falls_entering_class() -> None:
    # Arrange
    calendar = _calendar()

    # Act
    season = admission_season(date(2026, 4, 15), calendar)

    # Assert
    assert season.phase == "decision/choose"
    assert season.entering_class == "Fall 2026"


def test_june_first_boundary_falls_on_the_next_fall_side() -> None:
    # Arrange
    calendar = _calendar()

    # Act
    season = admission_season(date(2026, 6, 1), calendar)

    # Assert
    assert season.phase == "pre-application"
    assert season.entering_class == "Fall 2027"


def test_may_thirty_first_boundary_falls_on_the_this_fall_side() -> None:
    # Arrange
    calendar = _calendar()

    # Act
    season = admission_season(date(2026, 5, 31), calendar)

    # Assert
    assert season.phase == "decision/choose"
    assert season.entering_class == "Fall 2026"
