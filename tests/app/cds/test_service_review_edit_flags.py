"""Regression tests for the approve gate over an admin's *own* corrections
(`app/cds/service_review_approve.py::_prepare_edited_packets`).

`approve_document` computes its blocking gate from `_flags_summary` over the
packets the document already has -- values the model extracted. A human-review
approve then synthesizes brand-new packets from the pending edits. Those two
facts used to be sequential and unconnected: the gate passed on the pre-edit
flags, the new packets were built, validated, inserted and activated, and the
flags their own values produced were written to `cds_domain_packets.validation`
as inert JSON. An admin who mistyped a `unit: percent` metric as `150` on a
document with no other unresolved flag shipped `150%` to students, with the
`denominator_sanity` error recorded on a packet nobody had a reason to reopen.

These tests pin the fix from both sides: an edit that produces a blocking flag
refuses the whole approve *and writes nothing at all* (no extraction row, no
packet, no activation, and the pending edits survive so the admin can fix
them), while `override_flags=true` -- the same escape hatch the pre-edit gate
already uses -- still lets a deliberate admin through, recorded as an override.
The non-blocking tiers stay non-blocking: a `warning` never refuses an approve
on its own, matching `_flags_summary`'s error-only `unresolved` semantics.

No live database: the pipeline/app pools are the fake-pool pattern from
`test_service_review_edit_generation.py`, and the PDF/store reads
`_prepare_edited_packets` makes are patched out. Packet building and validation
are the real thing -- they are what is under test.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from adapters import cds_admin_queries, cds_pdf, cds_store
from adapters.cds_admin_types import (
    DocumentMeta,
    DocumentReview,
    DomainPacketSummary,
    EvidenceRow,
    MetricRow,
)
from app.cds import manifest as manifest_mod
from app.cds import service_review_approve
from app.cds.errors import CdsAdminConflictError
from app.cds.models import ApproveResult

_DOCUMENT_ID = 42
_DOMAIN = "class_profile"
_PERCENT_REF = "class_profile.sat_submitters_percent"
_COUNT_REF = "class_profile.enrolled_total"
_LIVE_EXTRACTION = "11111111-1111-1111-1111-111111111111"
_ACTOR = uuid.UUID("33333333-3333-3333-3333-333333333333")

# The two metric shapes the manifest actually uses for these units: a percent
# is a printed string ("<1%" has to survive), a headcount is an integer.
_METRIC_DEFINITIONS = [
    {
        "id": _DOMAIN,
        "title": "Class profile",
        "metrics": [
            {"id": _PERCENT_REF, "type": "string", "unit": "percent", "source_hints": ["C9"]},
            {"id": _COUNT_REF, "type": "integer", "unit": "students", "source_hints": ["C1"]},
        ],
    }
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _review() -> DocumentReview:
    """A clean candidate document: both metrics extracted, no flags at all, so
    the pre-edit `_flags_summary` gate has nothing to say about this approve."""
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
                domain_id=_DOMAIN, extraction_id=_LIVE_EXTRACTION, status="complete",
                is_active=False, created_at=datetime(2026, 1, 1, tzinfo=UTC),
                counts={"verified": 2},
                metrics=[
                    MetricRow(
                        ref=_PERCENT_REF, extraction_status="verified",
                        availability_status="reported", value="72%", raw_value="72%",
                        evidence=EvidenceRow(page_number=3, excerpt="72%"),
                    ),
                    MetricRow(
                        ref=_COUNT_REF, extraction_status="verified",
                        availability_status="reported", value=1650, raw_value="1,650",
                        evidence=EvidenceRow(page_number=3, excerpt="1,650"),
                    ),
                ],
                provider_contract={"metric_definitions": _METRIC_DEFINITIONS},
            )
        ],
    )


def _pending_row(*, metric_ref: str, value: Any, raw_value: str) -> dict[str, Any]:
    return {
        "metric_ref": metric_ref,
        "domain_id": _DOMAIN,
        "base_extraction_id": uuid.UUID(_LIVE_EXTRACTION),
        "payload": {
            "value": value,
            "raw_value": raw_value,
            "availability_status": "reported",
            "evidence": {
                "page_number": 3, "excerpt": raw_value, "section": None,
                "row_label": None, "column_label": None,
            },
            "note": "typo fix",
        },
        "edited_by": _ACTOR,
        "edited_at": datetime(2026, 1, 2, tzinfo=UTC),
    }


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeConn:
    def __init__(self, pending: list[dict[str, Any]]) -> None:
        self.pending = pending
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetch(self, query: str, *params: Any) -> list[dict[str, Any]]:
        self.calls.append((query, params))
        return self.pending

    async def execute(self, query: str, *params: Any) -> str:
        self.calls.append((query, params))
        return "UPDATE 1"

    async def fetchval(self, query: str, *params: Any) -> int:
        self.calls.append((query, params))
        return 1

    def transaction(self) -> _Ctx:
        return _Ctx(None)

    def statements(self, needle: str) -> list[tuple[str, tuple[Any, ...]]]:
        return [call for call in self.calls if needle in call[0]]


class _FakePool:
    def __init__(self, pending: list[dict[str, Any]] | None = None) -> None:
        self.conn = _FakeConn(pending or [])

    def acquire(self) -> _Ctx:
        return _Ctx(self.conn)


def _patch_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    """Everything `approve_document` reads on its way to building the new
    packets -- the review row, the compiled manifest, and the PDF facts the
    validators check against."""
    async def _get_document_review(pool: Any, document_id: int) -> DocumentReview:
        return _review()

    monkeypatch.setattr(cds_admin_queries, "get_document_review", _get_document_review)
    monkeypatch.setattr(
        manifest_mod,
        "load_compiled_manifest",
        lambda: SimpleNamespace(
            content={"domains": _METRIC_DEFINITIONS},
            domain_hashes={_DOMAIN: "cd" * 32},
            version="1.0.0",
        ),
    )

    async def _fetch_document(conn: Any, *, document_id: int) -> SimpleNamespace:
        return SimpleNamespace(pdf_content=b"%PDF-1.4", pdf_sha256=bytes.fromhex("ab" * 32))

    monkeypatch.setattr(cds_store, "fetch_document_for_extraction", _fetch_document)

    async def _page_count(pdf_bytes: bytes) -> int:
        return 10

    async def _corrupt(pdf_bytes: bytes) -> Any:
        return SimpleNamespace(is_corrupt=False)

    async def _routing_text(pdf_bytes: bytes, page_numbers: Any = None) -> dict[int, str]:
        # The excerpts every edit below cites, so `excerpt_on_cited_page` stays
        # quiet and each test isolates exactly the flag it is about.
        return {3: "72% 1,650 150% -50"}

    monkeypatch.setattr(cds_pdf, "get_page_count", _page_count)
    monkeypatch.setattr(cds_pdf, "detect_corrupt_text_layer", _corrupt)
    monkeypatch.setattr(cds_pdf, "extract_routing_text", _routing_text)


def _patch_writes(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record every write the human-review path would make, so a refused
    approve can be asserted to have made none of them."""
    writes: list[str] = []

    async def _create_extraction(conn: Any, **kwargs: Any) -> SimpleNamespace:
        writes.append("create_human_review_extraction")
        return SimpleNamespace(id=kwargs.get("extraction_id") or uuid.uuid4())

    async def _insert_packet(conn: Any, **kwargs: Any) -> None:
        writes.append("insert_packet")

    async def _activate_packet(conn: Any, **kwargs: Any) -> None:
        writes.append("activate_packet")

    async def _promote(conn: Any, **kwargs: Any) -> None:
        writes.append("promote_candidate_document")

    async def _close_updates(conn: Any, **kwargs: Any) -> None:
        writes.append("close_pending_active_updates")

    monkeypatch.setattr(cds_store, "create_human_review_extraction", _create_extraction)
    monkeypatch.setattr(cds_store, "insert_packet", _insert_packet)
    monkeypatch.setattr(cds_store, "activate_packet", _activate_packet)
    monkeypatch.setattr(cds_store, "promote_candidate_document", _promote)
    monkeypatch.setattr(cds_store, "close_pending_active_updates", _close_updates)
    return writes


