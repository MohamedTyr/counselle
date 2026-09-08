"""`live_db` exit tests for the two-part fix to `adapters/facts_store.py`'s
retirement machinery (school-data-v3 fix review):

- `previous_run_started_at` must never point at a `remap` (or aborted/
  crashed) `crawl_runs` row -- only a sitemap-discovering crawl pass ever
  sets `sitemap_slugs`, the discriminator this fix filters on. Before this
  fix, a `remap` run interleaved between two crawl passes silently became
  the "two consecutive passes" reference point and retired the *entire*
  live crosswalk in one pass -- this fired for real against the live
  database: all 2,587 `collegedata_schools` rows and 2,234
  `school_explore_rows` retired at one identical timestamp.
- `retire_absent_slugs` refuses (raises, writes nothing) rather than
  silently retiring an implausible fraction of the live crosswalk in one
  pass -- the defense-in-depth backstop for the same defect *class*.

Uses `tests/adapters/conftest.py`'s `pipeline_pool` (the `cds_library_app`
role these functions actually write through) / `admin_pool` (superuser,
test cleanup only -- `cds_library_app` has no DELETE grant on
`collegedata_schools`/`crawl_runs`) fixtures, following the reserved-id,
create-and-destroy-your-own-rows pattern `tests/adapters/
test_crawl_poison_pill.py` and `tests/adapters/test_facts_store_jobs.py`
established. Every fixture `collegedata_schools` row here uses
`school_id = NULL` / `match_method = 'unmatched'` -- these tests exercise
retirement bookkeeping only, never a real `schools` row, so there is
nothing to cascade into `school_explore_rows` and no FK target needed.

The ceiling-guard tests (`max_fraction`/`min_floor`) compute their
thresholds relative to the *real* live crosswalk's current size (queried
at test time) rather than hardcoding a fraction against an assumed
production row count -- the live database already holds several thousand
real `collegedata_schools` rows this session must never touch, and
`retire_absent_slugs`'s counts are global across the whole table, not
scoped to a test's own rows.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from adapters import facts_store
from adapters.facts_jobs_store import FactsStoreError

pytestmark = pytest.mark.live_db

# Permanently reserved, entirely test-owned slug prefix -- never a real
# collegedata.com slug -- distinct from every other reserved-id/slug range
# in this test package (test_crawl_poison_pill.py's -900001/-900002,
# test_facts_store_jobs.py's -900003, test_facts_store_scd2.py's -900004,
# test_facts_store_snapshots.py's -900005; this file needs no `schools`
# row at all, so it reserves a slug prefix rather than a school id range).
_SLUG_PREFIX = "zz-retirement-test-"
_ALL_TEST_SLUGS = [f"{_SLUG_PREFIX}{n}" for n in range(50)]


def _slug(n: int) -> str:
    return f"{_SLUG_PREFIX}{n}"


async def _wipe_crosswalk_rows(pool: asyncpg.Pool, slugs: Sequence[str]) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "DELETE FROM cds_library.collegedata_schools WHERE slug = ANY($1::text[])",
            list(slugs),
        )


@pytest.fixture
async def crosswalk(
    pipeline_pool: asyncpg.Pool, admin_pool: asyncpg.Pool
) -> AsyncIterator[Callable[[Sequence[tuple[str, datetime | None]]], Awaitable[None]]]:
    """Yields a function that inserts unmatched (`school_id = NULL`), live
    `collegedata_schools` rows with an explicit `last_seen_in_sitemap_at`.
    Pre-cleans idempotently against residue from a crashed previous run,
    and deletes only the slugs this fixture's caller actually created."""
    created: list[str] = []

    async def _create(rows: Sequence[tuple[str, datetime | None]]) -> None:
        async with pipeline_pool.acquire() as conn, conn.transaction():
            for slug, last_seen in rows:
                await conn.execute(
                    """
                    INSERT INTO cds_library.collegedata_schools
                        (slug, match_method, last_seen_in_sitemap_at)
                    VALUES ($1, 'unmatched', $2)
                    """,
                    slug,
                    last_seen,
                )
        created.extend(slug for slug, _last_seen in rows)

    await _wipe_crosswalk_rows(admin_pool, _ALL_TEST_SLUGS)
    try:
        yield _create
    finally:
        await _wipe_crosswalk_rows(admin_pool, created)


