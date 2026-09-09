"""`live_db` exit tests for `adapters/facts_store.py`'s snapshot/retention
rules (plan §3.4, §7 Phase 1 row):

- a page reverting to a previously-seen body repoints without inserting and
  without reopening a closed fact;
- a fourth distinct body leaves exactly three snapshots and orphans no live
  fact's `snapshot_id`;
- a rotation... (build_id_rotations itself has its own exit test,
  `tests/adapters/test_collegedata_fetch.py` — not duplicated here).

Uses a permanently reserved, entirely test-owned synthetic school id
(never a real IPEDS unitid -- those are always positive). Every row this
file writes is cleaned up in `finally`, before and after, so a failed run
never leaves stray facts data behind for another test. Previously
hardcoded a real school (Berea College, `school_id=156295`, one of the
eleven committed fixture schools, plan §4.5); once the full crawl gave
that school real `school_pages`/`page_snapshots`/`school_facts` rows, this
file's `_wipe` -- clearing `latest_snapshot_id` then deleting all four
tables for that school id, before AND after every test -- destroyed all of
Berea College's real crawl history on every run. See
`tests/adapters/test_crawl_poison_pill.py`, which established the
reserved-synthetic-id pattern first for the same reason.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator

import asyncpg
import pytest

from adapters import facts_store
from domain.facts.models import TabName

pytestmark = pytest.mark.live_db

# A permanently reserved, entirely test-owned school id -- never a real
# IPEDS unitid. Distinct from test_crawl_poison_pill.py's -900001/-900002,
# test_facts_store_jobs.py's -900003, and test_facts_store_scd2.py's -900004.
_SCHOOL_ID = -900005
_TAB: TabName = "money-matters"


async def _wipe_test_school(pool: asyncpg.Pool, *, school_id: int) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "UPDATE cds_library.school_pages SET latest_snapshot_id = NULL WHERE school_id = $1",
            school_id,
        )
        await conn.execute("DELETE FROM cds_library.school_facts WHERE school_id = $1", school_id)
        await conn.execute(
            "DELETE FROM cds_library.school_explore_rows WHERE school_id = $1", school_id
        )
        await conn.execute("DELETE FROM cds_library.page_snapshots WHERE school_id = $1", school_id)
        await conn.execute("DELETE FROM cds_library.school_pages WHERE school_id = $1", school_id)
        await conn.execute("DELETE FROM cds_library.schools WHERE id = $1", school_id)


async def _insert_test_school(pool: asyncpg.Pool, *, school_id: int) -> None:
    """Minimal identity profile -- `record_page_changed`/`school_pages`/
    `page_snapshots`/`school_facts` all FK only to `schools.id`, so no
    `collegedata_schools` row is needed for this file's tests. Same
    minimal shape as `test_crawl_poison_pill.py`'s fixture."""
    name = f"Snapshots Test Fixture School {school_id}"
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


@pytest.fixture
async def clean_school(
    pipeline_pool: asyncpg.Pool, admin_pool: asyncpg.Pool
) -> AsyncIterator[asyncpg.Pool]:
    # `cds_library_app` has DELETE on page_snapshots only, not
    # school_facts/school_explore_rows/school_pages (plan §3.3) -- cleanup
    # runs as the admin role; the test body itself uses pipeline_pool.
    # Pre-clean first: idempotent against residue left by a previous test
    # run that crashed before its own teardown ran.
    await _wipe_test_school(admin_pool, school_id=_SCHOOL_ID)
    await _insert_test_school(admin_pool, school_id=_SCHOOL_ID)
    try:
        yield pipeline_pool
    finally:
        await _wipe_test_school(admin_pool, school_id=_SCHOOL_ID)


def _sha(body: dict[str, object]) -> bytes:
    return hashlib.sha256(repr(sorted(body.items())).encode()).digest()


async def _write_body(
    pool: asyncpg.Pool, *, body: dict[str, object]
) -> facts_store.PageWriteResult:
    async with pool.acquire() as conn, conn.transaction():
        return await facts_store.record_page_changed(
            conn,
            school_id=_SCHOOL_ID,
            tab=_TAB,
            http_status=200,
            build_id="test-build",
            content_sha256=_sha(body),
            body=body,
            retention_per_page=3,
        )


async def test_revert_repoints_without_inserting(clean_school: asyncpg.Pool) -> None:
    pool = clean_school
    first = await _write_body(pool, body={"v": 1})
    second = await _write_body(pool, body={"v": 2})
    assert first.is_new_snapshot
    assert second.is_new_snapshot

    reverted = await _write_body(pool, body={"v": 1})
    assert reverted.is_new_snapshot is False
    assert reverted.snapshot_id == first.snapshot_id

    latest = await pool.fetchval(
        "SELECT latest_snapshot_id FROM cds_library.school_pages WHERE school_id = $1 AND tab = $2",
        _SCHOOL_ID,
        _TAB,
    )
    assert latest == first.snapshot_id


async def test_fourth_distinct_body_leaves_exactly_three_snapshots_orphaning_nothing(
    clean_school: asyncpg.Pool,
) -> None:
    pool = clean_school
    for value in (1, 2, 3, 4):
        await _write_body(pool, body={"v": value})

    count = await pool.fetchval(
        "SELECT count(*) FROM cds_library.page_snapshots WHERE school_id = $1 AND tab = $2",
        _SCHOOL_ID,
        _TAB,
    )
    assert count == 3

    live_fact_snapshot_ids = await pool.fetch(
        "SELECT snapshot_id FROM cds_library.school_facts "
        "WHERE school_id = $1 AND valid_to IS NULL AND snapshot_id IS NOT NULL",
        _SCHOOL_ID,
    )
    existing_ids = {
        row["id"]
        for row in await pool.fetch(
            "SELECT id FROM cds_library.page_snapshots WHERE school_id = $1 AND tab = $2",
            _SCHOOL_ID,
            _TAB,
        )
    }
    for row in live_fact_snapshot_ids:
        assert row["snapshot_id"] in existing_ids
