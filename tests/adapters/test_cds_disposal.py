"""Regression tests for the document-2009 orphan fix (SHIP-PLAN §0.11 case
(e)): a MEDIUM defect found by a live browser round-trip where an orphaned,
never-invalidated document (school-year retired, both pointers NULL) stayed
reachable by SHA-256 lookup and surfaced a fabricated academic year in the
admin duplicate-upload UI.

Covers the two-part fix:
- `adapters.cds_store.invalidate_orphaned_document` -- disposes of the class
  of document that fell through Phase 1.0's disposal script (nothing to
  reject, so nothing ever invalidated it), and refuses if the document is
  still reachable from a live slot.
- `adapters.cds_admin_queries._DOCUMENT_BY_SHA256_SQL` -- the defense-in-depth
  `sy.retired_at IS NULL` clause that stops a retired slot's document from
  leaking into the duplicate-upload check again, while still matching a
  genuine duplicate whose slot is live.

Writes throwaway rows against real corpus documents/schools inside one
transaction, rolled back unconditionally in `finally` -- nothing here is ever
committed. `live_db`-marked per the existing convention
(`tests/app/cds/test_service_review.py`): needs write access to
`cds_library` via the `cds_library_app` role (`db_pipeline_dsn`).
"""

from __future__ import annotations

from hashlib import sha256
from uuid import uuid4

import asyncpg
import pytest

from adapters import cds_store
from adapters.cds_admin_queries import _DOCUMENT_BY_SHA256_SQL
from config.settings import get_settings

pytestmark = pytest.mark.live_db

# Harvard University -- an existing corpus school (SHIP-PLAN §0.2), reused so
# the synthetic school-year row satisfies the `school_id` FK without needing
# to insert into `schools` too.
_HARVARD_SCHOOL_ID = 166027

_INSERT_SCHOOL_YEAR_SQL = """
    INSERT INTO cds_library.cds_school_years (school_id, academic_year, retired_at)
    VALUES ($1, $2, $3)
    RETURNING id
"""

_INSERT_DOCUMENT_SQL = """
    INSERT INTO cds_library.cds_documents
        (school_year_id, pdf_content, pdf_sha256, pdf_size_bytes, mime_type,
         original_filename, source_kind, retrieved_at)
    VALUES ($1, $2, $3, $4, 'application/pdf', $5, 'upload', now())
    RETURNING id
"""

_SET_ACTIVE_POINTER_SQL = """
    UPDATE cds_library.cds_school_years SET active_document_id = $2 WHERE id = $1
"""


async def _insert_school_year(
    conn: asyncpg.Connection, *, academic_year: int, retired: bool
) -> int:
    school_year_id: int = await conn.fetchval(
        _INSERT_SCHOOL_YEAR_SQL,
        _HARVARD_SCHOOL_ID,
        academic_year,
        None,  # inserted open; retired below via UPDATE so the FK-checked
        # active pointer can still be set first when a test needs it.
    )
    if retired:
        await conn.execute(
            "UPDATE cds_library.cds_school_years SET retired_at = now() WHERE id = $1",
            school_year_id,
        )
    return school_year_id


async def _insert_document(
    conn: asyncpg.Connection, *, school_year_id: int, filename: str
) -> tuple[int, bytes]:
    digest = sha256(uuid4().bytes).digest()
    document_id: int = await conn.fetchval(
        _INSERT_DOCUMENT_SQL,
        school_year_id,
        b"%PDF-1.4 fake content for test",
        digest,
        30,
        filename,
    )
    return document_id, digest


async def test_invalidate_orphaned_document_disposes_of_unreachable_document() -> None:
    conn = await asyncpg.connect(get_settings().db_pipeline_dsn)
    transaction = conn.transaction()
    await transaction.start()
    try:
        # A retired slot with nothing pointing at the document -- exactly
        # document 2009 / school_year 4009's shape.
        school_year_id = await _insert_school_year(conn, academic_year=2098, retired=True)
        document_id, _digest = await _insert_document(
            conn, school_year_id=school_year_id, filename="orphaned.pdf"
        )

        await cds_store.invalidate_orphaned_document(conn, document_id=document_id)

        invalidated_at = await conn.fetchval(
            "SELECT invalidated_at FROM cds_library.cds_documents WHERE id = $1", document_id
        )
        assert invalidated_at is not None

        with pytest.raises(cds_store.CdsStoreError, match="already invalidated"):
            await cds_store.invalidate_orphaned_document(conn, document_id=document_id)
    finally:
        await transaction.rollback()
        await conn.close()


async def test_invalidate_orphaned_document_refuses_a_reachable_document() -> None:
    conn = await asyncpg.connect(get_settings().db_pipeline_dsn)
    transaction = conn.transaction()
    await transaction.start()
    try:
        school_year_id = await _insert_school_year(conn, academic_year=2099, retired=False)
        document_id, _digest = await _insert_document(
            conn, school_year_id=school_year_id, filename="still-active.pdf"
        )
        await conn.execute(_SET_ACTIVE_POINTER_SQL, school_year_id, document_id)

        with pytest.raises(cds_store.CdsStoreError, match="still reachable"):
            await cds_store.invalidate_orphaned_document(conn, document_id=document_id)

        # Refused, so the document must still be intact -- this must never
        # silently discard a document a slot depends on.
        invalidated_at = await conn.fetchval(
            "SELECT invalidated_at FROM cds_library.cds_documents WHERE id = $1", document_id
        )
        assert invalidated_at is None
    finally:
        await transaction.rollback()
        await conn.close()


async def test_duplicate_lookup_excludes_a_retired_slots_document() -> None:
    """The defense-in-depth half of the fix: `_DOCUMENT_BY_SHA256_SQL` must
    not resurface a document whose school-year has been retired, even if
    (by some future bug) it was never invalidated -- and must still match a
    genuine duplicate sitting in a live, non-retired slot."""
    conn = await asyncpg.connect(get_settings().db_pipeline_dsn)
    transaction = conn.transaction()
    await transaction.start()
    try:
        retired_school_year_id = await _insert_school_year(
            conn, academic_year=2097, retired=True
        )
        retired_document_id, digest = await _insert_document(
            conn, school_year_id=retired_school_year_id, filename="dead-slot.pdf"
        )
        # Deliberately not invalidated -- reproduces the exact bug shape
        # (retired slot, live document) the `retired_at` clause guards.
        row = await conn.fetchrow(_DOCUMENT_BY_SHA256_SQL, digest)
        assert row is None, "a retired slot's document must not surface as a duplicate match"

        # The same PDF content, uploaded again into a live (non-retired)
        # slot, must still be caught as a genuine duplicate.
        live_school_year_id = await _insert_school_year(
            conn, academic_year=2096, retired=False
        )
        live_document_id, _reused_digest = (
            await conn.fetchval(
                _INSERT_DOCUMENT_SQL,
                live_school_year_id,
                b"%PDF-1.4 fake content for test",
                digest,
                30,
                "same-content-live-slot.pdf",
            ),
            digest,
        )
        row = await conn.fetchrow(_DOCUMENT_BY_SHA256_SQL, digest)
        assert row is not None
        assert row["id"] == live_document_id
        assert row["id"] != retired_document_id
    finally:
        await transaction.rollback()
        await conn.close()
