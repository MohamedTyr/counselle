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

Job/run cleanup tracks the exact `facts_jobs.id`(s) each test creates and
deletes only those rows (+ their `crawl_runs`) -- never a blanket
`DELETE FROM crawl_runs`/`facts_jobs` with no WHERE clause. That was safe
only while those tables held no real history; a completed crawl (and any
concurrently running `remap` pass) now leaves real rows in both, and a
blanket delete during a full-suite run has been observed to destroy a real
`facts_jobs`/`crawl_runs` row belonging to another process. See
`tests/adapters/test_crawl_poison_pill.py`, which established this pattern
first for the same reason.

`schools_pending_this_run` is exercised against a permanently reserved,
entirely test-owned synthetic school id (never a real IPEDS unitid -- those
are always positive) rather than a real school: the previous fixture
hardcoded Berea College (`school_id=156295`), which a full 2,587-school
crawl (and a later crosswalk retirement of that row) invalidated -- it is no
longer an unattempted, non-retired `collegedata_schools` row, so it silently
stopped appearing in `schools_pending_this_run`'s output at all.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from adapters import facts_jobs_store, facts_store

pytestmark = pytest.mark.live_db

# A permanently reserved, entirely test-owned school id -- never a real
# IPEDS unitid (those are always positive), so it can never collide with
# crosswalk-matched crawl data no matter how much of the real crawl has
# run. Distinct from test_crawl_poison_pill.py's -900001/-900002.
_TEST_SCHOOL: tuple[int, str] = (-900003, "zz-facts-jobs-test-school")


async def _wipe_test_school(pool: asyncpg.Pool, school: tuple[int, str]) -> None:
    school_id, _slug = school
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "DELETE FROM cds_library.school_facts WHERE school_id = $1", school_id
        )
        await conn.execute(
            "DELETE FROM cds_library.school_explore_rows WHERE school_id = $1", school_id
        )
        await conn.execute(
            "DELETE FROM cds_library.school_pages WHERE school_id = $1", school_id
        )
        await conn.execute(
            "DELETE FROM cds_library.page_snapshots WHERE school_id = $1", school_id
        )
        await conn.execute(
            "DELETE FROM cds_library.collegedata_schools WHERE school_id = $1", school_id
        )
        await conn.execute("DELETE FROM cds_library.schools WHERE id = $1", school_id)


