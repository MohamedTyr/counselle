"""Regression tests for R-01: the review header must not attribute
mixed-generation data to a single extraction.

`app/cds/service_review._select_header_extraction` is pure, so its selection
rule (only extractions a domain's *current* packet actually came from are
eligible; more than one distinct id is "mixed") is pinned directly. The
`get_review` tests below then confirm the wire shape actually carries that
through: a single-extraction document renders exactly as before (no
behaviour change in the common case), and a mixed one nulls `model_id` and
sets `is_mixed_generation` rather than naming one run's identity for data
that isn't all its own.

No live database: `get_review` is driven against a fake pool and a patched
`cds_admin_queries.get_document_review`, in the spirit of
`test_service_review_edit_generation.py`'s fake-pool pattern.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from adapters import cds_admin_queries
from adapters.cds_admin_types import (
    DocumentMeta,
    DocumentReview,
    DomainPacketSummary,
    ExtractionRow,
)
from app.cds import service_review
from app.cds.service_review import _select_header_extraction

_E1 = "11111111-1111-1111-1111-111111111111"
_E2 = "22222222-2222-2222-2222-222222222222"


def _extraction(
    *,
    extraction_id: str,
    status: str = "succeeded",
    model_id: str = "model-a",
    queued_at: datetime,
    finished_at: datetime | None = None,
) -> ExtractionRow:
    return ExtractionRow(
        id=extraction_id, document_id=42, target_kind="full_reextract", status=status,
        requested_domains=["identity"], extractor_version="1", model_id=model_id,
        queued_at=queued_at, started_at=None, finished_at=finished_at, error_code=None,
        error_message=None, progress={},
    )


def _domain(*, domain_id: str, extraction_id: str) -> DomainPacketSummary:
    return DomainPacketSummary(
        domain_id=domain_id, extraction_id=extraction_id, status="complete",
        is_active=False, created_at=datetime(2026, 1, 1, tzinfo=UTC), counts={"verified": 1},
        metrics=[],
    )


class TestSelectHeaderExtraction:
    def test_single_shared_extraction_is_not_mixed(self) -> None:
        e1 = _extraction(extraction_id=_E1, queued_at=datetime(2026, 1, 1, tzinfo=UTC))
        domains = [
            _domain(domain_id="identity", extraction_id=_E1),
            _domain(domain_id="admission", extraction_id=_E1),
        ]

        extraction, is_mixed = _select_header_extraction(domains, [e1])

        assert extraction is not None
        assert extraction.id == _E1
        assert is_mixed is False

    def test_domains_from_two_extractions_is_mixed(self) -> None:
        """The exact failure scenario: 12 domains on E1, one rerun (E2) on
        `admission`. The old `extractions[0]` would have picked whichever was
        queued most recently regardless of which domains it actually
        produced -- this must instead recognize both are in play."""
        e1 = _extraction(
            extraction_id=_E1, model_id="model-a", queued_at=datetime(2026, 1, 1, tzinfo=UTC)
        )
        e2 = _extraction(
            extraction_id=_E2, model_id="model-b", queued_at=datetime(2026, 1, 2, tzinfo=UTC)
        )
        domains = [
            _domain(domain_id="identity", extraction_id=_E1),
            _domain(domain_id="admission", extraction_id=_E2),
        ]

        extraction, is_mixed = _select_header_extraction(domains, [e2, e1])

        assert is_mixed is True
        assert extraction is not None
        assert extraction.id in (_E1, _E2)

    def test_prefers_the_non_terminal_contributing_extraction(self) -> None:
        """A still-running rerun on one domain must drive the header's
        status -- `document-status.ts` / `ReviewHeader.tsx` derive
        "processing" from exactly this field, non-terminal-first, regardless
        of any document-level flag."""
        e1 = _extraction(
            extraction_id=_E1, status="succeeded", queued_at=datetime(2026, 1, 1, tzinfo=UTC)
        )
        e2 = _extraction(
            extraction_id=_E2, status="running", queued_at=datetime(2026, 1, 2, tzinfo=UTC)
        )
        domains = [
            _domain(domain_id="identity", extraction_id=_E1),
            _domain(domain_id="admission", extraction_id=_E2),
        ]

        extraction, is_mixed = _select_header_extraction(domains, [e2, e1])

        assert is_mixed is True
        assert extraction is not None
        assert extraction.id == _E2
        assert extraction.status == "running"

    def test_no_domains_yet_falls_back_to_the_most_recent_extraction(self) -> None:
        """A document's very first extraction hasn't finished a single
        domain -- nothing has been attributed to anything yet, so showing
        the most recently queued extraction (the old behaviour) cannot
        misrepresent any domain's data."""
        e1 = _extraction(
            extraction_id=_E1, status="running", queued_at=datetime(2026, 1, 1, tzinfo=UTC)
        )

        extraction, is_mixed = _select_header_extraction([], [e1])

        assert extraction is not None
        assert extraction.id == _E1
        assert is_mixed is False

    def test_no_extractions_at_all_returns_none(self) -> None:
        assert _select_header_extraction([], []) == (None, False)


