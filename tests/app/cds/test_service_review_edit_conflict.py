"""Regression test for R-02: a rerun that commits mid-save must not return a
silent 200 that drops the admin's edit.

`save_metric_edits` reads the document (and with it, the domain's current
`extraction_id`) once, before its transaction opens, and stamps every edit
with that id (migration 0016, see `test_service_review_edit_generation.py`).
If `rerun_extraction` commits a new packet for the same domain in the window
between that read and the edit's commit, the freshly-committed edit is
already superseded, and `_current_edits` correctly drops it from the review
built right after (`get_review`, called at the end of `save_metric_edits`).
Before this fix that meant a 200 whose body silently no longer contains the
edit the admin just saved. This pins the honest alternative: a named 409.

No live database: driven against a fake pool and a `get_document_review`
stub that changes its answer between calls, in the spirit of
`test_service_review_edit_generation.py`'s fake-pool pattern -- that is
exactly what simulates the rerun landing in the gap.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from adapters import cds_admin_queries
from adapters.cds_admin_types import (
    DocumentMeta,
    DocumentReview,
    DomainPacketSummary,
    EvidenceRow,
    MetricRow,
)
from app.cds import service_review
from app.cds.errors import CdsAdminConflictError
from app.cds.models import EvidenceIn, MetricEditIn

_DOCUMENT_ID = 42
_REF = "identity.applicants"
_DOMAIN = "identity"
_BEFORE_RERUN = "11111111-1111-1111-1111-111111111111"
_AFTER_RERUN = "22222222-2222-2222-2222-222222222222"
_ACTOR = uuid.UUID("33333333-3333-3333-3333-333333333333")


def _review(*, extraction_id: str, value: int = 1200) -> DocumentReview:
    return DocumentReview(
        document=DocumentMeta(
            id=_DOCUMENT_ID, school_year_id=7, school_id=3, school_name="Test College",
            academic_year=2025, pdf_sha256="ab" * 32, pdf_size_bytes=1024,
            original_filename="cds.pdf", source_kind="upload",
            retrieved_at=datetime(2026, 1, 1, tzinfo=UTC), invalidated_at=None,
            superseded_at=None, is_candidate=True, is_active=False,
        ),
        extractions=[],
        domains=[
            DomainPacketSummary(
                domain_id=_DOMAIN, extraction_id=extraction_id, status="complete",
                is_active=False, created_at=datetime(2026, 1, 1, tzinfo=UTC),
                counts={"verified": 1},
                metrics=[
                    MetricRow(
                        ref=_REF, extraction_status="verified", availability_status="reported",
                        value=value, raw_value=str(value),
                        evidence=EvidenceRow(page_number=3, excerpt="from the model"),
                    )
                ],
                provider_contract={
                    "metric_definitions": [
                        {
                            "id": _DOMAIN, "title": "Identity",
                            "metrics": [{"id": _REF, "type": "integer", "source_hints": ["C1"]}],
                        }
                    ]
                },
            )
        ],
    )


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeConn:
    """A real-enough `counselle.cds_pending_edits` table for this one test:
    the INSERT `save_metric_edits` issues is captured and replayed by the
    SELECT `_pending_edits` issues right after -- exactly what makes the
    edit visible (or not) to the `get_review` call at the end of
    `save_metric_edits`."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.pending_edits: dict[str, dict[str, Any]] = {}

    async def fetch(self, query: str, *params: Any) -> list[dict[str, Any]]:
        self.calls.append((query, params))
        if "FROM counselle.cds_pending_edits" in query:
            return list(self.pending_edits.values())
        return []

    async def execute(self, query: str, *params: Any) -> str:
        self.calls.append((query, params))
        if "INSERT INTO counselle.cds_pending_edits" in query:
            document_id, metric_ref, domain_id, base_extraction_id, payload, edited_by = params
            self.pending_edits[metric_ref] = {
                "metric_ref": metric_ref, "domain_id": domain_id,
                "base_extraction_id": base_extraction_id, "payload": payload,
                "edited_by": edited_by, "edited_at": datetime(2026, 1, 2, tzinfo=UTC),
            }
        return "UPDATE 1"

    async def fetchval(self, query: str, *params: Any) -> int:
        self.calls.append((query, params))
        return 1

    def transaction(self) -> _Ctx:
        return _Ctx(None)


class _FakePool:
    def __init__(self) -> None:
        self.conn = _FakeConn()

    def acquire(self) -> _Ctx:
        return _Ctx(self.conn)


def _edit(value: int = 1300) -> MetricEditIn:
    return MetricEditIn(
        metric_ref=_REF, domain_id=_DOMAIN, availability_status="reported",
        value=value, raw_value=str(value),
        evidence=EvidenceIn(page_number=4, excerpt="corrected"),
    )


class TestSaveMetricEditsDetectsAMidSaveRerun:
    async def test_a_rerun_that_commits_mid_save_raises_a_named_conflict(
        self, monkeypatch: Any
    ) -> None:
        """The exact race: `save_metric_edits` reads the document once (still
        `_BEFORE_RERUN`), then a rerun lands and moves the domain's current
        packet to `_AFTER_RERUN` before the edit's transaction commits. The
        stamp written is already stale by the time it lands -- this must
        surface as a 409 naming the ref, not a 200 that just quietly drops
        it."""
        calls = {"n": 0}

        async def _get_document_review(pool: Any, document_id: int) -> DocumentReview:
            calls["n"] += 1
            # First call: the read `save_metric_edits` stamps edits from.
            # Every call after: the rerun has already landed, so the domain's
            # current packet -- and the review built at the end of
            # `save_metric_edits` -- reflect the new generation.
            extraction_id = _BEFORE_RERUN if calls["n"] == 1 else _AFTER_RERUN
            return _review(extraction_id=extraction_id)

        monkeypatch.setattr(cds_admin_queries, "get_document_review", _get_document_review)
        app_pool = _FakePool()

        with pytest.raises(CdsAdminConflictError) as exc_info:
            await service_review.save_metric_edits(
                app_pool, _FakePool(), document_id=_DOCUMENT_ID, actor_user_id=_ACTOR,
                edits=[_edit()],
            )

        assert _REF in str(exc_info.value)

    async def test_no_concurrent_rerun_saves_normally(self, monkeypatch: Any) -> None:
        """Control: with no rerun in the window, the edit is stamped against
        the same generation `get_review` reads back, so it must still show up
        as pending and no conflict is raised."""

        async def _get_document_review(pool: Any, document_id: int) -> DocumentReview:
            return _review(extraction_id=_BEFORE_RERUN)

        monkeypatch.setattr(cds_admin_queries, "get_document_review", _get_document_review)
        app_pool = _FakePool()

        out = await service_review.save_metric_edits(
            app_pool, _FakePool(), document_id=_DOCUMENT_ID, actor_user_id=_ACTOR,
            edits=[_edit()],
        )

        pending_edit = out.sections[0].metrics[0].pending_edit
        assert pending_edit is not None
        assert pending_edit.value == 1300