async def _insert_test_school(pool: asyncpg.Pool, school: tuple[int, str]) -> None:
    """Minimal identity profile -- this test only exercises `school_pages`/
    `schools_pending_this_run` resume-skip logic, not the IPEDS explore
    projection, so `basic_profile` carries only `id`/`name` (same shape
    `test_crawl_poison_pill.py` uses, verified against the
    `schools_projection_matches` trigger there)."""
    school_id, slug = school
    name = f"Facts-Jobs Test Fixture School {school_id}"
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO cds_library.schools
                (id, name, search_name, basic_profile, profile_provenance,
                 profile_version, profile_snapshot_date, profile_sha256)
            VALUES (
                $1::integer, $2::text,
                lower(trim(regexp_replace($2::text, '[[:space:]]+', ' ', 'g'))),
                jsonb_build_object('id', $1::integer, 'name', $2::text), '{}'::jsonb,
                'test-fixture', CURRENT_DATE, decode(repeat('00', 32), 'hex')
            )
            """,
            school_id,
            name,
        )
        await conn.execute(
            """
            INSERT INTO cds_library.collegedata_schools
                (slug, school_id, match_method, matched_at)
            VALUES ($1, $2, 'manual', now())
            """,
            slug,
            school_id,
        )


@pytest.fixture
async def test_school(admin_pool: asyncpg.Pool) -> AsyncIterator[tuple[int, str]]:
    # Pre-clean first: idempotent against residue left by a previous test
    # run that crashed before its own teardown ran.
    await _wipe_test_school(admin_pool, _TEST_SCHOOL)
    await _insert_test_school(admin_pool, _TEST_SCHOOL)
    try:
        yield _TEST_SCHOOL
    finally:
        await _wipe_test_school(admin_pool, _TEST_SCHOOL)


@pytest.fixture
async def crawl_job_cleanup(admin_pool: asyncpg.Pool) -> AsyncIterator[Callable[[int], None]]:
    """Tracks the exact `facts_jobs.id`(s) a test creates so teardown can
    delete precisely those rows (and their `crawl_runs`) -- never a blanket
    wipe of these two tables, which also hold real crawl/remap job history
    from other processes. Mirrors `test_crawl_poison_pill.py`'s fixture of
    the same name and shape."""
    created: list[int] = []
    try:
        yield created.append
    finally:
        if created:
            async with admin_pool.acquire() as conn, conn.transaction():
                await conn.execute(
                    "DELETE FROM cds_library.crawl_runs WHERE job_id = ANY($1::int[])", created
                )
                await conn.execute(
                    "DELETE FROM cds_library.facts_jobs WHERE id = ANY($1::int[])", created
                )


async def _ensure_no_live_crawl_pass_job(pool: asyncpg.Pool) -> None:
    """These tests need a genuinely empty `facts_jobs(kind='crawl_pass')`
    slot (the partial unique index `facts_jobs_one_live_pass_idx` allows at
    most one 'queued'/'running' row per kind) to prove their own enqueue/
    claim behavior. Fail loudly and clearly up front if a real crawl pass --
    or a stale job leaked by a crashed previous test run -- already occupies
    it, instead of a confusing downstream assertion failure."""
    row_id = await pool.fetchval(
        "SELECT id FROM cds_library.facts_jobs "
        "WHERE kind = 'crawl_pass' AND status IN ('queued', 'running')"
    )
    if row_id is not None:
        pytest.fail(
            f"a 'crawl_pass' job (id={row_id}) is already queued/running -- a real "
            "crawl pass or a stale job from a crashed previous test run is occupying "
            "the single-live-job slot (facts_jobs_one_live_pass_idx) -- rerun this "
            "test once it clears",
            pytrace=False,
        )


async def test_two_racing_enqueues_produce_one_queued_row(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    results = await asyncio.gather(
        facts_jobs_store.enqueue_daily_pass(pool, interval_hours=24),
        facts_jobs_store.enqueue_daily_pass(pool, interval_hours=24),
    )
    assert sorted(results) == [False, True]  # exactly one of the two inserted
    job_id = await pool.fetchval(
        "SELECT id FROM cds_library.facts_jobs "
        "WHERE kind = 'crawl_pass' AND status IN ('queued', 'running')"
    )
    assert job_id is not None  # the one that won the race
    crawl_job_cleanup(job_id)


async def test_enqueue_now_is_false_while_a_job_is_already_queued(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    first = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert first is True
    job_id = await pool.fetchval(
        "SELECT id FROM cds_library.facts_jobs WHERE kind = 'crawl_pass' AND status = 'queued'"
    )
    assert job_id is not None
    crawl_job_cleanup(job_id)
    second = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert second is False  # "already running" -- the CLI's contract


async def test_claim_marks_running_and_a_second_claim_finds_nothing(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    crawl_job_cleanup(job.id)
    assert job.status == "running"
    second_claim = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert second_claim is None


async def test_sweep_requeues_an_expired_lease_instead_of_failing_it(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    crawl_job_cleanup(job.id)
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
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    crawl_job_cleanup(job.id)
    async with pool.acquire() as conn:
        first_run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)
        second_run = await facts_jobs_store.get_or_open_run(conn, job_id=job.id)
    assert first_run.id == second_run.id  # same row, not a second crawl_runs insert
    count = await pool.fetchval(
        "SELECT count(*) FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert count == 1


async def test_schools_pending_this_run_skips_only_fully_attempted_schools(
    pipeline_pool: asyncpg.Pool, test_school: tuple[int, str]
) -> None:
    pool = pipeline_pool
    school_id, _slug = test_school
    run_started_at = datetime.now(UTC)
    pending_before = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert any(sid == school_id for sid, _slug in pending_before)

    # Attempt only 5 of 6 tabs after run_started_at -- still pending.
    async with pool.acquire() as conn, conn.transaction():
        for tab in ("overview", "admission", "money-matters", "academics", "campus-life"):
            await facts_store.record_page_unchanged(conn, school_id=school_id, tab=tab)
    still_pending = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert any(sid == school_id for sid, _slug in still_pending)

    # The sixth tab completes the school -- now skipped on resume.
    async with pool.acquire() as conn, conn.transaction():
        await facts_store.record_page_unchanged(conn, school_id=school_id, tab="students")
    resumed_pending = await facts_jobs_store.schools_pending_this_run(
        pool, run_started_at=run_started_at
    )
    assert not any(sid == school_id for sid, _slug in resumed_pending)


async def test_complete_job_guards_by_claim_not_a_bare_running_status(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    """Finding 3's contended path: the sweep re-queues a job whose original
    worker is still alive; a newcomer re-claims it (a fresh `started_at`).
    The ORIGINAL's now-stale claim must not be able to stamp a status onto
    the newcomer's active claim -- `complete_job`'s guard must match the
    specific claim (`started_at`), not a bare `status='running'`. The
    newcomer's own claim can still legitimately complete the job."""
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    original = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert original is not None and original.started_at is not None
    crawl_job_cleanup(original.id)

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
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    """Finding 1's outer hole: an exception that escapes `run_crawl_pass`/
    `run_remap_pass` before it finalizes its own rows must not leave
    `facts_jobs`/`crawl_runs` stuck `running` forever."""
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None
    crawl_job_cleanup(job.id)
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
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    """The same claim guard applies to the crash-cleanup path: a worker
    whose claim was superseded must not stomp the newcomer's live claim."""
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    original = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert original is not None and original.started_at is not None
    crawl_job_cleanup(original.id)
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


async def test_close_run_guards_by_status_not_a_bare_id(
    pipeline_pool: asyncpg.Pool,
    admin_pool: asyncpg.Pool,
    crawl_job_cleanup: Callable[[int], None],
) -> None:
    """Finding 2 (school-data-v3 fix review): a stale worker whose lease was
    swept while its advisory-lock connection stayed alive must not be able
    to overwrite a `crawl_runs` row a newer worker already closed correctly
    -- `close_run` needs the same fencing shape `complete_job` already has,
    just keyed on `status = 'running'` (there is no per-claim `started_at`
    on `crawl_runs` the way there is on `facts_jobs`; the row's own terminal
    status is the fence)."""
    await _ensure_no_live_crawl_pass_job(admin_pool)
    pool = pipeline_pool
    await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None
    crawl_job_cleanup(job.id)
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
