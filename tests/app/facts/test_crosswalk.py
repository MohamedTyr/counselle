"""Crosswalk CSV loader + DB sync (plan §7 Phase 1 exit test: "every CSV
``method`` is in the ``match_method`` CHECK set"). Honesty-critical: a wrong
or out-of-set value here means a school's facts silently attribute to the
wrong IPEDS institution — tested hard per the AGENTS.md carve-out.

The sync test writes for real against the live v3 database (not rolled
back): `cds_library.collegedata_schools` is exactly the table this CSV is
meant to seed, so proving idempotency here also performs the one real
bootstrap the running DB needs (`dev.py reset-db` / the Phase 4 bootstrap
will call the same `sync_crosswalk` later; this pins that it is safe to
call twice).
"""

from __future__ import annotations

import asyncpg
import pytest

from app.facts.crosswalk import VALID_METHODS, load_crosswalk, sync_crosswalk
from config.settings import get_settings
from counselle_db.db import create_pool

_SCHOOLS_TABLE_CHECK_SQL = """
    SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'collegedata_schools_match_method_check'
"""


def test_every_row_method_is_in_the_check_set() -> None:
    entries = load_crosswalk()
    assert entries, "the committed CSV must not be empty"
    for entry in entries.values():
        assert entry.method in VALID_METHODS


def test_unmatched_rows_carry_no_unitid_every_other_row_does() -> None:
    for entry in load_crosswalk().values():
        if entry.method == "unmatched":
            assert entry.unitid is None
        else:
            assert entry.unitid is not None


def test_csv_has_no_duplicate_slugs_and_no_duplicate_live_unitids() -> None:
    entries = load_crosswalk()
    seen_unitids: dict[int, str] = {}
    for slug, entry in entries.items():
        assert slug == entry.slug
        if entry.unitid is None:
            continue
        assert entry.unitid not in seen_unitids, (
            f"unitid {entry.unitid} claimed by both {seen_unitids[entry.unitid]!r} "
            f"and {slug!r} — collegedata_schools_live_school_idx would reject this"
        )
        seen_unitids[entry.unitid] = slug


@pytest.mark.live_db
async def test_valid_methods_matches_the_live_check_constraint() -> None:
    """Pins `VALID_METHODS` to the actual DDL, not just a hand-copied set —
    the same style as `tests/domain/facts/test_tab_names.py`."""
    settings = get_settings()
    pool = await create_pool(dsn=settings.db_pipeline_dsn)
    try:
        async with pool.acquire() as conn:
            definition = await conn.fetchval(_SCHOOLS_TABLE_CHECK_SQL)
    finally:
        await pool.close()
    assert definition is not None, "collegedata_schools_match_method_check not found"
    for method in VALID_METHODS:
        assert f"'{method}'" in definition


@pytest.mark.live_db
async def test_sync_crosswalk_is_idempotent() -> None:
    settings = get_settings()
    pool = await create_pool(dsn=settings.db_pipeline_dsn)
    try:
        n_first = await sync_crosswalk(pool)
        rows_after_first = await _dump_table(pool)

        n_second = await sync_crosswalk(pool)
        rows_after_second = await _dump_table(pool)

        assert n_first == n_second == len(load_crosswalk())
        assert rows_after_first == rows_after_second
    finally:
        await pool.close()


async def _dump_table(pool: asyncpg.Pool) -> list[tuple[object, ...]]:
    async with pool.acquire() as conn:
        records = await conn.fetch(
            "SELECT slug, school_id, match_method, matched_at, note "
            "FROM cds_library.collegedata_schools ORDER BY slug"
        )
    return [tuple(r) for r in records]