async def _insert_crawl_run(
    pool: asyncpg.Pool,
    *,
    started_at: datetime,
    status: str,
    sitemap_slugs: int | None,
) -> int:
    finished_at = None if status == "running" else started_at + timedelta(minutes=1)
    row = await pool.fetchrow(
        """
        INSERT INTO cds_library.crawl_runs (job_id, status, started_at, finished_at, sitemap_slugs)
        VALUES (NULL, $1, $2, $3, $4)
        RETURNING id
        """,
        status,
        started_at,
        finished_at,
        sitemap_slugs,
    )
    assert row is not None
    return row["id"]  # type: ignore[no-any-return]


@pytest.fixture
async def crawl_runs_cleanup(admin_pool: asyncpg.Pool) -> AsyncIterator[Callable[[int], None]]:
    """Tracks the exact `crawl_runs.id`(s) a test creates so teardown deletes
    precisely those rows -- never a blanket wipe (that table also holds
    real crawl/remap history from other processes)."""
    created: list[int] = []
    try:
        yield created.append
    finally:
        if created:
            async with admin_pool.acquire() as conn, conn.transaction():
                await conn.execute(
                    "DELETE FROM cds_library.crawl_runs WHERE id = ANY($1::int[])", created
                )


async def test_remap_run_is_not_the_retirement_reference_point(
    pipeline_pool: asyncpg.Pool,
    crawl_runs_cleanup: Callable[[int], None],
    crosswalk: Callable[[Sequence[tuple[str, datetime | None]]], Awaitable[None]],
) -> None:
    """The exact regression scenario from the bug report: a crawl pass (A)
    touches a slug, a `remap` pass (B) runs later and creates a
    `crawl_runs` row with no `sitemap_slugs` (it never calls
    `touch_seen_slugs`), and a third pass (C) is the one now computing its
    retirement reference point. Before the fix, B (being the most recent
    row overall) would win, and the slug -- touched during A, never
    retouched since -- would be wrongly retired.

    Deliberately dated in the past (year 2000), never the future: the real
    live `collegedata_schools` crosswalk this test runs alongside shares
    this same table, and `retire_absent_slugs`'s candidate/total counts are
    global, not scoped to this test's own rows. A *future*
    `previous_run_started_at` would make every real row -- last touched by
    the real crawl, dated well in the past relative to "now" -- look stale
    and become a retirement candidate; a past one can never match a real
    row's (much more recent) `last_seen_in_sitemap_at`, so the touched
    fixture slug below is this call's only possible candidate, and it
    isn't one either (see the assertion below) -- `retired` is empty and
    nothing is ever written, regardless of `max_fraction`/`min_floor`."""
    pool = pipeline_pool
    anchor = datetime(2000, 1, 1, tzinfo=UTC)
    crawl_a_started = anchor
    touched_during_a = anchor + timedelta(minutes=1)
    remap_b_started = anchor + timedelta(hours=1)
    current_c_started = anchor + timedelta(hours=2)

    crawl_a_id = await _insert_crawl_run(
        pool, started_at=crawl_a_started, status="succeeded", sitemap_slugs=100
    )
    crawl_runs_cleanup(crawl_a_id)
    remap_b_id = await _insert_crawl_run(
        pool, started_at=remap_b_started, status="succeeded", sitemap_slugs=None
    )
    crawl_runs_cleanup(remap_b_id)
    current_c_id = await _insert_crawl_run(
        pool, started_at=current_c_started, status="running", sitemap_slugs=None
    )
    crawl_runs_cleanup(current_c_id)

    slug = _slug(1)
    await crosswalk([(slug, touched_during_a)])

    async with pool.acquire() as conn:
        previous_started_at = await facts_store.previous_run_started_at(
            conn, exclude_run_id=current_c_id
        )
    assert previous_started_at == crawl_a_started  # not remap_b_started

    async with pool.acquire() as conn, conn.transaction():
        # Realistic ceiling values (never disabled, even here: see the
        # docstring above on why this call can never actually threaten the
        # real crosswalk) -- this is the exact production shape.
        retired = await facts_store.retire_absent_slugs(
            conn,
            previous_run_started_at=previous_started_at,
            max_fraction=0.10,
            min_floor=50,
        )
    assert retired == []  # nothing was even a candidate
    assert slug not in retired  # touched after A started -- still live, not retired

    row = await pool.fetchrow(
        "SELECT retired_at FROM cds_library.collegedata_schools WHERE slug = $1", slug
    )
    assert row is not None
    assert row["retired_at"] is None


