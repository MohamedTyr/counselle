"""The DB-leased job runner for the facts crawl pass (plan §4.2/§4.3,
appendix J-iii, Unit E).

Copies `app/cds/jobs.py`'s shape (boot sweep, transient-error survival, the
background lease-renewal keeper, `start_*_worker`'s no-op-when-unconfigured
contract) with **two deliberate divergences**, per this unit's brief:

1. **No semaphore.** `facts_jobs_one_live_pass_idx` (a partial unique index
   on `status IN ('queued','running')`) already guarantees at most one live
   pass; a concurrency knob here would be an unreachable setting. The
   poller holds at most one task.
2. **The sweep re-queues, not fails forward.** `adapters.cds_store.
   sweep_expired_leases` stamps an abandoned row `failed`;
   `adapters.facts_jobs_store.sweep_expired_leases` re-queues it (`status=
   'queued'`) so the next claim resumes the same `crawl_runs` row instead
   of restarting the pass (plan §4.2).

This module does **not** import `app.cds.jobs` or `adapters.cds_store` —
those are parked (ADR 0037/D8).
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import asyncpg
import structlog

from adapters import facts_jobs_store
from app.facts.crawl import run_crawl_pass, run_remap_pass

logger = structlog.get_logger(__name__)

# Renew a lease well before it expires — a third of the lease window, so a
# single slow renewal round-trip never risks losing the claim (mirrors
# app/cds/jobs.py's _LEASE_RENEWAL_FRACTION).
_LEASE_RENEWAL_FRACTION = 3


class Poller:
    """One instance per process. Owns the poll loop and the single
    in-flight run's supervising tasks (the run itself plus its
    lease-renewal keeper) — never more than one, by construction (no
    semaphore, divergence 1 above)."""

    def __init__(self, pool: asyncpg.Pool, settings: Any) -> None:
        self._pool = pool
        self._settings = settings
        self._running_task: asyncio.Task[None] | None = None
        self._loop_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Sweep whatever the previous process abandoned, then start
        polling for new work."""
        swept = await facts_jobs_store.sweep_expired_leases(self._pool)
        if swept:
            logger.warning("facts_worker_boot_swept_stale_leases", job_ids=swept)
        self._loop_task = asyncio.create_task(self._loop(), name="facts-worker-poller")
        self._loop_task.add_done_callback(self._on_loop_done)

    async def stop(self) -> None:
        """Cancel the poll loop and let an in-flight run finish naturally —
        `crawl.run_crawl_pass`/`run_remap_pass` always finalize the job row
        they hold (success, partial, or aborted), so an orderly shutdown
        never leaves a `running` row for the next boot's sweep to clean up."""
        if self._loop_task is not None:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
        if self._running_task is not None:
            await asyncio.gather(self._running_task, return_exceptions=True)

    async def _loop(self) -> None:
        """Survives transient errors — a DB blip must never silently stop
        new passes from ever being claimed again."""
        while True:
            try:
                await facts_jobs_store.sweep_expired_leases(self._pool)
                await facts_jobs_store.enqueue_daily_pass(
                    self._pool, interval_hours=self._settings.facts_crawl_interval_hours
                )
            except Exception:
                logger.exception("facts_worker_sweep_or_enqueue_failed")
                await asyncio.sleep(self._settings.facts_worker_poll_seconds)
                continue
            try:
                claimed = await facts_jobs_store.claim_next_job(
                    self._pool, lease_seconds=self._settings.facts_crawl_lease_seconds
                )
            except Exception:
                logger.exception("facts_worker_claim_failed")
                await asyncio.sleep(self._settings.facts_worker_poll_seconds)
                continue
            if claimed is None:
                await asyncio.sleep(self._settings.facts_worker_poll_seconds)
                continue
            self._running_task = asyncio.create_task(
                self._run_claimed(claimed), name=f"facts-run-{claimed.id}"
            )
            await self._running_task
            self._running_task = None

    def _on_loop_done(self, task: asyncio.Task[None]) -> None:
        """The poll loop is meant to run forever. If it ever exits
        un-cancelled, that's a bug that must be loud, not the silent "no
        pass is ever claimed again until someone restarts the process"
        failure this whole design exists to prevent."""
        if not task.cancelled() and task.exception() is not None:
            logger.error("facts_worker_poll_loop_crashed", error=str(task.exception()))

    async def _run_claimed(self, job: facts_jobs_store.FactsJobRecord) -> None:
        lease_lost = asyncio.Event()
        keeper = asyncio.create_task(self._renew_lease(job.id, lease_lost))
        assert job.started_at is not None, "a claimed job always has started_at set"
        try:
            if job.kind == "remap":
                await run_remap_pass(
                    self._pool, self._settings, job_id=job.id, claimed_started_at=job.started_at
                )
            else:
                await run_crawl_pass(
                    self._pool, self._settings, job_id=job.id, claimed_started_at=job.started_at
                )
        except Exception as exc:
            # The outer hole (plan §4.2/Finding 1): `run_crawl_pass`/
            # `run_remap_pass` finalize their own job/run rows on every path
            # they know about, but a genuinely unexpected exception here
            # must still not leave `facts_jobs` (and any open `crawl_runs`
            # row) stuck `running` forever -- that would silently stop this
            # job from ever being resumed or re-enqueued.
            logger.exception("facts_worker_run_crashed", job_id=job.id)
            try:
                await facts_jobs_store.mark_job_crashed(
                    self._pool,
                    job_id=job.id,
                    claimed_started_at=job.started_at,
                    error_code="worker_crashed",
                    error_message=str(exc),
                )
            except Exception:
                logger.exception("facts_worker_crash_cleanup_failed", job_id=job.id)
        finally:
            keeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await keeper

    async def _renew_lease(self, job_id: int, lease_lost: asyncio.Event) -> None:
        """Background lease renewal: pushes the lease forward every
        `lease_seconds / 3`. On `LeaseLostError` (the row is no longer
        `running` under this worker — lost to a sweep, or fenced out by
        another process), sets `lease_lost` — `run_crawl_pass` does not
        currently poll this event mid-pass (its own advisory lock is the
        real double guard against a second worker's writes, plan §3.4), so
        this is a liveness signal for future use and for the log line, not
        a hard stop today."""
        interval = max(1, self._settings.facts_crawl_lease_seconds // _LEASE_RENEWAL_FRACTION)
        while True:
            await asyncio.sleep(interval)
            try:
                async with self._pool.acquire() as conn:
                    await facts_jobs_store.renew_job_lease(
                        conn, job_id=job_id, lease_seconds=self._settings.facts_crawl_lease_seconds
                    )
            except facts_jobs_store.LeaseLostError:
                logger.warning("facts_worker_lease_lost", job_id=job_id)
                lease_lost.set()
                return
            except Exception:
                logger.exception("facts_worker_lease_renewal_failed", job_id=job_id)


async def start_facts_worker(runtime: Any, settings: Any) -> Poller | None:
    """Wired from the FastAPI lifespan (replaces `start_cds_worker`).
    Returns `None` (no-op) when the pipeline pool isn't configured or the
    kill switch is off — the app must boot fine either way."""
    if runtime.pipeline_pool is None:
        logger.info("facts_worker_not_started", reason="no_pipeline_pool")
        return None
    if not settings.facts_worker_enabled:
        logger.info("facts_worker_not_started", reason="facts_worker_enabled_false")
        return None
    poller = Poller(runtime.pipeline_pool, settings)
    await poller.start()
    return poller


__all__ = ["Poller", "start_facts_worker"]