async def _approve(
    app_pool: _FakePool, *, override_flags: bool = False
) -> ApproveResult:
    return await service_review_approve.approve_document(
        app_pool, _FakePool(), SimpleNamespace(), document_id=_DOCUMENT_ID,
        actor_user_id=_ACTOR, override_flags=override_flags, note=None,
    )


# ---------------------------------------------------------------------------
# An edit's own error-severity flag blocks the approve that generated it
# ---------------------------------------------------------------------------


class TestEditFlagsBlockTheirOwnApprove:
    async def test_out_of_range_percent_edit_refuses_the_approve(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The headline case: nothing was flagged before the edit, so the
        pre-edit gate is silent, and the edit itself is what makes the packet
        wrong. Approving it used to serve `150%` to students."""
        _patch_reads(monkeypatch)
        _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="150%",
                                           raw_value="150%")])

        with pytest.raises(CdsAdminConflictError) as excinfo:
            await _approve(app_pool)

        assert "outside the valid 0-100 range" in str(excinfo.value)
        assert "override_flags=true" in str(excinfo.value)

    async def test_a_refused_approve_writes_absolutely_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Refusing after a partial write would be worse than not refusing:
        a stranded extraction row, or a packet inserted but never activated,
        wedges the document for the next admin. The gate runs before the write
        transaction opens, so there is nothing to unwind."""
        _patch_reads(monkeypatch)
        writes = _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="150%",
                                           raw_value="150%")])

        with pytest.raises(CdsAdminConflictError):
            await _approve(app_pool)

        assert writes == []

    async def test_a_refused_approve_keeps_the_pending_edits(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The admin has to be able to correct the value they just mistyped."""
        _patch_reads(monkeypatch)
        _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="150%",
                                           raw_value="150%")])

        with pytest.raises(CdsAdminConflictError):
            await _approve(app_pool)

        assert app_pool.conn.statements("DELETE FROM counselle.cds_pending_edits") == []

    async def test_negative_count_edit_refuses_the_approve(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A fat-fingered `-50` enrolled headcount produced zero flags before
        `_negative_count_flags` existed -- not even a warning."""
        _patch_reads(monkeypatch)
        _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_COUNT_REF, value=-50, raw_value="-50")])

        with pytest.raises(CdsAdminConflictError) as excinfo:
            await _approve(app_pool)

        assert "a count cannot be below zero" in str(excinfo.value)


