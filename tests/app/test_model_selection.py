"""Tests for app/model_selection.py — the Quick/Think resolver (plan §11.1)."""

from __future__ import annotations

from typing import Any, cast

import pytest

from app.model_selection import CounselorModelSelection, counselor_model_selection
from config.settings import Settings
from domain.response_mode import ResponseMode

_QUICK = "fireworks:accounts/fireworks/models/quick-model"
_THINK = "fireworks:accounts/fireworks/models/think-model"


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = dict(
        db_ro_dsn="postgresql://x/y",
        db_app_dsn="postgresql://x/y",
        model_counselor=_QUICK,
        model_counselor_think=_THINK,
        reasoning_effort_quick="low",
        reasoning_effort_think="high",
        model_prices={
            name.removeprefix("fireworks:"): {"input_per_1m": 1.0, "output_per_1m": 1.0}
            for name in (_QUICK, _THINK)
        }
        | {
            "accounts/fireworks/models/deepseek-v4p1-flash": {
                "input_per_1m": 1.0,
                "output_per_1m": 1.0,
            }
        },
    )
    base.update(overrides)
    return Settings(**cast(dict[str, Any], base))


class TestCounselorModelSelection:
    def test_quick_maps_to_model_counselor_at_quick_effort(self) -> None:
        selection = counselor_model_selection(ResponseMode.QUICK, _settings())
        assert selection == CounselorModelSelection(
            response_mode=ResponseMode.QUICK,
            model_setting=_QUICK,
            reasoning_effort="low",
        )

    def test_think_maps_to_model_counselor_think_at_think_effort(self) -> None:
        selection = counselor_model_selection(ResponseMode.THINK, _settings())
        assert selection == CounselorModelSelection(
            response_mode=ResponseMode.THINK,
            model_setting=_THINK,
            reasoning_effort="high",
        )

    def test_efforts_follow_settings(self) -> None:
        settings = _settings(reasoning_effort_quick="none", reasoning_effort_think="medium")
        assert counselor_model_selection(ResponseMode.QUICK, settings).reasoning_effort == "none"
        assert counselor_model_selection(ResponseMode.THINK, settings).reasoning_effort == "medium"

    def test_selection_is_frozen(self) -> None:
        selection = counselor_model_selection(ResponseMode.QUICK, _settings())
        with pytest.raises(AttributeError):
            selection.model_setting = "other"  # type: ignore[misc]
