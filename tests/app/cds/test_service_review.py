"""One regression test for the `active_update` review predicate (SHIP-PLAN
§2.5). Phase 2's predicate had two documented bugs before this revision --
it never closed, and it collided with the routine edit-and-approve path --
both found by hand, not by a test. This pins the fix: a genuine pending
`active_update` rerun resolves the predicate; a synthesized `human-review-v1`
row (created on every ordinary edit-and-approve) does not; and closing it
(`close_pending_active_updates`) actually clears it, including the
back-to-back-reruns case (risk 10) where a second unreviewed rerun must not
strand the first one's `reactivated_at` forever.

Writes throwaway `active_update` extraction rows against real, already-active
corpus documents inside one transaction, rolled back unconditionally in
`finally` -- nothing here is ever committed. `live_db`-marked per the
existing convention (`tests/domain/cds/test_packet_build_golden.py`): it
needs write access to `cds_library` via the `cds_library_app` role
(`db_pipeline_dsn`), which the routine suite deliberately never touches.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import asyncpg
import pytest

from adapters import cds_store
from adapters.cds_store import HUMAN_REVIEW_EXTRACTOR_VERSION
from app.cds.engine import EXTRACTOR_VERSION as MODEL_EXTRACTOR_VERSION
from config.settings import get_settings

pytestmark = pytest.mark.live_db

# Documents 1, 2, 4 are part of the live corpus (SHIP-PLAN §0.2/§4.1) and are
# already active -- exactly the case `_require_reviewable` broadens for. Each
# scenario below uses a different document so the three cases can't interact
# with each other's rows.
_GENUINE_DOCUMENT_ID = 1
_HUMAN_REVIEW_DOCUMENT_ID = 2
_BACK_TO_BACK_DOCUMENT_ID = 4

_SCHOOL_YEAR_QUERY = "SELECT school_year_id FROM cds_library.cds_documents WHERE id = $1"
_CURRENT_MANIFEST_QUERY = "SELECT version FROM cds_library.cds_manifests WHERE is_current"

_INSERT_ACTIVE_UPDATE_SQL = """
    INSERT INTO cds_library.cds_extractions
        (id, school_year_id, document_id, manifest_version, target_kind,
         requested_domains, status, extractor_version, model_id,
         started_at, finished_at, created_at)
    VALUES ($1, $2, $3, $4, 'active_update', $5, 'succeeded', $6, 'test-harness',
            now(), now(), $7)
    RETURNING id
"""


async def _insert_active_update(
    conn: asyncpg.Connection,
    *,
    document_id: int,
    school_year_id: int,
    manifest_version: str,
    extractor_version: str,
    created_at: datetime,
) -> uuid.UUID:
    inserted_id: uuid.UUID = await conn.fetchval(
        _INSERT_ACTIVE_UPDATE_SQL,
        uuid.uuid4(),
        school_year_id,
        document_id,
        manifest_version,
        ["identity"],
        extractor_version,
        created_at,
    )
    return inserted_id


async def _unresolved_active_update_count(conn: asyncpg.Connection, *, document_id: int) -> int:
    count: int = await conn.fetchval(
        """
        SELECT count(*) FROM cds_library.cds_extractions
        WHERE document_id = $1 AND target_kind = 'active_update' AND reactivated_at IS NULL
        """,
        document_id,
    )
    return count


async def test_pending_active_update_predicate_resolves_and_closes() -> None:
    conn = await asyncpg.connect(get_settings().db_pipeline_dsn)
    transaction = conn.transaction()
    await transaction.start()
    try:
        manifest_version = await conn.fetchval(_CURRENT_MANIFEST_QUERY)
        assert manifest_version is not None, "no current manifest -- corpus fixture broke"
        now = await conn.fetchval("SELECT now()")

        # Case 1: a genuine pending `active_update` rerun resolves the predicate.
        genuine_school_year_id = await conn.fetchval(_SCHOOL_YEAR_QUERY, _GENUINE_DOCUMENT_ID)
        genuine_id = await _insert_active_update(
            conn,
            document_id=_GENUINE_DOCUMENT_ID,
            school_year_id=genuine_school_year_id,
            manifest_version=manifest_version,
            extractor_version=MODEL_EXTRACTOR_VERSION,
            created_at=now,
        )
        resolved = await cds_store.find_pending_active_update(
            conn, document_id=_GENUINE_DOCUMENT_ID
        )
        assert resolved == genuine_id

        # Case 3: closing it actually clears the predicate -- the bug where
        # `activate_packet` never touches `cds_extractions`, so the naive
        # predicate never closed after approval.
        await cds_store.close_pending_active_updates(conn, document_id=_GENUINE_DOCUMENT_ID)
        assert (
            await cds_store.find_pending_active_update(conn, document_id=_GENUINE_DOCUMENT_ID)
            is None
        )

        # Case 2: a synthesized `human-review-v1` row -- the row every
        # ordinary edit-and-approve already creates -- must NOT resolve the
        # predicate, or every approved-with-edits document would show
        # `correction_pending` forever.
        human_review_school_year_id = await conn.fetchval(
            _SCHOOL_YEAR_QUERY, _HUMAN_REVIEW_DOCUMENT_ID
        )
        await _insert_active_update(
            conn,
            document_id=_HUMAN_REVIEW_DOCUMENT_ID,
            school_year_id=human_review_school_year_id,
            manifest_version=manifest_version,
            extractor_version=HUMAN_REVIEW_EXTRACTOR_VERSION,
            created_at=now,
        )
        assert (
            await cds_store.find_pending_active_update(
                conn, document_id=_HUMAN_REVIEW_DOCUMENT_ID
            )
            is None
        )

        # Risk 10: back-to-back reruns. E1 succeeds, then E2 succeeds before
        # E1 is reviewed. The predicate surfaces the most recent (E2), but
        # closing must resolve BOTH, not just the one reviewed -- else E1's
        # `reactivated_at` stays NULL forever and later resurfaces as a false
        # `correction_pending` badge over data that was correctly approved.
        back_to_back_school_year_id = await conn.fetchval(
            _SCHOOL_YEAR_QUERY, _BACK_TO_BACK_DOCUMENT_ID
        )
        e1_id = await _insert_active_update(
            conn,
            document_id=_BACK_TO_BACK_DOCUMENT_ID,
            school_year_id=back_to_back_school_year_id,
            manifest_version=manifest_version,
            extractor_version=MODEL_EXTRACTOR_VERSION,
            created_at=now - timedelta(seconds=2),
        )
        e2_id = await _insert_active_update(
            conn,
            document_id=_BACK_TO_BACK_DOCUMENT_ID,
            school_year_id=back_to_back_school_year_id,
            manifest_version=manifest_version,
            extractor_version=MODEL_EXTRACTOR_VERSION,
            created_at=now - timedelta(seconds=1),
        )
        surfaced = await cds_store.find_pending_active_update(
            conn, document_id=_BACK_TO_BACK_DOCUMENT_ID
        )
        assert surfaced == e2_id
        assert surfaced != e1_id

        await cds_store.close_pending_active_updates(
            conn, document_id=_BACK_TO_BACK_DOCUMENT_ID
        )
        assert (
            await _unresolved_active_update_count(conn, document_id=_BACK_TO_BACK_DOCUMENT_ID)
            == 0
        )
        assert (
            await cds_store.find_pending_active_update(
                conn, document_id=_BACK_TO_BACK_DOCUMENT_ID
            )
            is None
        )
    finally:
        await transaction.rollback()
        await conn.close()
