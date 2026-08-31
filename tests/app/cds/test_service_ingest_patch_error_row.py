"""Regression test for what `app/cds/service_ingest.patch_upload_row` refuses.

The guard there exists for `create_upload`'s except-branch, which stages an
unreadable file with ``content = NULL``: there is no PDF behind that row, so
letting a PATCH re-resolve it to `matched` would only produce something that
fails again at process time. It was written as ``status == 'error'`` and
justified by that missing content -- but the two are not the same set.

`process_batch`'s per-file handler also writes ``status = 'error'``, and writes
only ``status``/``error_message``; the content is intact (it is nulled on the
success path alone). So a file that hit a transient commit failure -- a pool
blip, an `upsert_school_year` race, the duplicate-without-extraction validation
error -- was stranded permanently: `process_batch` skips `error` rows
(`_READY_STATUSES`), and the admin's only recovery was to delete the row and
re-upload the file from disk. Gating on the missing PDF instead restores the
no-op PATCH that re-resolves the status and lets the next "Process all" retry.

No live database: the app pool is a fake conn echoing the UPDATE back.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from adapters import cds_admin_queries
from app.cds import service_ingest
from app.cds.errors import CdsAdminValidationError

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_FILE_ID = uuid.uuid4()
_SCHOOL_ID = 3
_YEAR = 2025


class _FakeConn:
    def __init__(self, *, no_content: bool, status: str) -> None:
        self.existing = {
            "status": status,
            "detection": {},
            "school_id": None,
            "academic_year": None,
            "no_content": no_content,
        }
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, query: str, *params: Any) -> dict[str, Any] | None:
        self.calls.append((query, params))
        if query.lstrip().startswith("SELECT"):
            return self.existing
        # The UPDATE, echoed back as the row it would have written.
        return {
            "id": params[0], "batch_id": uuid.uuid4(), "filename": "cds.pdf",
            "size_bytes": 1024, "sha256": b"\xab" * 32, "page_count": 12,
            "status": params[3], "school_id": params[1], "academic_year": params[2],
            "detection": {}, "error_message": "connection was closed in the middle",
            "committed_document_id": None, "committed_extraction_id": None,
            "created_at": _NOW, "updated_at": _NOW,
        }

    def transaction(self) -> _Ctx:
        return _Ctx(None)


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakePool:
    def __init__(self, conn: _FakeConn | None = None) -> None:
        self.conn = conn or _FakeConn(no_content=False, status="needs_input")

    def acquire(self) -> _Ctx:
        return _Ctx(self.conn)


@pytest.fixture(autouse=True)
def _patch_lookups(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _slot_has_document(pool: Any, *, school_id: int, academic_year: int) -> bool:
        return False

    async def _schools_by_ids(pool: Any, school_ids: set[int]) -> dict[int, str]:
        return {_SCHOOL_ID: "Test College"}

    monkeypatch.setattr(cds_admin_queries, "slot_has_document", _slot_has_document)
    monkeypatch.setattr(cds_admin_queries, "schools_by_ids", _schools_by_ids)


async def _patch(conn: _FakeConn) -> Any:
    return await service_ingest.patch_upload_row(
        _FakePool(conn), _FakePool(), file_id=_FILE_ID,
        school_id=_SCHOOL_ID, academic_year=_YEAR,
    )


async def test_an_error_row_that_still_has_its_pdf_can_be_retried() -> None:
    """`process_batch`'s per-file failure leaves the content intact. Refusing
    the PATCH stranded the file: nothing re-queues an `error` row, so the admin
    had to delete it and re-upload the same bytes from disk."""
    conn = _FakeConn(no_content=False, status="error")

    row = await _patch(conn)

    assert row.status == "matched"  # re-resolved, so "Process all" picks it up again


async def test_an_error_row_with_no_pdf_behind_it_is_still_refused() -> None:
    """`create_upload`'s except-branch: there are no bytes to process, so a
    ready status here would only fail again later."""
    conn = _FakeConn(no_content=True, status="error")

    with pytest.raises(CdsAdminValidationError) as excinfo:
        await _patch(conn)

    assert "failed to read" in str(excinfo.value)


async def test_a_committed_row_is_still_refused() -> None:
    conn = _FakeConn(no_content=True, status="committed")

    with pytest.raises(CdsAdminValidationError) as excinfo:
        await _patch(conn)

    assert "already-committed" in str(excinfo.value)
