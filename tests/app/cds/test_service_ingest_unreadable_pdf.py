"""Regression test for `app/cds/service_ingest.create_upload`'s stated
contract: "Never raises on an unreadable PDF -- an `error`-status row is
returned instead of failing the whole upload request."

That held for `cds_pdf.get_page_count`, which is wrapped, and not for the very
next call. PyMuPDF reports a correct `page_count` for a password-protected
document and only fails once something touches its content, so an encrypted
upload sailed past the guard and blew up inside `detect.detect_school_year`
with a raw `ValueError` -- out through the route to the global handler as a
500, with *no upload row written at all*. Per-file isolation is the whole
point of this endpoint (one bad file must never fail the batch), and the admin
got nothing to look at explaining why.

The fix is in the adapter (`adapters/cds_pdf._open` refuses a document that
needs a password, and re-raises raw PyMuPDF failures as `CdsPdfError`), so this
test is here to pin the behaviour an admin actually sees.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from app.cds import service_ingest
from tests.pdf_fixtures import build_pdf

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_USER = uuid.uuid4()
_BATCH = uuid.uuid4()


def _encrypted_pdf() -> bytes:
    return build_pdf(user_pw="secret", owner_pw="owner")


class _FakeConn:
    """Echoes the `error`-branch INSERT back as the row it would have written,
    so `_row_to_upload` has the columns it reads."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, query: str, *params: Any) -> dict[str, Any] | None:
        self.calls.append((query, params))
        if "'error'" not in query:
            return None
        return {
            "id": params[0], "batch_id": params[1], "filename": params[3],
            "size_bytes": params[4], "sha256": params[5], "page_count": None,
            "status": "error", "school_id": None, "academic_year": None,
            "detection": params[6], "error_message": params[7],
            "committed_document_id": None, "committed_extraction_id": None,
            "created_at": _NOW, "updated_at": _NOW,
        }


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakePool:
    def __init__(self) -> None:
        self.conn = _FakeConn()

    def acquire(self) -> _Ctx:
        return _Ctx(self.conn)


class TestEncryptedUploadStaysPerFile:
    async def test_it_returns_an_error_row_instead_of_raising(self) -> None:
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool, _FakePool(), SimpleNamespace(), user_id=_USER, batch_id=_BATCH,
            filename="locked.pdf", content=_encrypted_pdf(),
        )

        assert row.status == "error"
        assert row.page_count is None

    async def test_the_row_says_why_in_words_an_admin_can_act_on(self) -> None:
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool, _FakePool(), SimpleNamespace(), user_id=_USER, batch_id=_BATCH,
            filename="locked.pdf", content=_encrypted_pdf(),
        )

        assert row.error_message is not None
        assert "password-protected or unreadable PDF" in row.error_message

    async def test_it_never_reaches_the_normal_staging_insert(self) -> None:
        """The success branch stores the file content and audits an upload. An
        unreadable document must not get that far -- it would stage bytes
        nothing downstream can ever extract from."""
        app_pool = _FakePool()

        await service_ingest.create_upload(
            app_pool, _FakePool(), SimpleNamespace(), user_id=_USER, batch_id=_BATCH,
            filename="locked.pdf", content=_encrypted_pdf(),
        )

        [(query, _params)] = app_pool.conn.calls
        assert "'error'" in query
