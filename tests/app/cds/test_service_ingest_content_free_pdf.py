"""Regression test for a CDS-admin honesty defect: an uploaded PDF with no
CDS content at all auto-matched to a real school and academic year and went
straight to `matched` ("Ready", DESIGN.md §2.3/§4) -- a wrong-but-confident
claim one click from becoming student-facing data attributed to a real
school and year.

Root cause, live-reproduced (`artifacts/cds-honesty-repro/`, not committed):
`detect._DetectedIdentity` has no "unknown" field, so the detection model is
schema-forced to answer with SOME school name and year even for a blank
document. A genuinely content-free PDF made the real model answer
"University of California, Berkeley", which then fuzzy-matched the real
catalog row at score 0.955 -- comfortably past `detect._MATCH_CONFIDENT_THRESHOLD`
(0.82) -- so `create_upload` auto-filled a wholly fabricated identity with
nothing to mark it as a guess.

The fix (`service_ingest.create_upload`) gates the auto-fill on
`cds_pdf.sanity_check_cds_pdf` -- already defined, never wired in anywhere --
in addition to the existing confidence score: a document that does not even
claim to be a Common Data Set on its first page never auto-fills school/year,
so it falls through to `needs_input` via `_resolve_status`, same as a
low-score match. A human confirms before this can ever say "Ready".
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pymupdf

from adapters import cds_admin_queries, cds_gemini
from adapters.cds_admin_types import SchoolSummary
from app.cds import service_ingest

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_USER = uuid.uuid4()
_BATCH = uuid.uuid4()
_HALLUCINATED_SCHOOL_ID = 110635
_HALLUCINATED_SCHOOL_NAME = "University of California-Berkeley"


def _content_free_pdf() -> bytes:
    """Structurally valid PDF, zero text on any page -- no CDS content at
    all, matching the reported dummy-PDF upload."""
    doc = pymupdf.open()  # type: ignore[no-untyped-call]
    doc.new_page()
    doc.new_page()
    return bytes(doc.tobytes())  # type: ignore[no-untyped-call]


def _cds_titled_pdf() -> bytes:
    """A page 1 that actually claims to be a Common Data Set -- the sanity
    check should let this one through to auto-fill, same as before the fix."""
    doc = pymupdf.open()  # type: ignore[no-untyped-call]
    page = doc.new_page()
    page.insert_text((72, 72), "Common Data Set 2022-2023")
    return bytes(doc.tobytes())  # type: ignore[no-untyped-call]


async def _fake_generate_structured(
    *, settings: Any, prompt: str, response_schema: type, **_: Any
) -> cds_gemini.GenerateResult:
    """Stands in for the live model call. `response_schema`
    (`detect._DetectedIdentity`) has no "I don't know" field, so even faced
    with a blank document the real model must answer with *something* --
    this reproduces exactly what was observed live against the real model."""
    parsed = response_schema(school_name=_HALLUCINATED_SCHOOL_NAME, academic_year_start=2023)
    return cds_gemini.GenerateResult(
        parsed=parsed,
        usage=cds_gemini.Usage(
            prompt_tokens=1, output_tokens=1, thoughts_tokens=0, cached_tokens=0, total_tokens=2
        ),
        latency_seconds=0.01,
        model_id="fake-detect-model",
        finish_reason="STOP",
    )


async def _fake_find_document_by_sha256(pool: Any, sha256: bytes) -> None:
    return None


async def _fake_search_schools(pool: Any, q: str, *, limit: int = 20) -> list[SchoolSummary]:
    return [
        SchoolSummary(
            id=_HALLUCINATED_SCHOOL_ID, name=_HALLUCINATED_SCHOOL_NAME, state="CA", city="Berkeley"
        )
    ]


async def _fake_slot_has_document(pool: Any, *, school_id: int, academic_year: int) -> bool:
    return False


async def _fake_schools_by_ids(pool: Any, school_ids: set[int]) -> dict[int, str]:
    return {sid: _HALLUCINATED_SCHOOL_NAME for sid in school_ids}


class _FakeTransaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeConn:
    """Echoes the staging INSERT back as the row it would have written, so
    `_row_to_upload` has the columns it reads -- same shape as the existing
    encrypted-PDF fake (`test_service_ingest_unreadable_pdf.py`), extended
    for the success-path INSERT and its audit-log write."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction()

    async def fetchrow(self, query: str, *params: Any) -> dict[str, Any] | None:
        self.calls.append((query, params))
        if "INSERT INTO counselle.cds_upload_files" not in query:
            return None
        # Success-branch INSERT column order (service_ingest.create_upload):
        # id, batch_id, uploaded_by, filename, content, size_bytes, sha256,
        # page_count, status, school_id, academic_year, detection.
        return {
            "id": params[0], "batch_id": params[1], "filename": params[3],
            "size_bytes": params[5], "sha256": params[6], "page_count": params[7],
            "status": params[8], "school_id": params[9], "academic_year": params[10],
            "detection": params[11], "error_message": None,
            "committed_document_id": None, "committed_extraction_id": None,
            "created_at": _NOW, "updated_at": _NOW,
        }

    async def fetchval(self, query: str, *params: Any) -> int:
        self.calls.append((query, params))
        return 1


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


