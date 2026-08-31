"""Regression tests for the pending-edit generation stamp (migration 0016,
`app/cds/service_review._current_edits`) — the honesty rule that a correction
may only ever be shown, or applied, against the exact extraction it was
written against.

`approve_document` commits its packets on the pipeline pool (`cds_library_app`)
and only then clears `counselle.cds_pending_edits` on the app pool
(`counselle_app`). Neither role can see the other's schema, so those are two
transactions and there is a gap between them. A crash in that gap used to
leave rows describing a correction that was already live and serving, and
nothing bound those rows to the values they were authored against: the review
screen kept advertising them as `pending_edit` over the already-live value, and
the next approve after a rerun re-applied them on top of the freshly
re-extracted numbers, silently discarding what the model had just found. The
same orphan is reachable with no crash at all — `rerun_extraction` re-extracts
a domain without touching pending edits.

These tests pin all three halves of the fix: the stamp is written from the
server's own view of which packet the admin was editing, a superseded stamp is
never displayed, and a superseded stamp is never applied — while a
current-generation edit still is, both times.

No live database: `get_review`/`approve_document`/`save_metric_edits` are
driven against recording fake pools and a patched
`cds_admin_queries.get_document_review`, in the spirit of
`test_service_review_packet.py`'s fake-pool pattern.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from adapters import cds_admin_queries
from adapters.cds_admin_types import (
    DocumentMeta,
    DocumentReview,
    DomainPacketSummary,
    EvidenceRow,
    MetricRow,
)
from app.cds import manifest as manifest_mod
from app.cds import service_review
from app.cds.models import EvidenceIn, MetricEditIn

_DOCUMENT_ID = 42
_REF = "identity.applicants"
_DOMAIN = "identity"
_LIVE_EXTRACTION = "11111111-1111-1111-1111-111111111111"
_SUPERSEDED_EXTRACTION = "22222222-2222-2222-2222-222222222222"
_ACTOR = uuid.UUID("33333333-3333-3333-3333-333333333333")


# ---------------------------------------------------------------------------
# Fixtures: a one-domain, one-metric candidate document
# ---------------------------------------------------------------------------


def _review(*, extraction_id: str = _LIVE_EXTRACTION, value: int = 1200) -> DocumentReview:
    """The document as the pipeline pool reports it: one domain whose most
    recent packet came out of `extraction_id` and currently reads `value`."""
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


def _pending_row(*, base_extraction_id: str, value: int = 1300) -> dict[str, Any]:
    return {
        "metric_ref": _REF,
        "domain_id": _DOMAIN,
        "base_extraction_id": uuid.UUID(base_extraction_id),
        "payload": {
            "value": value,
            "raw_value": str(value),
            "availability_status": "reported",
            "evidence": {
                "page_number": 4, "excerpt": "corrected", "section": None,
                "row_label": None, "column_label": None,
            },
            "note": "typo fix",
        },
        "edited_by": _ACTOR,
        "edited_at": datetime(2026, 1, 2, tzinfo=UTC),
    }


class _FakeConn:
    """Records every statement it is asked to run. `fetch` replays the pending
    rows the test set up; `execute`/`fetchval` return the shapes the real
    callers check (`activate_packet` compares against `"UPDATE 0"`,
    `record_audit` casts the returned id to `int`)."""

    def __init__(self, pending: list[dict[str, Any]] | None = None) -> None:
        self.pending = pending or []
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

    async def fetchrow(self, query: str, *params: Any) -> None:
        self.calls.append((query, params))
        return None

    def transaction(self) -> _Ctx:
        return _Ctx(None)

    def statements(self, needle: str) -> list[tuple[str, tuple[Any, ...]]]:
        return [call for call in self.calls if needle in call[0]]


class _Ctx:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def __aenter__(self) -> Any:
        return self._value

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakePool:
    def __init__(self, pending: list[dict[str, Any]] | None = None) -> None:
        self.conn = _FakeConn(pending)

    def acquire(self) -> _Ctx:
        return _Ctx(self.conn)


def _patch_review(monkeypatch: Any, review: DocumentReview) -> None:
    async def _get_document_review(pool: Any, document_id: int) -> DocumentReview:
        return review

    monkeypatch.setattr(cds_admin_queries, "get_document_review", _get_document_review)


def _patch_manifest(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        manifest_mod,
        "load_compiled_manifest",
        lambda: SimpleNamespace(content={}, domain_hashes={_DOMAIN: "hash"}, version="1.0.0"),
    )


# ---------------------------------------------------------------------------
# get_review: a superseded edit is never advertised as pending
# ---------------------------------------------------------------------------


class TestReviewScreenHidesSupersededEdits:
    async def test_edit_from_a_superseded_extraction_is_not_shown_as_pending(
        self, monkeypatch: Any
    ) -> None:
        """The crash-orphan lie: the correction is already live in the current
        packet, so showing it as an unapplied `pending_edit` claims the review
        screen is out of date with the data being served. It isn't."""
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION))
        app_pool = _FakePool([_pending_row(base_extraction_id=_SUPERSEDED_EXTRACTION)])

        out = await service_review.get_review(
            _FakePool(), app_pool, document_id=_DOCUMENT_ID
        )

        assert out.sections[0].metrics[0].pending_edit is None

    async def test_edit_from_the_current_extraction_is_still_shown(
        self, monkeypatch: Any
    ) -> None:
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION))
        app_pool = _FakePool([_pending_row(base_extraction_id=_LIVE_EXTRACTION)])

        out = await service_review.get_review(
            _FakePool(), app_pool, document_id=_DOCUMENT_ID
        )

        pending_edit = out.sections[0].metrics[0].pending_edit
        assert pending_edit is not None
        assert pending_edit.value == 1300


