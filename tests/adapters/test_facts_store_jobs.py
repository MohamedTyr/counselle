"""`live_db` exit tests for `adapters/facts_store.py`'s job/lease/resume
machinery (plan §4.2/§4.3, §7 Phase 1 row):

- two pollers racing the enqueue tick produce one queued row;
- the sweep **re-queues** an expired lease rather than failing it forward
  (the one deliberate divergence from the parked CDS loop);
- `get_or_open_run` reuses the same `crawl_runs` row for a resumed job
  (a killed-and-restarted pass finishes on the *same* run row);
- `schools_pending_this_run` skips a school only once all six of its pages
  were attempted since the run started (the per-school resume-skip).

These are genuine concurrency assertions against real Postgres locking
(`FOR UPDATE SKIP LOCKED`, the partial unique index on
`facts_jobs(kind) WHERE status IN ('queued','running')`), not mocks.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from adapters import facts_jobs_store, facts_store

pytestmark = pytest.mark.live_db

_SCHOOL_ID = 156295  # Berea College


async def _wipe(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM cds_library.crawl_runs")
        await conn.execute("DELETE FROM cds_library.facts_jobs")
        await conn.execute(
            "DELETE FROM cds_library.school_pages WHERE school_id = $1", _SCHOOL_ID
        )


@pytest.fixture
async def clean_jobs(
    pipeline_pool: asyncpg.Pool, admin_pool: asyncpg.Pool
) -> AsyncIterator[asyncpg.Pool]:
    # `cds_library_app` has no DELETE grant on crawl_runs/facts_jobs/
    # school_pages (plan §3.3) -- cleanup runs as the admin role.
    await _wipe(admin_pool)
    try:
        yield pipeline_pool
    finally:
        await _wipe(admin_pool)


async def test_two_racing_enqueues_produce_one_queued_row(clean_jobs: asyncpg.Pool) -> None:
    pool = clean_jobs
    results = await asyncio.gather(
        facts_jobs_store.enqueue_daily_pass(pool, interval_hours=24),
        facts_jobs_store.enqueue_daily_pass(pool, interval_hours=24),
    )
    assert sorted(results) == [False, True]  # exactly one of the two inserted
    count = await pool.fetchval(
        "SELECT count(*) FROM cds_library.facts_jobs WHERE kind = 'crawl_pass'"
    )
    assert count == 1


async def test_enqueue_now_is_false_while_a_job_is_already_queued(
    clean_jobs: asyncpg.Pool,
) -> None:
    pool = clean_jobs
    first = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    second = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert first is True
    assert second is False  # "already running" -- the CLI's contract


async def test_claim_marks_running_and_a_second_claim_finds_nothing(
    clean_jobs: asyncpg.Pool,
) -> None:
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    assert job.status == "running"
    second_claim = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert second_claim is None


async def test_sweep_requeues_an_expired_lease_instead_of_failing_it(
    clean_jobs: asyncpg.Pool,
) -> None:
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    async with pool.acquire() as conn:
        # Simulate an abandoned lease (the previous worker died mid-pass).
        await conn.execute(
            "UPDATE cds_library.facts_jobs SET lease_expires_at = $2 WHERE id = $1",
            job.id,
            datetime.now(UTC) - timedelta(seconds=1),
        )
    swept = await facts_jobs_store.sweep_expired_leases(pool)
    assert job.id in swept
    row = await pool.fetchrow(
        "SELECT status, started_at, lease_expires_at FROM cds_library.facts_jobs WHERE id = $1",
        job.id,
    )
    assert row["status"] == "queued"  # re-queued, never 'failed'
    assert row["started_at"] is None
    assert row["lease_expires_at"] is None


async def test_get_or_open_run_reuses_the_same_run_for_a_resumed_job(
    clean_jobs: asyncpg.Pool,
) -> None:
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    async with pool.acquire() as conn:
        first_run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)
        second_run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)
    assert first_run.id == second_run.id  # same row, not a second crawl_runs insert
    count = await pool.fetchval(
        "SELECT count(*) FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert count == 1


async def test_schools_pending_this_run_skips_only_fully_attempted_schools(
    clean_jobs: asyncpg.Pool,
) -> None:
    pool = clean_jobs
    run_started_at = datetime.now(UTC)
    pending_before = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert any(school_id == _SCHOOL_ID for school_id, _slug in pending_before)

    # Attempt only 5 of 6 tabs after run_started_at -- still pending.
    async with pool.acquire() as conn, conn.transaction():
        for tab in ("overview", "admission", "money-matters", "academics", "campus-life"):
            await facts_store.record_page_unchanged(conn, school_id=_SCHOOL_ID, tab=tab)
    still_pending = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert any(school_id == _SCHOOL_ID for school_id, _slug in still_pending)

    # The sixth tab completes the school -- now skipped on resume.
    async with pool.acquire() as conn, conn.transaction():
        await facts_store.record_page_unchanged(conn, school_id=_SCHOOL_ID, tab="students")
    resumed_pending = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert not any(school_id == _SCHOOL_ID for school_id, _slug in resumed_pending)


async def test_complete_job_guards_by_claim_not_a_bare_running_status(
    clean_jobs: asyncpg.Pool,
) -> None:
    """Finding 3's contended path: the sweep re-queues a job whose original
    worker is still alive; a newcomer re-claims it (a fresh `started_at`).
    The ORIGINAL's now-stale claim must not be able to stamp a status onto
    the newcomer's active claim -- `complete_job`'s guard must match the
    specific claim (`started_at`), not a bare `status='running'`. The
    newcomer's own claim can still legitimately complete the job."""
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    original = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert original is not None and original.started_at is not None

    # Simulate the sweep re-queuing this job (its lease genuinely expired)
    # while the original worker is still alive and unaware, then a
    # newcomer re-claiming it.
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE cds_library.facts_jobs "
            "SET status = 'queued', started_at = NULL, lease_expires_at = NULL "
            "WHERE id = $1",
            original.id,
        )
    newcomer = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert newcomer is not None and newcomer.started_at is not None
    assert newcomer.id == original.id  # same job row, a different claim
    assert newcomer.started_at != original.started_at

    # The ORIGINAL's stale completion must not touch the newcomer's claim.
    async with pool.acquire() as conn:
        await facts_jobs_store.complete_job(
            conn, job_id=original.id, claimed_started_at=original.started_at, status="done"
        )
    row = await pool.fetchrow(
        "SELECT status, started_at FROM cds_library.facts_jobs WHERE id = $1", original.id
    )
    assert row["status"] == "running"  # untouched by the stale completion
    assert row["started_at"] == newcomer.started_at

    # The newcomer's own claim can still legitimately complete the job.
    async with pool.acquire() as conn:
        await facts_jobs_store.complete_job(
            conn,
            job_id=newcomer.id,
            claimed_started_at=newcomer.started_at,
            status="error",
            error_code="pass_already_running",
        )
    final_row = await pool.fetchrow(
        "SELECT status, error_code FROM cds_library.facts_jobs WHERE id = $1", original.id
    )
    assert final_row["status"] == "error"
    assert final_row["error_code"] == "pass_already_running"


