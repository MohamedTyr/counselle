"""`live_db` exit tests for `adapters/facts_store.write_school_facts`'s
SCD2 close-then-insert rule (plan §3.4, §7 Phase 1 row) — the honesty-
critical core of the facts store:

- a second write with identical values inserts/closes nothing;
- a label removed between two writes is closed with no successor;
- a label on a tab **not** in `changed_tabs` is never touched;
- a legitimate `0` round-trips as a real, present value;
- a fact that disappears and later reappears gets a **new** row — the old
  closed row's `valid_to` is never reopened;
- a metadata-only change (display/source_path/snapshot_id, same value)
  updates in place instead of closing+reinserting.

Uses a permanently reserved, entirely test-owned synthetic school id
(never a real IPEDS unitid -- those are always positive) on the live v3
Postgres, cleaned up before and after every test. Previously hardcoded a
real school (Berea College, `school_id=156295`); the scoped-by-id
`DELETE FROM school_facts WHERE school_id = 156295` was still destructive
once the full crawl gave that school real `school_facts` rows -- every
test run wiped and never restored them. See
`tests/adapters/test_crawl_poison_pill.py`, which established the
reserved-synthetic-id pattern first for the same reason.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator

import asyncpg
import pytest

from adapters import facts_store
from domain.facts.models import FactRow, NormalizedValue

pytestmark = pytest.mark.live_db

# A permanently reserved, entirely test-owned school id -- never a real
# IPEDS unitid. Distinct from test_crawl_poison_pill.py's -900001/-900002
# and test_facts_store_jobs.py's -900003.
_SCHOOL_ID = -900004
_TAB = "admission"
_OTHER_TAB = "money-matters"
_SHA = hashlib.sha256(b"scd2-test").digest()


async def _wipe_test_school(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "DELETE FROM cds_library.school_facts WHERE school_id = $1", _SCHOOL_ID
        )
        await conn.execute(
            "DELETE FROM cds_library.school_explore_rows WHERE school_id = $1", _SCHOOL_ID
        )
        await conn.execute(
            "DELETE FROM cds_library.school_pages WHERE school_id = $1", _SCHOOL_ID
        )
        await conn.execute(
            "DELETE FROM cds_library.page_snapshots WHERE school_id = $1", _SCHOOL_ID
        )
        await conn.execute(
            "DELETE FROM cds_library.collegedata_schools WHERE school_id = $1", _SCHOOL_ID
        )
        await conn.execute("DELETE FROM cds_library.schools WHERE id = $1", _SCHOOL_ID)


async def _insert_test_school(pool: asyncpg.Pool) -> None:
    """Minimal identity profile -- `write_school_facts` only FKs
    `school_facts.school_id -> schools.id`, so no `collegedata_schools`
    row is needed for this file's tests. Same minimal shape as
    `test_crawl_poison_pill.py`'s fixture."""
    name = f"SCD2 Test Fixture School {_SCHOOL_ID}"
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
            _SCHOOL_ID,
            name,
        )


@pytest.fixture
async def clean_school(
    pipeline_pool: asyncpg.Pool, admin_pool: asyncpg.Pool
) -> AsyncIterator[asyncpg.Pool]:
    # `cds_library_app` has no DELETE grant on school_facts (plan §3.3) --
    # cleanup runs as the admin role; the test body itself uses pipeline_pool.
    # Pre-clean first: idempotent against residue left by a previous test
    # run that crashed before its own teardown ran.
    await _wipe_test_school(admin_pool)
    await _insert_test_school(admin_pool)
    try:
        yield pipeline_pool
    finally:
        await _wipe_test_school(admin_pool)


def _row(fact_key: str, *, tab: str = _TAB, value: NormalizedValue | None, **kw: object) -> FactRow:
    return FactRow(
        fact_key=fact_key,
        tab=tab,  # type: ignore[arg-type]
        section="getting-in",
        label="A label",
        value=value,
        source_path=kw.get("source_path", f"{tab}/@profile/{fact_key}"),  # type: ignore[arg-type]
    )


def _text(display: str) -> NormalizedValue:
    return NormalizedValue(kind="text", display=display, value_text=display)


async def _write(
    pool: asyncpg.Pool,
    *,
    changed_tabs: tuple[str, ...],
    rows: list[FactRow],
    snapshot_id: int | None = None,
) -> facts_store.FactsWriteResult:
    async with pool.acquire() as conn, conn.transaction():
        return await facts_store.write_school_facts(
            conn,
            school_id=_SCHOOL_ID,
            changed_tabs=changed_tabs,  # type: ignore[arg-type]
            rows=rows,
            snapshot_ids=dict.fromkeys(changed_tabs, snapshot_id),  # type: ignore[arg-type]
            snapshot_sha256=dict.fromkeys(changed_tabs, _SHA),  # type: ignore[arg-type]
            mapper_version="test-v1",
        )