# ---------------------------------------------------------------------------
# The escape hatch, and what must NOT be blocked
# ---------------------------------------------------------------------------


class TestOverrideAndNonBlockingCases:
    async def test_override_flags_lets_the_same_edit_through(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One escape hatch, not two: the flag an edit generates is overridden
        by exactly the same `override_flags` an admin already uses for the
        pre-edit ones."""
        _patch_reads(monkeypatch)
        writes = _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="150%",
                                           raw_value="150%")])

        result = await _approve(app_pool, override_flags=True)

        assert result.extraction_id is not None
        assert "insert_packet" in writes and "activate_packet" in writes

    async def test_an_override_is_recorded_as_an_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The document had no pre-edit unresolved flag, so `flags_summary`
        alone would have logged this as a plain `approve` -- an audit trail
        that quietly loses the fact that a human waved a blocking error
        through."""
        _patch_reads(monkeypatch)
        _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="150%",
                                           raw_value="150%")])

        await _approve(app_pool, override_flags=True)

        [(_query, params)] = app_pool.conn.statements("INSERT INTO counselle.cds_admin_audit")
        assert params[1] == "approve_override"
        assert params[6]["overridden_edit_flags"] == 1

    async def test_a_clean_edit_still_approves(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The gate must not become a tax on ordinary corrections."""
        _patch_reads(monkeypatch)
        writes = _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="74%",
                                           raw_value="74%")])

        result = await _approve(app_pool)

        assert result.extraction_id is not None
        assert "insert_packet" in writes

    async def test_a_clean_approve_is_not_logged_as_an_override(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_reads(monkeypatch)
        _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="74%",
                                           raw_value="74%")])

        await _approve(app_pool)

        [(_query, params)] = app_pool.conn.statements("INSERT INTO counselle.cds_admin_audit")
        assert params[1] == "approve"
        assert params[6]["overridden_edit_flags"] == 0

    async def test_a_warning_severity_flag_does_not_block(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`_flags_summary.unresolved` is error-only by design (flag-precision
        .md's measured false-alarm rate). This gate has to mean the same thing:
        an excerpt the text layer cannot confirm is a `warning`, it stays
        visible on the packet, and it never refuses an approve by itself."""
        _patch_reads(monkeypatch)
        writes = _patch_writes(monkeypatch)
        app_pool = _FakePool([_pending_row(metric_ref=_PERCENT_REF, value="74%",
                                           raw_value="nowhere near this page")])

        result = await _approve(app_pool)

        assert result.extraction_id is not None
        assert "insert_packet" in writes