# ---------------------------------------------------------------------------
# approve_document: a superseded edit is never applied
# ---------------------------------------------------------------------------


_NEW_EXTRACTION = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _record_applied(monkeypatch: Any) -> list[dict[str, list[dict[str, Any]]]]:
    """Stand in for the human-review write path (which would need the real PDF
    bytes and manifest) and capture exactly which edits an approve decided to
    build into a new human-review packet."""
    applied: list[dict[str, list[dict[str, Any]]]] = []

    async def _prepare(conn: Any, **kwargs: Any) -> service_review._EditedPackets:
        applied.append(dict(kwargs["edits_by_domain"]))
        return service_review._EditedPackets(_NEW_EXTRACTION, b"", ((_DOMAIN, {}, ()),))

    async def _write(conn: Any, **kwargs: Any) -> str:
        return str(kwargs["edited"].extraction_id)

    monkeypatch.setattr(service_review, "_prepare_edited_packets", _prepare)
    monkeypatch.setattr(service_review, "_write_edited_packets", _write)
    return applied


class TestApproveIgnoresSupersededEdits:
    async def test_superseded_edit_is_not_applied_over_the_current_packet(
        self, monkeypatch: Any
    ) -> None:
        """The resurrection chain: after a rerun re-extracts the domain, an
        orphaned edit written against the *previous* extraction must not
        silently overwrite what the model just found."""
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION, value=1250))
        _patch_manifest(monkeypatch)
        applied = _record_applied(monkeypatch)
        app_pool = _FakePool([_pending_row(base_extraction_id=_SUPERSEDED_EXTRACTION)])

        result = await service_review.approve_document(
            app_pool, _FakePool(), SimpleNamespace(), document_id=_DOCUMENT_ID,
            actor_user_id=_ACTOR, override_flags=False, note=None,
        )

        assert applied == []
        assert result.extraction_id is None

    async def test_current_edit_is_still_applied(self, monkeypatch: Any) -> None:
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION))
        _patch_manifest(monkeypatch)
        applied = _record_applied(monkeypatch)
        app_pool = _FakePool([_pending_row(base_extraction_id=_LIVE_EXTRACTION)])

        result = await service_review.approve_document(
            app_pool, _FakePool(), SimpleNamespace(), document_id=_DOCUMENT_ID,
            actor_user_id=_ACTOR, override_flags=False, note=None,
        )

        assert [row["metric_ref"] for row in applied[0][_DOMAIN]] == [_REF]
        assert result.extraction_id == "44444444-4444-4444-4444-444444444444"

    async def test_superseded_rows_are_swept_not_left_to_accumulate(
        self, monkeypatch: Any
    ) -> None:
        """Ignoring an orphan is not enough on its own — it must also stop
        existing, or every future approve pays to filter it again. The closing
        delete is scoped to every row the approve *read*, not only the ones it
        applied."""
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION))
        _patch_manifest(monkeypatch)
        _record_applied(monkeypatch)
        app_pool = _FakePool([_pending_row(base_extraction_id=_SUPERSEDED_EXTRACTION)])

        await service_review.approve_document(
            app_pool, _FakePool(), SimpleNamespace(), document_id=_DOCUMENT_ID,
            actor_user_id=_ACTOR, override_flags=False, note=None,
        )

        [(_query, params)] = app_pool.conn.statements("DELETE FROM counselle.cds_pending_edits")
        assert params == (_DOCUMENT_ID, [_REF])


# ---------------------------------------------------------------------------
# save_metric_edits: the stamp comes from the server, not the client
# ---------------------------------------------------------------------------


class TestSavedEditCarriesItsGeneration:
    async def test_edit_is_stamped_with_the_domains_current_extraction(
        self, monkeypatch: Any
    ) -> None:
        """And with the domain the ref actually belongs to — the client's own
        `domain_id` is advisory, so a wrong one can never file an edit under a
        generation it was not written against."""
        _patch_review(monkeypatch, _review(extraction_id=_LIVE_EXTRACTION))
        app_pool = _FakePool([])

        await service_review.save_metric_edits(
            app_pool, _FakePool(), document_id=_DOCUMENT_ID, actor_user_id=_ACTOR,
            edits=[
                MetricEditIn(
                    metric_ref=_REF, domain_id="a-lie", availability_status="reported",
                    value=1300, raw_value="1,300",
                    evidence=EvidenceIn(page_number=4, excerpt="corrected"),
                )
            ],
        )

        [(_query, params)] = app_pool.conn.statements("INSERT INTO counselle.cds_pending_edits")
        assert params[2] == _DOMAIN
        assert params[3] == uuid.UUID(_LIVE_EXTRACTION)