async def _current_row(pool: asyncpg.Pool, fact_key: str) -> asyncpg.Record | None:
    return await pool.fetchrow(
        "SELECT * FROM cds_library.school_facts WHERE school_id = $1 AND fact_key = $2 "
        "AND valid_to IS NULL",
        _SCHOOL_ID,
        fact_key,
    )


async def test_second_identical_write_inserts_and_closes_nothing(
    clean_school: asyncpg.Pool,
) -> None:
    pool = clean_school
    row = _row("admissions.essay_requirement", value=_text("Required"))
    first = await _write(pool, changed_tabs=(_TAB,), rows=[row])
    assert first.inserted == 1

    count_after_first = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", _SCHOOL_ID
    )
    second = await _write(pool, changed_tabs=(_TAB,), rows=[row])
    assert second.inserted == 0
    assert second.closed_withdrawn == 0
    count_after_second = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", _SCHOOL_ID
    )
    assert count_after_second == count_after_first


async def test_withdrawn_label_is_closed_with_no_successor(clean_school: asyncpg.Pool) -> None:
    pool = clean_school
    row = _row("admissions.waitlist_used", value=_text("No"))
    await _write(pool, changed_tabs=(_TAB,), rows=[row])
    result = await _write(pool, changed_tabs=(_TAB,), rows=[])
    assert result.closed_withdrawn == 1
    current = await _current_row(pool, "admissions.waitlist_used")
    assert current is None
    closed = await pool.fetchval(
        "SELECT valid_to FROM cds_library.school_facts WHERE school_id = $1 AND fact_key = $2",
        _SCHOOL_ID,
        "admissions.waitlist_used",
    )
    assert closed is not None


async def test_label_on_a_tab_not_in_changed_tabs_is_untouched(clean_school: asyncpg.Pool) -> None:
    pool = clean_school
    row = _row("admissions.other_requirement", value=_text("None"))
    await _write(pool, changed_tabs=(_TAB,), rows=[row])
    # A pass where only the OTHER tab changed, with no rows at all -- the
    # admission-tab fact must survive untouched.
    result = await _write(pool, changed_tabs=(_OTHER_TAB,), rows=[])
    assert result.closed_withdrawn == 0
    current = await _current_row(pool, "admissions.other_requirement")
    assert current is not None


async def test_zero_round_trips_as_a_real_value(clean_school: asyncpg.Pool) -> None:
    pool = clean_school
    zero_value = NormalizedValue(kind="count", display="0", value_num=0)
    row = _row("faculty.part_time_count", value=zero_value)
    await _write(pool, changed_tabs=(_TAB,), rows=[row])
    current = await _current_row(pool, "faculty.part_time_count")
    assert current is not None
    assert current["value_num"] == 0
    assert current["valid_to"] is None


async def test_reappearing_fact_gets_a_new_row_not_a_reopened_one(
    clean_school: asyncpg.Pool,
) -> None:
    pool = clean_school
    row = _row("admissions.need_blind", value=_text("Yes"))
    await _write(pool, changed_tabs=(_TAB,), rows=[row])
    first_current = await _current_row(pool, "admissions.need_blind")
    assert first_current is not None
    original_id = first_current["id"]

    await _write(pool, changed_tabs=(_TAB,), rows=[])  # withdrawn
    closed_valid_to = await pool.fetchval(
        "SELECT valid_to FROM cds_library.school_facts WHERE id = $1", original_id
    )
    assert closed_valid_to is not None

    await _write(pool, changed_tabs=(_TAB,), rows=[row])  # reappears
    new_current = await _current_row(pool, "admissions.need_blind")
    assert new_current is not None
    assert new_current["id"] != original_id  # a NEW row, not the old one reopened

    still_closed = await pool.fetchval(
        "SELECT valid_to FROM cds_library.school_facts WHERE id = $1", original_id
    )
    assert still_closed == closed_valid_to  # untouched by the reappearance


async def test_metadata_only_change_updates_in_place(clean_school: asyncpg.Pool) -> None:
    pool = clean_school
    row = _row("applying.transfer_accepted", value=_text("Yes"), source_path=f"{_TAB}/v1")
    await _write(pool, changed_tabs=(_TAB,), rows=[row])
    first_current = await _current_row(pool, "applying.transfer_accepted")
    assert first_current is not None
    original_id = first_current["id"]

    same_value_new_metadata = _row(
        "applying.transfer_accepted", value=_text("Yes"), source_path=f"{_TAB}/v2"
    )
    result = await _write(pool, changed_tabs=(_TAB,), rows=[same_value_new_metadata])
    assert result.inserted == 0
    assert result.closed_withdrawn == 0
    assert result.updated_metadata == 1

    current = await _current_row(pool, "applying.transfer_accepted")
    assert current is not None
    assert current["id"] == original_id  # same row, in-place update
    assert current["source_path"] == f"{_TAB}/v2"
