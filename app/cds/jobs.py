"""The DB-leased job runner: the async poller started from the FastAPI
lifespan, cancelled on shutdown (plan §E).

Queue state lives entirely in `cds_library.cds_extractions` -- a crashed or
restarted process is always survivable, because nothing about "what to run
next" is held in process memory. `Poller` claims the oldest queued row with
the existing `FOR UPDATE SKIP LOCKED` lease/claim machinery
(`adapters/cds_store.py`, ported from the pipeline schema, not built here),
runs it through `app/cds/engine.py`, and renews its lease in the background
until the run finishes.

Concurrency is capped by `settings.cds_worker_concurrency` (default 3, per
plan Risk 7 -- extraction shares this process with chat traffic and must
never starve it); `settings.cds_worker_enabled` is the kill switch. Every
blocking call goes through the pool (asyncpg is already async) or
`asyncio.to_thread` inside the adapters this module calls into -- nothing
here blocks the event loop itself.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from typing import Any

import asyncpg
import structlog

from adapters import cds_store
from app.cds import engine

logger = structlog.get_logger(__name__)

# Renew a lease well before it expires -- a third of the lease window, so a
# single slow renewal round-trip never risks losing the claim.
_LEASE_RENEWAL_FRACTION = 3


class Poller:
    """One instance per process. Owns the poll loop and every in-flight run's
    supervising tasks (the run itself plus its lease-renewal keeper)."""

    def __init__(self, pool: asyncpg.Pool, settings: Any) -> None:
        self._pool = pool
        self._settings = settings
        self._semaphore = asyncio.Semaphore(settings.cds_worker_concurrency)
        self._running_tasks: set[asyncio.Task[None]] = set()
        self._loop_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Sweep whatever the previous process abandoned (the crash-recovery
        mechanism -- plan §E), then start polling for new work."""
        swept = await cds_store.sweep_expired_leases(self._pool)
        if swept:
            logger.warning(
                "cds_worker_boot_swept_stale_leases",
                count=len(swept),
                extraction_ids=[str(extraction_id) for extraction_id in swept],
            )
        self._loop_task = asyncio.create_task(self._loop(), name="cds-worker-poller")
        self._loop_task.add_done_callback(self._on_loop_done)

    async def stop(self) -> None:
        """Cancel the poll loop and let every in-flight run finish naturally
        -- `engine.run_extraction` always finalizes the row it holds (success
        or failure), so an orderly shutdown never leaves a `running` row
        behind for the next boot's sweep to clean up."""
        if self._loop_task is not None:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
        in_flight = list(self._running_tasks)
        if in_flight:
            await asyncio.gather(*in_flight, return_exceptions=True)

    async def _loop(self) -> None:
        """Survives transient errors (N-01) -- a DB blip must never silently
        stop new extractions from ever being claimed again. Release is
        exactly once per `acquire()`, guaranteed by mutually exclusive paths
        rather than by reasoning: the sweep can fail before anything is
        acquired (nothing to release), the claim can fail after acquiring
        (release on that one path only), or the claim succeeds and the run
        task's own `_on_task_done` releases on completion."""
        while True:
            try:
                await cds_store.sweep_expired_leases(self._pool)
            except Exception:
                logger.exception("cds_worker_sweep_failed")
                await asyncio.sleep(self._settings.cds_worker_poll_seconds)
                continue  # nothing acquired yet -- nothing to release
            await self._semaphore.acquire()
            try:
                claimed = await cds_store.claim_next_extraction(
                    self._pool, lease_seconds=self._settings.cds_extraction_lease_seconds
                )
            except Exception:
                self._semaphore.release()  # the only release on this path
                logger.exception("cds_worker_claim_failed")
                await asyncio.sleep(self._settings.cds_worker_poll_seconds)
                continue
            if claimed is None:
                self._semaphore.release()  # unchanged
                await asyncio.sleep(self._settings.cds_worker_poll_seconds)
                continue
            task = asyncio.create_task(self._run_claimed(claimed), name=f"cds-run-{claimed.id}")
            self._running_tasks.add(task)
            task.add_done_callback(self._on_task_done)  # releases on the success path

    def _on_task_done(self, task: asyncio.Task[None]) -> None:
        self._running_tasks.discard(task)
        self._semaphore.release()
        if not task.cancelled() and task.exception() is not None:
            logger.error("cds_worker_task_crashed", error=str(task.exception()))

    def _on_loop_done(self, task: asyncio.Task[None]) -> None:
        """The poll loop is now supposed to run forever, surviving its own
        errors (N-01). If it ever exits un-cancelled anyway, that's a bug
        that must be loud, not the silent "no extraction is ever claimed
        again until someone restarts the process" failure this whole fix
        exists to prevent."""
        if not task.cancelled() and task.exception() is not None:
            logger.error("cds_worker_poll_loop_crashed", error=str(task.exception()))

    async def _run_claimed(self, extraction: cds_store.ExtractionRecord) -> None:
        lease_lost = asyncio.Event()
        keeper = asyncio.create_task(self._renew_lease(extraction.id, lease_lost))
        try:
            await engine.run_extraction(
                self._pool, self._settings, extraction, lease_lost=lease_lost
            )
        finally:
            keeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await keeper
            # If the keeper failed for any other reason, log it here rather
            # than letting it propagate out of `finally` and replace
            # `run_extraction`'s own exception (N-02) -- suppressed, but
            # never silently.
            if not keeper.cancelled() and keeper.exception() is not None:
                logger.error(
                    "cds_worker_lease_keeper_failed",
                    extraction_id=str(extraction.id),
                    error=str(keeper.exception()),
                )

    async def _renew_lease(self, extraction_id: uuid.UUID, lease_lost: asyncio.Event) -> None:
        """Background lease renewal (plan §E): pushes the lease forward every
        `lease_seconds / 3`. On `LeaseLostError` (the row is no longer
        `running` under this worker -- lost to a sweep, or fenced out by
        another process), sets `lease_lost` so `engine.run_extraction` stops
        making further model calls instead of racing a lease it no longer
        holds."""
        interval = max(1, self._settings.cds_extraction_lease_seconds // _LEASE_RENEWAL_FRACTION)
        while True:
            await asyncio.sleep(interval)
            try:
                async with self._pool.acquire() as conn:
                    await cds_store.renew_lease(
                        conn,
                        extraction_id=extraction_id,
                        lease_seconds=self._settings.cds_extraction_lease_seconds,
                    )
            except cds_store.LeaseLostError:
                logger.warning("cds_worker_lease_lost", extraction_id=str(extraction_id))
                lease_lost.set()
                return
            except Exception:
                # A transient failure (pool-acquire timeout, connection
                # reset) is survivable -- the renewal interval is a third of
                # the lease window precisely to tolerate one (N-02). Only
                # `LeaseLostError` above means the row is genuinely gone;
                # everything else just tries again next interval.
                logger.exception(
                    "cds_worker_lease_renewal_failed", extraction_id=str(extraction_id)
                )


async def start_cds_worker(runtime: Any, settings: Any) -> Poller | None:
    """Wired from the FastAPI lifespan. Returns `None` (no-op) when the
    pipeline pool isn't configured or the kill switch is off -- the app must
    boot fine either way, mirroring `cds_data_enabled`'s `EmptyCatalog` path
    (plan §C3)."""
    if runtime.pipeline_pool is None:
        logger.info("cds_worker_not_started", reason="no_pipeline_pool")
        return None
    if not settings.cds_worker_enabled:
        logger.info("cds_worker_not_started", reason="cds_worker_enabled_false")
        return None
    poller = Poller(runtime.pipeline_pool, settings)
    await poller.start()
    return poller


__all__ = ["Poller", "start_cds_worker"]