async def test_retirement_ceiling_refuses_mass_retirement(
    pipeline_pool: asyncpg.Pool,
    crosswalk: Callable[[Sequence[tuple[str, datetime | None]]], Awaitable[None]],
) -> None:
    pool = pipeline_pool
    stale = datetime(2000, 1, 1, tzinfo=UTC)
    cutoff = datetime(2000, 1, 2, tzinfo=UTC)
    slugs = [_slug(20), _slug(21)]
    await crosswalk([(slugs[0], stale), (slugs[1], stale)])

    async with pool.acquire() as conn:
        total_live = await conn.fetchval(
            "SELECT count(*) FROM cds_library.collegedata_schools WHERE retired_at IS NULL"
        )
    # These 2 fixture rows are already included in `total_live` and are the
    # only rows in the whole table older than `cutoff` (a year-2000 cutoff
    # cannot match any real row's last_seen_in_sitemap_at). Set
    # max_fraction to half the real fraction this would retire -- the
    # guard engages no matter how large the real crosswalk is right now.
    actual_fraction = 2 / total_live
    max_fraction = actual_fraction / 2
    assert 0 < max_fraction < actual_fraction

    with pytest.raises(FactsStoreError, match="refusing to retire"):
        async with pool.acquire() as conn, conn.transaction():
            await facts_store.retire_absent_slugs(
                conn, previous_run_started_at=cutoff, max_fraction=max_fraction, min_floor=0
            )

    async with pool.acquire() as conn:
        live_count = await conn.fetchval(
            "SELECT count(*) FROM cds_library.collegedata_schools "
            "WHERE slug = ANY($1::text[]) AND retired_at IS NULL",
            slugs,
        )
    assert live_count == 2  # refused before any write -- nothing retired


async def test_legitimate_single_slug_retirement_still_works(
    pipeline_pool: asyncpg.Pool,
    crosswalk: Callable[[Sequence[tuple[str, datetime | None]]], Awaitable[None]],
) -> None:
    """The guard must not make retirement impossible: one genuinely stale
    slug among many live ones is a small fraction of any real crosswalk
    and must still retire normally."""
    pool = pipeline_pool
    stale = datetime(2000, 1, 1, tzinfo=UTC)
    cutoff = datetime(2000, 1, 2, tzinfo=UTC)
    still_live = datetime.now(UTC)
    stale_slug = _slug(30)
    live_slug = _slug(31)
    await crosswalk([(stale_slug, stale), (live_slug, still_live)])

    async with pool.acquire() as conn:
        total_live = await conn.fetchval(
            "SELECT count(*) FROM cds_library.collegedata_schools WHERE retired_at IS NULL"
        )
    # Generous enough that this single legitimate retirement is never
    # refused, no matter how large the real crosswalk is at test time.
    max_fraction = max(0.5, 4 / total_live)

    async with pool.acquire() as conn, conn.transaction():
        retired = await facts_store.retire_absent_slugs(
            conn, previous_run_started_at=cutoff, max_fraction=max_fraction, min_floor=0
        )
    assert stale_slug in retired
    assert live_slug not in retired

    rows = await pool.fetch(
        "SELECT slug, retired_at FROM cds_library.collegedata_schools WHERE slug = ANY($1::text[])",
        [stale_slug, live_slug],
    )
    by_slug = {row["slug"]: row["retired_at"] for row in rows}
    assert by_slug[stale_slug] is not None
    assert by_slug[live_slug] is None


async def test_min_floor_bypasses_the_ceiling_on_a_small_crosswalk(
    pipeline_pool: asyncpg.Pool,
    crosswalk: Callable[[Sequence[tuple[str, datetime | None]]], Awaitable[None]],
) -> None:
    """A crosswalk at or below `min_floor` is exempt from the fraction
    check entirely -- a fresh/small/test database retiring "all" of its
    rows is legitimate, not a bug. `min_floor` is set comfortably above
    the *real* current live count (queried at test time) so this holds
    regardless of production's actual crosswalk size; an aggressively
    tiny `max_fraction` alone would refuse this, proving the floor -- not
    the fraction -- is what lets it through."""
    pool = pipeline_pool
    stale = datetime(2000, 1, 1, tzinfo=UTC)
    cutoff = datetime(2000, 1, 2, tzinfo=UTC)
    slugs = [_slug(40), _slug(41)]
    await crosswalk([(slugs[0], stale), (slugs[1], stale)])

    async with pool.acquire() as conn:
        total_live = await conn.fetchval(
            "SELECT count(*) FROM cds_library.collegedata_schools WHERE retired_at IS NULL"
        )
    min_floor = total_live + 1000

    async with pool.acquire() as conn, conn.transaction():
        retired = await facts_store.retire_absent_slugs(
            conn, previous_run_started_at=cutoff, max_fraction=0.0001, min_floor=min_floor
        )
    assert set(slugs) <= set(retired)
