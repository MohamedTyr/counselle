"""Hermetic lifecycle tests for the facts worker.

These tests exercise the worker's public lifecycle seams with fakes: a
transient claim cannot kill the poll loop, an unexpected pass error is fenced
and cleaned up, and the worker remains optional at application boot.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, Literal
from unittest.mock import AsyncMock

import pytest

from adapters import facts_jobs_store
from app.facts import jobs


def _settings(**overrides: object) -> SimpleNamespace:
    values: dict[str, Any] = {
        "facts_crawl_lease_seconds": 60,
        "facts_worker_poll_seconds": 0,
        "facts_worker_enabled": True,
        "facts_crawl_interval_hours": 24,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class _Acquire:
    def __init__(self, conn: object) -> None:
        self.conn = conn

    async def __aenter__(self) -> object:
        return self.conn

    async def __aexit__(self, *_args: object) -> bool:
        return False


class _Pool:
    def __init__(self, conn: object = None) -> None:
        self.acquire_calls = 0
        self.conn = conn

    def acquire(self) -> _Acquire:
        self.acquire_calls += 1
        return _Acquire(self.conn)


def _job(kind: Literal["crawl_pass", "remap"] = "crawl_pass") -> facts_jobs_store.FactsJobRecord:
    started = datetime(2026, 1, 1, tzinfo=UTC)
    return facts_jobs_store.FactsJobRecord(7, kind, "running", started, started, started)


@pytest.mark.asyncio
async def test_start_sweeps_before_polling_and_stop_cancels_poll_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    poll_started = asyncio.Event()
    swept = AsyncMock(return_value=[3])

    async def fake_loop(self: jobs.Poller) -> None:
        poll_started.set()
        await asyncio.Future()

    monkeypatch.setattr(facts_jobs_store, "sweep_expired_leases", swept)
    monkeypatch.setattr(jobs.Poller, "_loop", fake_loop)
    poller = jobs.Poller(_Pool(), _settings())

    await poller.start()
    await asyncio.wait_for(poll_started.wait(), timeout=1)
    swept.assert_awaited_once()
    await poller.stop()
    assert poller._loop_task is not None and poller._loop_task.cancelled()


@pytest.mark.asyncio
async def test_run_claimed_routes_remap_and_cleans_up_keeper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remap_started = asyncio.Event()
    remap_release = asyncio.Event()
    renew_cancelled = asyncio.Event()
    renew_started = asyncio.Event()

    async def remap(*_args: object, **_kwargs: object) -> None:
        remap_started.set()
        await remap_release.wait()

    async def fake_renew(_poller: jobs.Poller, job_id: int, lease_lost: asyncio.Event) -> None:
        assert job_id == 7
        renew_started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            renew_cancelled.set()
            raise

    monkeypatch.setattr(jobs, "run_remap_pass", remap)
    monkeypatch.setattr(jobs.Poller, "_renew_lease", fake_renew)
    poller = jobs.Poller(_Pool(), _settings())
    task = asyncio.create_task(poller._run_claimed(_job("remap")))
    await asyncio.wait_for(remap_started.wait(), timeout=1)
    await asyncio.wait_for(renew_started.wait(), timeout=1)
    remap_release.set()
    await task

    assert renew_cancelled.is_set()


@pytest.mark.asyncio
async def test_run_claimed_marks_unexpected_pass_failure_as_crashed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = RuntimeError("network broke")
    crashed = AsyncMock()

    async def fail(*_args: object, **_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(jobs, "run_crawl_pass", fail)
    monkeypatch.setattr(facts_jobs_store, "mark_job_crashed", crashed)
    poller = jobs.Poller(_Pool(), _settings())
    await poller._run_claimed(_job())

    crashed.assert_awaited_once_with(
        poller._pool,
        job_id=7,
        claimed_started_at=datetime(2026, 1, 1, tzinfo=UTC),
        error_code="worker_crashed",
        error_message="network broke",
    )


@pytest.mark.asyncio
async def test_renew_lease_stops_and_signals_when_claim_is_lost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = object()
    pool = _Pool(conn)
    renew = AsyncMock(side_effect=facts_jobs_store.LeaseLostError("gone"))
    monkeypatch.setattr(facts_jobs_store, "renew_job_lease", renew)

    async def no_wait(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", no_wait)
    lost = asyncio.Event()
    await jobs.Poller(pool, _settings())._renew_lease(7, lost)

    assert lost.is_set()
    renew.assert_awaited_once_with(conn, job_id=7, lease_seconds=60)


@pytest.mark.asyncio
async def test_start_facts_worker_is_noop_without_pool_or_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = SimpleNamespace(pipeline_pool=None)
    assert await jobs.start_facts_worker(runtime, _settings()) is None

    runtime = SimpleNamespace(pipeline_pool=object())
    assert await jobs.start_facts_worker(runtime, _settings(facts_worker_enabled=False)) is None


@pytest.mark.asyncio
async def test_start_facts_worker_starts_configured_poller(monkeypatch: pytest.MonkeyPatch) -> None:
    started = AsyncMock()

    class FakePoller:
        def __init__(self, pool: object, settings: object) -> None:
            self.pool = pool
            self.settings = settings

        start = started

    monkeypatch.setattr(jobs, "Poller", FakePoller)
    pool = object()
    poller = await jobs.start_facts_worker(SimpleNamespace(pipeline_pool=pool), _settings())

    assert isinstance(poller, FakePoller)
    started.assert_awaited_once_with()
