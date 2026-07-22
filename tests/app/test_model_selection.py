"""Tests for app/model_selection.py — the Quick/Think resolver (plan §11.1)."""

from __future__ import annotations

import pytest

from app.model_selection import (
    CounselorModelSelection,
    UnsupportedCounselorProvider,
    counselor_model_selection,
)
from config.settings import Settings
from domain.response_mode import ResponseMode


def _settings(**overrides: object) -> Settings:
    base = dict(
        db_ro_dsn="postgresql://x/y",
        db_app_dsn="postgresql://x/y",
        model_counselor="google-vertex:gemini-3.5-flash",
        model_counselor_think="google-vertex:gemini-3.1-pro-preview",
        thinking_stream=True,
        thinking_summaries=None,
    )
    base.update(overrides)
    return Settings(**base)


class TestCounselorModelSelection:
    def test_quick_maps_to_model_counselor_minimal_no_thoughts(self) -> None:
        selection = counselor_model_selection(ResponseMode.QUICK, _settings())
        assert selection == CounselorModelSelection(
            response_mode=ResponseMode.QUICK,
            model_setting="google-vertex:gemini-3.5-flash",
            thinking_level="MINIMAL",
            include_thoughts=False,
        )

    def test_think_maps_to_model_counselor_think_high(self) -> None:
        selection = counselor_model_selection(ResponseMode.THINK, _settings())
        assert selection.response_mode is ResponseMode.THINK
        assert selection.model_setting == "google-vertex:gemini-3.1-pro-preview"
        assert selection.thinking_level == "HIGH"

    def test_think_include_thoughts_follows_effective_thinking_stream_true(self) -> None:
        selection = counselor_model_selection(
            ResponseMode.THINK, _settings(thinking_stream=True)
        )
        assert selection.include_thoughts is True

    def test_think_include_thoughts_follows_effective_thinking_stream_false(self) -> None:
        selection = counselor_model_selection(
            ResponseMode.THINK, _settings(thinking_stream=False)
        )
        assert selection.include_thoughts is False

    def test_quick_never_requests_thoughts_even_when_stream_enabled(self) -> None:
        selection = counselor_model_selection(
            ResponseMode.QUICK, _settings(thinking_stream=True)
        )
        assert selection.include_thoughts is False

    def test_selection_is_frozen(self) -> None:
        selection = counselor_model_selection(ResponseMode.QUICK, _settings())
        with pytest.raises(AttributeError):
            selection.model_setting = "other"  # type: ignore[misc]

    def test_non_vertex_quick_model_fails_fast(self) -> None:
        settings = _settings(model_counselor="anthropic:claude-sonnet-4-6")
        with pytest.raises(UnsupportedCounselorProvider):
            counselor_model_selection(ResponseMode.QUICK, settings)

    def test_non_vertex_think_model_fails_fast(self) -> None:
        settings = _settings(model_counselor_think="anthropic:claude-sonnet-4-6")
        with pytest.raises(UnsupportedCounselorProvider):
            counselor_model_selection(ResponseMode.THINK, settings)
