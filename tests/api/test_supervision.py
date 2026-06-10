"""Unit tests for api/supervision.py — the McpSupervisor probe/backoff model (D4).

The child is a fake toolset whose ``client.ping()`` follows a script of
outcomes; ``probe_once`` is exercised directly for deterministic status
transitions, and one loop test proves ``kick()`` wakes a backoff sleep.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

import pytest

from api.supervision import McpSupervisor, backoff_delay

# ---------------------------------------------------------------------------
# Fake child
# ---------------------------------------------------------------------------


class FakeClient:
    """Scripted ping outcomes: an Exception entry raises, anything else succeeds."""

    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = outcomes
        self.pings = 0
        self.closed = False

    async def ping(self) -> bool:
        self.pings += 1
        outcome = self.outcomes.pop(0) if self.outcomes else "ok"
        if isinstance(outcome, Exception):
            raise outcome
        return True

    async def close(self) -> None:
        self.closed = True


class FakeToolset:
    def __init__(self, outcomes: list[Any] | None = None) -> None:
        self.client = FakeClient(outcomes or [])
        self.enters = 0
        self.exits = 0

    async def __aenter__(self) -> FakeToolset:
        self.enters += 1
        return self

    async def __aexit__(self, *args: Any) -> None:
        self.exits += 1


async def _wait_for(condition: Callable[[], bool], timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "condition not met in time"
        await asyncio.sleep(0.005)


# ---------------------------------------------------------------------------
# Backoff arithmetic
# ---------------------------------------------------------------------------


def test_backoff_doubles_from_1s_to_30s_cap() -> None:
    assert [backoff_delay(n) for n in range(1, 8)] == [1, 2, 4, 8, 16, 30, 30]


def test_backoff_custom_base_and_cap() -> None:
    assert backoff_delay(1, base_s=0.5, cap_s=2.0) == 0.5
    assert backoff_delay(2, base_s=0.5, cap_s=2.0) == 1.0
    assert backoff_delay(4, base_s=0.5, cap_s=2.0) == 2.0


def test_backoff_rejects_zero_failures() -> None:
    with pytest.raises(ValueError):
        backoff_delay(0)


# ---------------------------------------------------------------------------
# Status transitions (probe_once is the loop's unit of work)
# ---------------------------------------------------------------------------


def test_initial_status_is_restarting_until_first_probe() -> None:
    supervisor = McpSupervisor(FakeToolset())
    assert supervisor.status()["status"] == "restarting"
    assert supervisor.status()["last_probe_at"] is None


async def test_successful_probe_reports_ok_and_balances_enter_exit() -> None:
    toolset = FakeToolset()
    supervisor = McpSupervisor(toolset)
    assert await supervisor.probe_once() == "ok"
    status = supervisor.status()
    assert status["status"] == "ok"
    assert status["consecutive_failures"] == 0
    assert status["last_error"] is None
    assert status["last_probe_at"] is not None
    assert toolset.enters == toolset.exits == 1
    assert toolset.client.pings == 1


async def test_failed_probe_reports_restarting_with_error() -> None:
    supervisor = McpSupervisor(FakeToolset([RuntimeError("child is dead")]))
    assert await supervisor.probe_once() == "restarting"
    status = supervisor.status()
    assert status["consecutive_failures"] == 1
    assert "RuntimeError" in status["last_error"]


async def test_failed_after_threshold_escalates_to_failed() -> None:
    errors: list[Any] = [RuntimeError("dead")] * 3
    supervisor = McpSupervisor(FakeToolset(errors), failed_after=3)
    assert await supervisor.probe_once() == "restarting"
    assert await supervisor.probe_once() == "restarting"
    assert await supervisor.probe_once() == "failed"
    assert supervisor.status()["consecutive_failures"] == 3


async def test_recovery_resets_failures_and_counts_a_restart() -> None:
    supervisor = McpSupervisor(FakeToolset([RuntimeError("dead"), RuntimeError("dead")]))
    await supervisor.probe_once()
    await supervisor.probe_once()
    assert await supervisor.probe_once() == "ok"  # script exhausted → success
    status = supervisor.status()
    assert status["consecutive_failures"] == 0
    assert status["last_error"] is None
    assert status["restarts"] == 1


async def test_clean_first_boot_counts_no_restart() -> None:
    supervisor = McpSupervisor(FakeToolset())
    await supervisor.probe_once()
    assert supervisor.status()["restarts"] == 0


# ---------------------------------------------------------------------------
# The supervisor loop: kick() wakes a backoff sleep; aclose() shuts down
# ---------------------------------------------------------------------------


async def test_loop_recovers_on_kick_and_aclose_closes_client() -> None:
    toolset = FakeToolset([RuntimeError("dead child")])  # fail once, then heal
    supervisor = McpSupervisor(
        toolset, probe_interval_s=60.0, backoff_base_s=60.0, backoff_cap_s=60.0
    )
    supervisor.start()
    # Wait for the FIRST probe to have run (initial status is already "restarting",
    # so gate on pings — a kick before the loop's first iteration would be cleared).
    await _wait_for(
        lambda: toolset.client.pings == 1 and supervisor.status()["status"] == "restarting"
    )
    supervisor.kick()  # the reactive path: wake the prober instead of waiting out backoff
    await _wait_for(lambda: supervisor.status()["status"] == "ok")
    assert supervisor.status()["restarts"] == 1
    await supervisor.aclose()
    assert toolset.client.closed
