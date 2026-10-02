"""The daily supplements sync, run inside the API process.

Every `supplements_worker_poll_seconds` the loop asks the database whether a
pass is due (see `_DUE_SQL`) and, if so, runs `run_sync` under a Postgres
advisory lock, so two API instances never sync at once. Each pass is recorded
in `counselle.supplement_sync_runs`, which is also what makes "due" survive a
restart.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import asyncpg
import structlog

from app.supplements.sync import SyncReport, run_sync
from app.workspace.changes import WorkspaceEventBus
from app.workspace.service_supplements import apply_catalog_changes

logger = structlog.get_logger(__name__)

#: Arbitrary constant naming this job's advisory lock.
_LOCK_KEY = 0x5_0F_5EED

_DUE_SQL = """
SELECT
  NOT EXISTS (
    SELECT 1 FROM counselle.supplement_sync_runs
    WHERE status = 'ok' AND started_at > now() - make_interval(hours => $1)
  )
  AND NOT EXISTS (
    SELECT 1 FROM counselle.supplement_sync_runs
    WHERE status <> 'ok' AND started_at > now() - make_interval(mins => $2)
  )
"""


class SupplementsWorker:
    def __init__(
        self, pool: asyncpg.Pool, settings: Any, event_bus: WorkspaceEventBus | None = None
    ) -> None:
        self._pool = pool
        self._settings = settings
        self._event_bus = event_bus
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="supplements-sync-worker")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_if_due()
            except asyncio.CancelledError:
                raise
            except Exception:
                # A DB blip must never stop every future day's sync.
                logger.exception("supplements_worker_tick_failed")
            await asyncio.sleep(self._settings.supplements_worker_poll_seconds)

    async def run_if_due(self) -> bool:
        """Run one pass when due and the lock is free; True when a pass ran."""
        settings = self._settings
        async with self._pool.acquire() as lock_conn:
            if not await lock_conn.fetchval("SELECT pg_try_advisory_lock($1)", _LOCK_KEY):
                return False
            try:
                due = await lock_conn.fetchval(
                    _DUE_SQL,
                    settings.supplements_sync_interval_hours,
                    settings.supplements_retry_minutes,
                )
                if not due:
                    return False
                await self._run_recorded(lock_conn)
                return True
            finally:
                await lock_conn.execute("SELECT pg_advisory_unlock($1)", _LOCK_KEY)

    async def _run_recorded(self, conn: asyncpg.Connection) -> None:
        run_id = await conn.fetchval(
            "INSERT INTO counselle.supplement_sync_runs DEFAULT VALUES RETURNING id"
        )
        try:
            report = await run_sync(self._pool, self._settings)
            essays = await apply_catalog_changes(
                self._pool, report.changed_unitids, self._event_bus
            )
            logger.info("supplements_essays_updated", essays=essays)
        except Exception as exc:
            logger.exception("supplements_sync_failed")
            await conn.execute(
                """
                UPDATE counselle.supplement_sync_runs
                SET status = 'failed', finished_at = now(), problems = $2 WHERE id = $1
                """,
                run_id,
                f"{type(exc).__name__}: {exc}"[:2000],
            )
            return
        await conn.execute(
            """
            UPDATE counselle.supplement_sync_runs
            SET status = 'ok', finished_at = now(), updated = $2, unchanged = $3, problems = $4
            WHERE id = $1
            """,
            run_id,
            len(report.updated),
            report.unchanged,
            _problems(report),
        )


def _problems(report: SyncReport) -> str | None:
    parts = [
        f"{label}: {', '.join(items)}"
        for label, items in (
            ("failed", report.failed),
            ("unmapped", report.unmapped),
            ("stale reviews", report.stale_reviews),
        )
        if items
    ]
    return "; ".join(parts) or None


async def start_supplements_worker(runtime: Any, settings: Any) -> SupplementsWorker | None:
    """Wired from the FastAPI lifespan; a no-op unless enabled."""
    if not settings.supplements_worker_enabled:
        logger.info("supplements_worker_not_started", reason="supplements_worker_enabled_false")
        return None
    worker = SupplementsWorker(runtime.app_pool, settings, runtime.deps.workspace_events)
    worker.start()
    logger.info(
        "supplements_worker_started",
        interval_hours=settings.supplements_sync_interval_hours,
        poll_seconds=settings.supplements_worker_poll_seconds,
    )
    return worker
