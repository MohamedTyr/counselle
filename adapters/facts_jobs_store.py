"""`facts_jobs`/`crawl_runs` writes: enqueue, claim, lease, sweep, close
(plan §3.1/§4.2/§4.3). Split out of `adapters/facts_store.py` to
keep both files under the 800-line house limit -- job/lease/resume
machinery is a distinct concern from the per-school page/fact writes in
`facts_store.py` proper (CLAUDE.md: "things that change together live
together; things that change for different reasons stay apart").

Uses `Runtime.pipeline_pool` — the `cds_library_app` role. Parameterized
SQL only, never f-strings, per CLAUDE.md.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import asyncpg

__all__ = [
    "CrawlRunRecord",
    "FactsJobRecord",
    "FactsStoreError",
    "LeaseLostError",
    "bump_run_counters",
    "claim_next_job",
    "close_run",
    "complete_job",
    "enqueue_daily_pass",
    "enqueue_now",
    "get_or_open_run",
    "mark_job_crashed",
    "renew_job_lease",
    "schools_pending_this_run",
    "sweep_expired_leases",
]


class FactsStoreError(Exception):
    """Base for this module's own exceptions — never a bare `Exception`."""


class LeaseLostError(FactsStoreError):
    """A fencing UPDATE matched zero rows: the job's lease already expired
    or its status changed under this worker (mirrors `cds_store`'s fencing,
    plan §4.2's resume/re-queue design)."""


# ---------------------------------------------------------------------------
# facts_jobs / crawl_runs: enqueue, claim, lease, sweep, close
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FactsJobRecord:
    id: int
    kind: Literal["crawl_pass", "remap"]
    status: str
    queued_at: datetime
    started_at: datetime | None
    lease_expires_at: datetime | None


@dataclass(frozen=True)
class CrawlRunRecord:
    id: int
    job_id: int | None
    status: str
    started_at: datetime


async def enqueue_daily_pass(pool: asyncpg.Pool, *, interval_hours: int) -> bool:
    """The idempotent daily enqueue tick (plan §4.2/appendix J-iii) — one
    parameterized statement, safe under any number of racing instances: the
    partial unique index (`facts_jobs_one_live_pass_idx`) makes a second
    concurrent INSERT a no-op, never a duplicate queued row."""
    tag = await pool.fetchval(
        """
        INSERT INTO cds_library.facts_jobs (kind, status, queued_at)
        SELECT 'crawl_pass', 'queued', now()
        WHERE NOT EXISTS (
            SELECT 1 FROM cds_library.facts_jobs
            WHERE kind = 'crawl_pass' AND status IN ('queued', 'running')
        )
        AND COALESCE(
            (SELECT max(finished_at) FROM cds_library.crawl_runs), 'epoch'
        ) < now() - make_interval(hours => $1)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        interval_hours,
    )
    return tag is not None


async def enqueue_now(pool: asyncpg.Pool, *, kind: Literal["crawl_pass", "remap"]) -> bool:
    """Enqueue one job immediately (`--once`/`remap` CLI, plan §4.2 — "a
    manual run ... goes through `facts_jobs`", overriding appendix J-iii's
    bypass variant). Returns `False` when a job of this kind is already
    queued/running — the caller reports "already running" and writes
    nothing else."""
    row_id = await pool.fetchval(
        """
        INSERT INTO cds_library.facts_jobs (kind, status, queued_at)
        SELECT $1, 'queued', now()
        WHERE NOT EXISTS (
            SELECT 1 FROM cds_library.facts_jobs WHERE kind = $1 AND status IN ('queued', 'running')
        )
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        kind,
    )
    return row_id is not None


def _job_record(row: asyncpg.Record) -> FactsJobRecord:
    return FactsJobRecord(
        id=row["id"],
        kind=row["kind"],
        status=row["status"],
        queued_at=row["queued_at"],
        started_at=row["started_at"],
        lease_expires_at=row["lease_expires_at"],
    )