def _patch_query_boundary(monkeypatch: Any) -> None:
    monkeypatch.setattr(cds_gemini, "generate_structured", _fake_generate_structured)
    monkeypatch.setattr(cds_admin_queries, "find_document_by_sha256", _fake_find_document_by_sha256)
    monkeypatch.setattr(cds_admin_queries, "search_schools", _fake_search_schools)
    monkeypatch.setattr(cds_admin_queries, "slot_has_document", _fake_slot_has_document)
    monkeypatch.setattr(cds_admin_queries, "schools_by_ids", _fake_schools_by_ids)


class TestContentFreeUploadNeverAutoFillsWithoutEvidence:
    async def test_it_does_not_auto_fill_school_or_year(self, monkeypatch: Any) -> None:
        _patch_query_boundary(monkeypatch)
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool,
            object(),
            SimpleNamespace(model_cds_detect="google-vertex:fake-model"),
            user_id=_USER,
            batch_id=_BATCH,
            filename="blank.pdf",
            content=_content_free_pdf(),
        )

        assert row.school_id is None
        assert row.academic_year is None

    async def test_it_lands_on_needs_input_not_matched(self, monkeypatch: Any) -> None:
        """`matched` renders as the green "Ready" chip (DESIGN.md §2.3) --
        this row must never get there without a human confirming it."""
        _patch_query_boundary(monkeypatch)
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool,
            object(),
            SimpleNamespace(model_cds_detect="google-vertex:fake-model"),
            user_id=_USER,
            batch_id=_BATCH,
            filename="blank.pdf",
            content=_content_free_pdf(),
        )

        assert row.status == "needs_input"

    async def test_the_detected_guess_is_still_visible_to_the_admin(self, monkeypatch: Any) -> None:
        """Not silently discarded -- the admin can still see what the model
        guessed and why it wasn't trusted, via `detection.error`."""
        _patch_query_boundary(monkeypatch)
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool,
            object(),
            SimpleNamespace(model_cds_detect="google-vertex:fake-model"),
            user_id=_USER,
            batch_id=_BATCH,
            filename="blank.pdf",
            content=_content_free_pdf(),
        )

        assert row.detection.name == _HALLUCINATED_SCHOOL_NAME
        assert row.detection.confident is True
        assert row.detection.error is not None
        assert "does not look like a Common Data Set" in row.detection.error


class TestARealCdsTitledDocumentStillAutoFillsNormally:
    """The fix must not over-block a legitimate upload: a document whose
    first page actually claims to be a Common Data Set, with a confident
    catalog match, keeps auto-filling exactly as before."""

    async def test_it_still_auto_fills_and_reaches_matched(self, monkeypatch: Any) -> None:
        _patch_query_boundary(monkeypatch)
        app_pool = _FakePool()

        row = await service_ingest.create_upload(
            app_pool,
            object(),
            SimpleNamespace(model_cds_detect="google-vertex:fake-model"),
            user_id=_USER,
            batch_id=_BATCH,
            filename="berkeley_2022-2023.pdf",
            content=_cds_titled_pdf(),
        )

        assert row.school_id == _HALLUCINATED_SCHOOL_ID
        assert row.academic_year == 2023
        assert row.status == "matched"
        assert row.detection.error is None
