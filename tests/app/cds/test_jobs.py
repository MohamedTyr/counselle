"""N-01 regression pin: the worker poll loop must survive a transient error
from `claim_next_extraction`, not die silently and stop claiming work forever
until someone restarts the process.

Also checks the semaphore-leak constraint the audit calls out: the error path
must release the permit it acquired exactly once, or repeated failures would
eventually deadlock the poller on `acquire()` -- just as dead as the original
bug, but harder to diagnose.
"""

from __future__ import annotations

import asyncio
import contextlib
from types import SimpleNamespace

import pytest

from adapters import cds_store
from app.cds.jobs import Poller


class _FakePool:
    pass


async def test_loop_survives_a_transient_claim_error_and_keeps_polling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        cds_worker_concurrency=3,
        cds_worker_poll_seconds=0,
        cds_extraction_lease_seconds=60,
    )
    poller = Poller(_FakePool(), settings)

    call_count = 0
    polled_again = asyncio.Event()

    async def fake_sweep(pool: object) -> list[object]:
        return []

    async def fake_claim(pool: object, *, lease_seconds: int) -> None:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("transient DB blip")
        polled_again.set()
        return None

    monkeypatch.setattr(cds_store, "sweep_expired_leases", fake_sweep)
    monkeypatch.setattr(cds_store, "claim_next_extraction", fake_claim)

    task = asyncio.create_task(poller._loop())
    try:
        await asyncio.wait_for(polled_again.wait(), timeout=1)
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    # The loop kept calling claim_next_extraction after the first raised --
    # a dead loop would have stopped forever at call_count == 1.
    assert call_count >= 2
    # No leaked permit: the error path released the one it acquired, so full
    # concurrency is still available (asyncio.Semaphore has no public
    # introspection beyond this counter).
    assert poller._semaphore._value == settings.cds_worker_concurrency
