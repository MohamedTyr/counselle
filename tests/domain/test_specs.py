"""Spec types: clarify spec (ARCHITECTURE §12.1), events (§6)."""

import pytest
from pydantic import ValidationError

from domain.events import Event, ev_delta
from domain.specs import ClarifyOption, ClarifySpec


def _options(n: int) -> list[ClarifyOption]:
    return [ClarifyOption(label=f"Option {i}", hint=f"hint {i}") for i in range(n)]


def _clarify(n_options: int) -> ClarifySpec:
    return ClarifySpec(
        question="Good for what? A few things shape the answer:",
        header="What matters",
        multi_select=False,
        options=_options(n_options),
    )


# --- ClarifySpec: 2-4 options, never an intake form ---


def test_clarify_spec_accepts_two_to_four_options() -> None:
    # Arrange / Act / Assert
    for n in (2, 3, 4):
        spec = _clarify(n)
        assert len(spec.options) == n
        assert spec.v == 1


def test_clarify_spec_rejects_a_single_option() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValidationError):
        _clarify(1)


def test_clarify_spec_rejects_five_options() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValidationError):
        _clarify(5)


# --- Event envelope: versioned protocol (ARCHITECTURE §6) ---


def test_event_serializes_with_protocol_version_one() -> None:
    # Arrange
    event = ev_delta("Duke admits about ")

    # Act
    dumped = event.model_dump()

    # Assert
    assert isinstance(event, Event)
    assert dumped["v"] == 1
    assert dumped["type"] == "delta"
    assert dumped["data"]["text"] == "Duke admits about "