async def test_mark_job_crashed_closes_the_open_run_and_completes_the_job(
    clean_jobs: asyncpg.Pool,
) -> None:
    """Finding 1's outer hole: an exception that escapes `run_crawl_pass`/
    `run_remap_pass` before it finalizes its own rows must not leave
    `facts_jobs`/`crawl_runs` stuck `running` forever."""
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None
    async with pool.acquire() as conn:
        run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)

    await facts_jobs_store.mark_job_crashed(
        pool,
        job_id=job.id,
        claimed_started_at=job.started_at,
        error_code="worker_crashed",
        error_message="boom",
    )

    job_row = await pool.fetchrow(
        "SELECT status, error_code FROM cds_library.facts_jobs WHERE id = $1", job.id
    )
    assert job_row is not None
    assert job_row["status"] == "error"
    assert job_row["error_code"] == "worker_crashed"
    run_row = await pool.fetchrow(
        "SELECT status FROM cds_library.crawl_runs WHERE id = $1", run.id
    )
    assert run_row is not None
    assert run_row["status"] == "failed"


async def test_mark_job_crashed_leaves_a_reclaimed_job_untouched(
    clean_jobs: asyncpg.Pool,
) -> None:
    """The same claim guard applies to the crash-cleanup path: a worker
    whose claim was superseded must not stomp the newcomer's live claim."""
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    original = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert original is not None and original.started_at is not None
    async with pool.acquire() as conn:
        await facts_jobs_store.get_or_open_run(conn, job_id=original.id)

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE cds_library.facts_jobs "
            "SET status = 'queued', started_at = NULL, lease_expires_at = NULL "
            "WHERE id = $1",
            original.id,
        )
    newcomer = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert newcomer is not None

    await facts_jobs_store.mark_job_crashed(
        pool,
        job_id=original.id,
        claimed_started_at=original.started_at,
        error_code="worker_crashed",
        error_message="boom",
    )
    row = await pool.fetchrow(
        "SELECT status FROM cds_library.facts_jobs WHERE id = $1", original.id
    )
    assert row is not None
    assert row["status"] == "running"  # the newcomer's live claim, untouched


async def test_close_run_guards_by_status_not_a_bare_id(clean_jobs: asyncpg.Pool) -> None:
    """Finding 2 (school-data-v3 fix review): a stale worker whose lease was
    swept while its advisory-lock connection stayed alive must not be able
    to overwrite a `crawl_runs` row a newer worker already closed correctly
    -- `close_run` needs the same fencing shape `complete_job` already has,
    just keyed on `status = 'running'` (there is no per-claim `started_at`
    on `crawl_runs` the way there is on `facts_jobs`; the row's own terminal
    status is the fence)."""
    pool = clean_jobs
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    async with pool.acquire() as conn:
        run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)

    # The legitimate (newer) worker closes the run correctly.
    async with pool.acquire() as conn:
        await facts_jobs_store.close_run(conn, run_id=run.id, status="succeeded")
    row = await pool.fetchrow(
        "SELECT status FROM cds_library.crawl_runs WHERE id = $1", run.id
    )
    assert row is not None
    assert row["status"] == "succeeded"

    # A stale worker's late close_run against the same row must no-op.
    async with pool.acquire() as conn:
        await facts_jobs_store.close_run(
            conn, run_id=run.id, status="failed", error_code="worker_crashed"
        )
    row = await pool.fetchrow(
        "SELECT status, error_code FROM cds_library.crawl_runs WHERE id = $1", run.id
    )
    assert row is not None
    assert row["status"] == "succeeded"  # untouched by the stale close
    assert row["error_code"] is None
