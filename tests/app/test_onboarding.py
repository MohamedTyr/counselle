"""Pure onboarding-progress logic: transitions, parsing, initial-state merge.

No DB, no auth — `apply_onboarding_command` is a pure function (README §8's
transition table), directly unit-tested here.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.onboarding import (
    OnboardingCommand,
    OnboardingProgress,
    OnboardingStateError,
    OnboardingStep,
    apply_onboarding_command,
    initial_onboarding_state,
    merge_initial_onboarding_settings,
    parse_onboarding_state,
)

_NOW = datetime(2026, 7, 21, 12, 0, 0, tzinfo=UTC)
_LATER = datetime(2026, 7, 21, 12, 5, 0, tzinfo=UTC)


def _progress(status: str, step: str, **overrides: object) -> OnboardingProgress:
    return OnboardingProgress.model_validate(
        {
            "version": 1,
            "status": status,
            "current_step": step,
            "updated_at": _NOW,
            "completed_at": None,
            **overrides,
        }
    )


# ---------------------------------------------------------------------------
# Transition table (README §8)
# ---------------------------------------------------------------------------


def test_start_from_absent_state_begins_at_basics() -> None:
    result = apply_onboarding_command(None, OnboardingCommand(action="start"), now=_NOW)
    assert result.status == "in_progress"
    assert result.current_step == "basics"


def test_start_from_not_started_begins_at_basics() -> None:
    current = _progress("not_started", "basics")
    result = apply_onboarding_command(current, OnboardingCommand(action="start"), now=_LATER)
    assert result.status == "in_progress"
    assert result.current_step == "basics"


def test_start_from_deferred_resumes_same_step() -> None:
    current = _progress("deferred", "direction")
    result = apply_onboarding_command(current, OnboardingCommand(action="start"), now=_LATER)
    assert result.status == "in_progress"
    assert result.current_step == "direction"


@pytest.mark.parametrize(
    ("step", "expected_next"),
    [
        ("basics", "academics"),
        ("academics", "direction"),
        ("direction", "context"),
        ("context", "fit"),
    ],
)
def test_advance_moves_to_the_next_fixed_step(step: OnboardingStep, expected_next: str) -> None:
    current = _progress("in_progress", step)
    result = apply_onboarding_command(
        current, OnboardingCommand(action="advance", step=step), now=_LATER
    )
    assert result.status == "in_progress"
    assert result.current_step == expected_next


def test_defer_preserves_current_step() -> None:
    current = _progress("in_progress", "context")
    result = apply_onboarding_command(current, OnboardingCommand(action="defer"), now=_LATER)
    assert result.status == "deferred"
    assert result.current_step == "context"


def test_complete_requires_fit_step_and_stamps_completed_at() -> None:
    current = _progress("in_progress", "fit")
    result = apply_onboarding_command(
        current, OnboardingCommand(action="complete", step="fit"), now=_LATER
    )
    assert result.status == "completed"
    assert result.current_step == "fit"
    assert result.completed_at == _LATER


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def test_advance_retry_with_an_earlier_step_is_idempotent() -> None:
    current = _progress("in_progress", "direction")
    result = apply_onboarding_command(
        current, OnboardingCommand(action="advance", step="basics"), now=_LATER
    )
    assert result == current


def test_advance_with_a_later_step_than_current_is_rejected() -> None:
    current = _progress("in_progress", "basics")
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(
            current, OnboardingCommand(action="advance", step="fit"), now=_LATER
        )


def test_repeated_complete_on_completed_state_is_idempotent() -> None:
    current = _progress("completed", "fit", completed_at=_NOW)
    result = apply_onboarding_command(
        current, OnboardingCommand(action="complete", step="fit"), now=_LATER
    )
    assert result == current


# ---------------------------------------------------------------------------
# Completed cannot regress
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "command",
    [
        OnboardingCommand(action="start"),
        OnboardingCommand(action="advance", step="fit"),
        OnboardingCommand(action="defer"),
    ],
)
def test_completed_state_is_unchanged_by_any_command(command: OnboardingCommand) -> None:
    current = _progress("completed", "fit", completed_at=_NOW)
    result = apply_onboarding_command(current, command, now=_LATER)
    assert result == current


# ---------------------------------------------------------------------------
# Malformed / structurally invalid transitions -> OnboardingStateError (route: 422)
# ---------------------------------------------------------------------------


def test_advance_without_a_step_is_rejected() -> None:
    current = _progress("in_progress", "basics")
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(current, OnboardingCommand(action="advance"), now=_LATER)


def test_advance_past_the_final_step_is_rejected() -> None:
    current = _progress("in_progress", "fit")
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(
            current, OnboardingCommand(action="advance", step="fit"), now=_LATER
        )


def test_complete_before_reaching_fit_is_rejected() -> None:
    current = _progress("in_progress", "context")
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(
            current, OnboardingCommand(action="complete", step="fit"), now=_LATER
        )


def test_complete_with_wrong_step_name_is_rejected() -> None:
    current = _progress("in_progress", "fit")
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(
            current, OnboardingCommand(action="complete", step="context"), now=_LATER
        )


@pytest.mark.parametrize("action", ["advance", "defer", "complete"])
def test_advance_defer_complete_before_start_is_rejected(action: str) -> None:
    with pytest.raises(OnboardingStateError):
        apply_onboarding_command(None, OnboardingCommand(action=action), now=_LATER)  # type: ignore[arg-type]


def test_malformed_action_is_rejected_by_pydantic() -> None:
    with pytest.raises(ValidationError):
        OnboardingCommand.model_validate({"action": "not-a-real-action"})


def test_malformed_step_is_rejected_by_pydantic() -> None:
    with pytest.raises(ValidationError):
        OnboardingCommand.model_validate({"action": "advance", "step": "not-a-real-step"})


# ---------------------------------------------------------------------------
# Initialization / parsing
# ---------------------------------------------------------------------------


def test_initial_onboarding_state_is_not_started_at_basics() -> None:
    state = initial_onboarding_state(now=_NOW)
    assert state["status"] == "not_started"
    assert state["current_step"] == "basics"
    assert state["version"] == 1
    assert state["completed_at"] is None


def test_merge_initial_onboarding_settings_preserves_other_supplied_settings() -> None:
    merged = merge_initial_onboarding_settings({"theme": "dark"}, now=_NOW)
    assert merged["theme"] == "dark"
    assert merged["onboarding"]["status"] == "not_started"


def test_merge_initial_onboarding_settings_never_overwrites_a_trusted_state() -> None:
    trusted = {"version": 1, "status": "completed", "current_step": "fit", "updated_at": "x"}
    merged = merge_initial_onboarding_settings({"onboarding": trusted}, now=_NOW)
    assert merged["onboarding"] == trusted


def test_merge_initial_onboarding_settings_does_not_mutate_input() -> None:
    original = {"theme": "dark"}
    merge_initial_onboarding_settings(original, now=_NOW)
    assert original == {"theme": "dark"}


def test_parse_onboarding_state_absent_key_returns_none() -> None:
    assert parse_onboarding_state({}) is None
    assert parse_onboarding_state(None) is None


def test_parse_onboarding_state_malformed_value_returns_none() -> None:
    assert parse_onboarding_state({"onboarding": {"status": "not-a-real-status"}}) is None
    assert parse_onboarding_state({"onboarding": "garbage"}) is None


def test_parse_onboarding_state_valid_value_round_trips() -> None:
    raw = initial_onboarding_state(now=_NOW)
    parsed = parse_onboarding_state({"onboarding": raw})
    assert parsed is not None
    assert parsed.status == "not_started"
    assert parsed.current_step == "basics"