# ---------------------------------------------------------------------------
# get_review: the wire shape actually reflects the selection above
# ---------------------------------------------------------------------------


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeConn:
    async def fetch(self, query: str, *params: Any) -> list[dict[str, Any]]:
        return []

    async def fetchval(self, query: str, *params: Any) -> None:
        return None


class _FakePool:
    def acquire(self) -> _Ctx:
        return _Ctx(_FakeConn())


def _document() -> DocumentMeta:
    return DocumentMeta(
        id=42, school_year_id=7, school_id=3, school_name="Test College", academic_year=2025,
        pdf_sha256="ab" * 32, pdf_size_bytes=1024, original_filename="cds.pdf",
        source_kind="upload", retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
        invalidated_at=None, superseded_at=None, is_candidate=True, is_active=False,
    )


def _patch_review(monkeypatch: Any, review: DocumentReview) -> None:
    async def _get_document_review(pool: Any, document_id: int) -> DocumentReview:
        return review

    monkeypatch.setattr(cds_admin_queries, "get_document_review", _get_document_review)


class TestGetReviewHeaderShape:
    async def test_single_extraction_header_is_unchanged(self, monkeypatch: Any) -> None:
        e1 = _extraction(
            extraction_id=_E1, model_id="model-a", queued_at=datetime(2026, 1, 1, tzinfo=UTC)
        )
        review = DocumentReview(
            document=_document(),
            extractions=[e1],
            domains=[
                _domain(domain_id="identity", extraction_id=_E1),
                _domain(domain_id="admission", extraction_id=_E1),
            ],
        )
        _patch_review(monkeypatch, review)

        out = await service_review.get_review(_FakePool(), _FakePool(), document_id=42)

        assert out.extraction is not None
        assert out.extraction.id == _E1
        assert out.extraction.model_id == "model-a"
        assert out.extraction.is_mixed_generation is False
        assert out.extraction.counts == {"verified": 2}

    async def test_mixed_extractions_null_the_model_and_flag_the_header(
        self, monkeypatch: Any
    ) -> None:
        e1 = _extraction(
            extraction_id=_E1, model_id="model-a", queued_at=datetime(2026, 1, 1, tzinfo=UTC),
            finished_at=datetime(2026, 1, 1, 1, tzinfo=UTC),
        )
        e2 = _extraction(
            extraction_id=_E2, model_id="model-b", queued_at=datetime(2026, 1, 2, tzinfo=UTC),
            finished_at=datetime(2026, 1, 2, 1, tzinfo=UTC),
        )
        review = DocumentReview(
            document=_document(),
            extractions=[e2, e1],
            domains=[
                _domain(domain_id="identity", extraction_id=_E1),
                _domain(domain_id="admission", extraction_id=_E2),
            ],
        )
        _patch_review(monkeypatch, review)

        out = await service_review.get_review(_FakePool(), _FakePool(), document_id=42)

        assert out.extraction is not None
        # R-01 follow-up: every field that would name a single run's
        # identity is nulled when mixed, not just `model_id` -- these fields
        # describe one run's version/finish-time/error and would misattribute
        # data from the other contributing run just as badly.
        assert out.extraction.model_id is None
        assert out.extraction.extractor_version is None
        assert out.extraction.finished_at is None
        assert out.extraction.error_code is None
        assert out.extraction.is_mixed_generation is True
        # `id` and `status` still name the primary (non-terminal-first, else
        # most-recently-queued) contributing run -- `status` must, to drive
        # the header's processing/failed chip, and `id` is just a reference
        # to that same run, not a claim about the mixed data.
        assert out.extraction.id in (_E1, _E2)
        # The count claim across both domains survives -- only the "one
        # named run produced it" attribution is what's withdrawn.
        assert out.extraction.counts == {"verified": 2}
