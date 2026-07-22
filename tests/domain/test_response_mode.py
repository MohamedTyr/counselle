"""Tests for domain/response_mode.py."""

from __future__ import annotations

import pytest

from domain.response_mode import ResponseMode


def test_values_are_exactly_quick_and_think() -> None:
    assert ResponseMode.QUICK.value == "quick"
    assert ResponseMode.THINK.value == "think"
    assert {m.value for m in ResponseMode} == {"quick", "think"}


def test_constructs_from_persisted_string() -> None:
    assert ResponseMode("quick") is ResponseMode.QUICK
    assert ResponseMode("think") is ResponseMode.THINK


def test_malformed_value_raises() -> None:
    with pytest.raises(ValueError):
        ResponseMode("pro")