async def claim_next_job(pool: asyncpg.Pool, *, lease_seconds: int) -> FactsJobRecord | None:
    """Claim the oldest queued job with `FOR UPDATE SKIP LOCKED` (mirrors
    `cds_store.claim_next_extraction`). `None` is the normal idle case."""
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            WITH claimed AS (
                SELECT id FROM cds_library.facts_jobs
                WHERE status = 'queued'
                ORDER BY queued_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE cds_library.facts_jobs j
            SET status = 'running', started_at = now(),
                lease_expires_at = now() + make_interval(secs => $1)
            FROM claimed
            WHERE j.id = claimed.id
            RETURNING j.id, j.kind, j.status, j.queued_at, j.started_at, j.lease_expires_at
            """,
            lease_seconds,
        )
    return _job_record(row) if row is not None else None


async def renew_job_lease(conn: asyncpg.Connection, *, job_id: int, lease_seconds: int) -> datetime:
    """Push a running job's lease forward. Raises `LeaseLostError` if the
    row is no longer running under this worker."""
    row = await conn.fetchrow(
        """
        UPDATE cds_library.facts_jobs
        SET lease_expires_at = now() + make_interval(secs => $2)
        WHERE id = $1 AND status = 'running'
        RETURNING lease_expires_at
        """,
        job_id,
        lease_seconds,
    )
    if row is None:
        raise LeaseLostError(f"facts_job {job_id} is no longer running; lease not renewed")
    return row["lease_expires_at"]  # type: ignore[no-any-return]


async def sweep_expired_leases(pool: asyncpg.Pool) -> list[int]:
    """Re-queue every `running` job whose lease has expired — **the one
    deliberate divergence from `cds_store.sweep_expired_leases`** (plan
    §4.2/§9 R-tool-choices): that function fails a swept row forward
    (`status='failed'`); this one re-queues it (`status='queued'`) and
    leaves its `crawl_runs` row `running` so the next claim resumes the
    pass instead of restarting it. Safe to call repeatedly/concurrently —
    a row already swept or completed matches zero rows on a later call."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            UPDATE cds_library.facts_jobs
            SET status = 'queued', started_at = NULL, lease_expires_at = NULL
            WHERE status = 'running' AND lease_expires_at < now()
            RETURNING id
            """
        )
    return [row["id"] for row in rows]


async def complete_job(
    conn: asyncpg.Connection,
    *,
    job_id: int,
    claimed_started_at: datetime,
    status: Literal["done", "error"],
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """Finish a running job. Silently a no-op if the lease was already lost
    (the sweep already re-queued it for someone else — this worker must not
    stamp a terminal status on a row it no longer owns) **or if the row was
    re-claimed by a different worker since** (`claimed_started_at` — the
    `started_at` this caller's own `claim_next_job` call returned — must
    still match the row's current `started_at`; `claim_next_job` overwrites
    that column on every (re)claim, so a stale caller's completion can never
    stamp a status onto a claim it no longer holds, plan §4.2/§9's
    "pass_already_running" contention path)."""
    await conn.execute(
        """
        UPDATE cds_library.facts_jobs
        SET status = $2, finished_at = now(), error_code = $3, error_message = $4
        WHERE id = $1 AND status = 'running' AND started_at = $5
        """,
        job_id,
        status,
        error_code,
        error_message,
        claimed_started_at,
    )


async def mark_job_crashed(
    pool: asyncpg.Pool,
    *,
    job_id: int,
    claimed_started_at: datetime,
    error_code: str,
    error_message: str,
) -> None:
    """Outer safety net for an exception that escapes `run_crawl_pass`/
    `run_remap_pass` before it could finalize its own job/run rows (plan
    §4.2's poller must never leave a `facts_jobs` row `running` forever —
    the poison-pill livelock's second half). Closes this claim's still-
    `running` `crawl_runs` row as `failed` and completes the job as
    `error`, both gated on `claimed_started_at` still matching under a row
    lock — a job already reclaimed by a newer worker (or already finalized
    by its own pass) is left untouched, never stomped."""
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "SELECT status, started_at FROM cds_library.facts_jobs WHERE id = $1 FOR UPDATE",
            job_id,
        )
        if row is None or row["status"] != "running" or row["started_at"] != claimed_started_at:
            return  # reclaimed, or already finalized by the pass itself
        run_row = await conn.fetchrow(
            "SELECT id FROM cds_library.crawl_runs WHERE job_id = $1 AND status = 'running'",
            job_id,
        )
        if run_row is not None:
            await close_run(
                conn,
                run_id=run_row["id"],
                status="failed",
                error_code=error_code,
                error_message=error_message,
            )
        await complete_job(
            conn,
            job_id=job_id,
            claimed_started_at=claimed_started_at,
            status="error",
            error_code=error_code,
            error_message=error_message,
        )


async def get_or_open_run(conn: asyncpg.Connection, *, job_id: int) -> CrawlRunRecord:
    """Reuse the `crawl_runs` row already linked to `job_id` if one is still
    `running` (a resumed pass — plan §4.2/appendix J-iii), else open a new
    one. A pass is only ever closed by the worker that finishes or aborts
    it, so a resumed pass's counters continue on the same row."""
    existing = await conn.fetchrow(
        """
        SELECT id, job_id, status, started_at FROM cds_library.crawl_runs
        WHERE job_id = $1 AND status = 'running'
        """,
        job_id,
    )
    if existing is not None:
        return CrawlRunRecord(**dict(existing))
    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.crawl_runs (job_id, status, started_at)
        VALUES ($1, 'running', now())
        RETURNING id, job_id, status, started_at
        """,
        job_id,
    )
    assert row is not None
    return CrawlRunRecord(**dict(row))


_RUN_COUNTER_COLUMNS = frozenset(
    {
        "pages_fetched",
        "pages_changed",
        "pages_failed",
        "facts_changed",
        "snapshots_pruned",
        "rate_backoffs",
        "schools_seen",
    }
)


async def bump_run_counters(conn: asyncpg.Connection, *, run_id: int, **deltas: int) -> None:
    """Additively increment `crawl_runs` counters (never overwrite) so a
    resumed pass's dashboard total reflects every worker that ever touched
    this run, not just the current process's in-memory count. Called once
    per school (plan §4.2's per-school transaction) so a mid-pass crash
    never loses already-committed schools' counts."""
    unknown = set(deltas) - _RUN_COUNTER_COLUMNS
    if unknown:
        raise FactsStoreError(f"unknown crawl_runs counter column(s): {sorted(unknown)}")
    if not deltas:
        return
    # COALESCE(column, 0): schools_seen/sitemap_slugs/crosswalk_matched/
    # crosswalk_unmatched have no column DEFAULT (unlike pages_fetched and
    # friends, which are NOT NULL DEFAULT 0) -- an additive UPDATE against
    # a NULL starting value would otherwise stay NULL forever.
    assignments = ", ".join(
        f"{column} = COALESCE({column}, 0) + ${i + 2}" for i, column in enumerate(deltas)
    )
    await conn.execute(
        f"UPDATE cds_library.crawl_runs SET {assignments} WHERE id = $1",  # nosec B608
        run_id,
        *deltas.values(),
    )


async def close_run(
    conn: asyncpg.Connection,
    *,
    run_id: int,
    status: Literal["succeeded", "partial", "failed", "aborted"],
    build_id: str | None = None,
    build_id_rotations: int = 0,
    rate_backoffs: int = 0,
    sitemap_slugs: int | None = None,
    crosswalk_matched: int | None = None,
    crosswalk_unmatched: int | None = None,
    failures_by_kind: Mapping[str, int] | None = None,
    unmapped_label_count: int = 0,
    unmapped_labels: Sequence[Mapping[str, Any]] = (),
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """Close a `crawl_runs` row (plan §4.2's end-of-pass transaction). The
    per-school-accumulated counters (`pages_fetched`, `facts_changed`, ...)
    are already on the row via `bump_run_counters`; this call sets the
    pass-level summary fields and the terminal status/finished_at.

    Fenced on `status = 'running'` — the same shape as `complete_job`'s
    `started_at` fence (Finding 2, school-data-v3 fix review): a worker
    whose lease was swept out from under it (the lease-renewal round trip
    can time out independently of the advisory-lock connection it still
    holds) must not be able to stamp a terminal status onto a run row a
    newer worker already closed correctly. Once a run leaves `running`,
    every further `close_run` call against it silently no-ops."""
    await conn.execute(
        """
        UPDATE cds_library.crawl_runs
        SET status = $2, finished_at = now(), build_id = $3,
            build_id_rotations = $4, rate_backoffs = rate_backoffs + $5,
            sitemap_slugs = $6, crosswalk_matched = $7, crosswalk_unmatched = $8,
            failures_by_kind = $9,
            unmapped_label_count = $10, unmapped_labels = $11,
            error_code = $12, error_message = $13
        WHERE id = $1 AND status = 'running'
        """,
        run_id,
        status,
        build_id,
        build_id_rotations,
        rate_backoffs,
        sitemap_slugs,
        crosswalk_matched,
        crosswalk_unmatched,
        dict(failures_by_kind or {}),
        unmapped_label_count,
        list(unmapped_labels),
        error_code,
        error_message,
    )


async def schools_pending_this_run(
    pool: asyncpg.Pool, *, run_started_at: datetime
) -> list[tuple[int, str]]:
    """`(school_id, slug)` pairs still to process in this run (appendix
    J-iii's resume query, per-school granularity per plan §4.2 finding
    that the school is the transaction unit): a school is skipped only
    when **all six** of its pages were attempted since this run started."""
    rows = await pool.fetch(
        """
        SELECT cs.school_id, cs.slug
        FROM cds_library.collegedata_schools cs
        WHERE cs.retired_at IS NULL AND cs.school_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM cds_library.school_pages sp
              WHERE sp.school_id = cs.school_id AND sp.last_attempted_at >= $1
              GROUP BY sp.school_id HAVING count(*) = 6
          )
        ORDER BY cs.school_id
        """,
        run_started_at,
    )
    return [(row["school_id"], row["slug"]) for row in rows]


