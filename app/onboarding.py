"""Onboarding progress: typed state, pure transitions, and persistence.

Progress is UI flow state, not student Profile data (plan `plans/user-onboarding/
README.md` §8) — it never duplicates an answer. Stored under
``users.settings.onboarding``, version 1. The onboarding *answers* themselves
write through the existing ``app/workspace/service_profile.py`` Profile path;
this module only tracks which step the student is on.

The transition function (:func:`apply_onboarding_command`) is pure and takes
an explicit ``now`` so it is directly unit-testable without a clock or a DB.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import asyncpg
from pydantic import BaseModel

ONBOARDING_VERSION = 1

OnboardingStep = Literal["basics", "academics", "direction", "context", "fit"]
OnboardingStatus = Literal["not_started", "in_progress", "deferred", "completed"]
OnboardingAction = Literal["start", "advance", "defer", "complete"]

# Ordered flow — README §8's `current_step` is "the first step not yet completed".
STEPS: tuple[OnboardingStep, ...] = ("basics", "academics", "direction", "context", "fit")


class OnboardingProgress(BaseModel):
    """The normalized state stored at ``users.settings.onboarding``."""

    version: int = ONBOARDING_VERSION
    status: OnboardingStatus
    current_step: OnboardingStep
    updated_at: datetime
    completed_at: datetime | None = None


class OnboardingCommand(BaseModel):
    """The `PATCH /v1/onboarding` request body (README §8)."""

    action: OnboardingAction
    step: OnboardingStep | None = None


class OnboardingStateError(Exception):
    """A structurally invalid command against the stored state — maps to 422."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def initial_onboarding_state(*, now: datetime | None = None) -> dict[str, Any]:
    """The version-1 state new users (password or OAuth) are created with."""
    progress = OnboardingProgress(
        status="not_started", current_step="basics", updated_at=now or _utcnow()
    )
    return progress.model_dump(mode="json")


def merge_initial_onboarding_settings(
    settings: dict[str, Any] | None, *, now: datetime | None = None
) -> dict[str, Any]:
    """Merge the version-1 onboarding state into supplied user-creation settings.

    Preserves every other supplied key. Never overwrites an explicitly-supplied
    trusted onboarding state — a future fixture/migration may pre-seed one.
    Returns a new dict; the input is never mutated.
    """
    merged = dict(settings or {})
    if "onboarding" not in merged:
        merged["onboarding"] = initial_onboarding_state(now=now)
    return merged


def parse_onboarding_state(settings: dict[str, Any] | None) -> OnboardingProgress | None:
    """Parse ``settings.onboarding``. Absent or malformed -> ``None`` (grandfathered).

    An absent key means a pre-feature account (README §5.6) and a malformed one
    must never trap the user — both are treated identically by the transition
    function: a plain ``start`` from scratch.
    """
    raw = (settings or {}).get("onboarding")
    if raw is None:
        return None
    try:
        return OnboardingProgress.model_validate(raw)
    except Exception:
        return None


def apply_onboarding_command(
    current: OnboardingProgress | None,
    command: OnboardingCommand,
    *,
    now: datetime | None = None,
) -> OnboardingProgress:
    """Pure transition function implementing README §8's transition table."""
    now = now or _utcnow()
    if command.action == "start":
        return _apply_start(current, now)
    # advance/defer/complete all require an already-started, unfinished flow —
    # absent/not_started/deferred states must call `start` first to resume.
    if current is None or current.status not in ("in_progress", "completed"):
        raise OnboardingStateError(f"onboarding must be started before '{command.action}'")
    if current.status == "completed":
        # A completed state cannot be reset through this endpoint (README §8).
        return current
    if command.action == "advance":
        return _apply_advance(current, command.step, now)
    if command.action == "defer":
        return _apply_defer(current, now)
    return _apply_complete(current, command.step, now)


def _apply_start(current: OnboardingProgress | None, now: datetime) -> OnboardingProgress:
    if current is None:
        return OnboardingProgress(status="in_progress", current_step="basics", updated_at=now)
    if current.status in ("completed", "in_progress"):
        return current  # idempotent retry
    # not_started or deferred: (re)start at the persisted current step.
    return OnboardingProgress(
        status="in_progress", current_step=current.current_step, updated_at=now
    )


def _apply_advance(
    current: OnboardingProgress, step: OnboardingStep | None, now: datetime
) -> OnboardingProgress:
    if step is None:
        raise OnboardingStateError("advance requires a step")
    cur_idx = STEPS.index(current.current_step)
    req_idx = STEPS.index(step)
    if req_idx < cur_idx:
        return current  # already advanced past the named step: idempotent retry
    if req_idx > cur_idx:
        raise OnboardingStateError("cannot advance past the current step")
    if cur_idx == len(STEPS) - 1:
        raise OnboardingStateError("the final step completes instead of advancing")
    return current.model_copy(update={"current_step": STEPS[cur_idx + 1], "updated_at": now})


def _apply_defer(current: OnboardingProgress, now: datetime) -> OnboardingProgress:
    return current.model_copy(update={"status": "deferred", "updated_at": now})


def _apply_complete(
    current: OnboardingProgress, step: OnboardingStep | None, now: datetime
) -> OnboardingProgress:
    if step != "fit":
        raise OnboardingStateError("only the final step can complete")
    if current.current_step != "fit":
        raise OnboardingStateError("complete requires reaching the final step first")
    return current.model_copy(
        update={"status": "completed", "updated_at": now, "completed_at": now}
    )


async def update_onboarding_progress(
    pool: asyncpg.Pool, user_id: UUID, command: OnboardingCommand
) -> OnboardingProgress:
    """Apply ``command`` under a row lock and persist via a parameterized ``jsonb_set``.

    ``jsonb_set`` touches only the ``onboarding`` key, so a concurrent
    ``PATCH /v1/me`` settings write can never clobber (or be clobbered by) this
    write. Returns the normalized, stored state.
    """
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "SELECT settings FROM counselle.users WHERE id = $1 FOR UPDATE", user_id
        )
        if row is None:
            raise OnboardingStateError(f"user {user_id} not found")
        current = parse_onboarding_state(row["settings"])
        next_state = apply_onboarding_command(current, command)
        await conn.execute(
            """
            UPDATE counselle.users
            SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{onboarding}', $2, true)
            WHERE id = $1
            """,
            user_id,
            next_state.model_dump(mode="json"),
        )
    return next_state
