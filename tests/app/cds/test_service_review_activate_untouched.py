"""Regression tests for [A-01] / the CRITICAL fix to it: `_activate_untouched`
must publish a pending `active_update` correction (the feature's whole
purpose), never skip it just because *something* is active for that domain --
while still refusing to clobber a genuinely concurrent activation.

The old code skipped any domain with any active packet at all, which meant a
domain-scoped `active_update` correction -- whose corrected packet is always
inserted `is_active=false` and depends entirely on this function to go live
(nothing else in the codebase ever calls `activate_packet`) -- was silently
never published. The fix re-reads what is actually active, inside the write
transaction, and uses `created_at` order to tell a still-pending correction
(activate it) apart from a genuinely fresher concurrent write (refuse and let
the whole approve retry).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from adapters import cds_store
from adapters.cds_admin_types import DomainPacketSummary
from app.cds import service_review_approve
from app.cds.errors import CdsAdminConflictError

_DOCUMENT_ID = 42
_SNAPSHOT_EXTRACTION = uuid.uuid4()
_CONCURRENT_EXTRACTION = uuid.uuid4()
_BASE_TIME = datetime(2026, 8, 1, tzinfo=UTC)


def _domain_summary(
    domain_id: str, extraction_id: uuid.UUID, *, created_at: datetime
) -> DomainPacketSummary:
    return DomainPacketSummary(
        domain_id=domain_id,
        extraction_id=str(extraction_id),
        status="succeeded",
        is_active=True,
        created_at=created_at,
        counts={},
        metrics=[],
    )


class _FakeConn:
    def __init__(self, active_rows: list[dict[str, Any]]) -> None:
        self.active_rows = active_rows

    async def fetch(self, query: str, *params: Any) -> list[dict[str, Any]]:
        assert "is_active" in query
        return self.active_rows


def _patched_activate_packet(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def _activate_packet(conn: Any, **kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(cds_store, "activate_packet", _activate_packet)
    return calls


@pytest.mark.asyncio
async def test_activate_untouched_activates_a_never_active_domain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Case 1: nothing active yet -- the first-time candidate-approval path --
    must remain a real activation."""
    calls = _patched_activate_packet(monkeypatch)
    by_domain = {
        "admissions": _domain_summary("admissions", _SNAPSHOT_EXTRACTION, created_at=_BASE_TIME),
    }
    conn = _FakeConn([])  # nothing active yet

    await service_review_approve._activate_untouched(conn, _DOCUMENT_ID, by_domain, skip=set())

    assert calls == [
        {
            "document_id": _DOCUMENT_ID,
            "extraction_id": _SNAPSHOT_EXTRACTION,
            "domain_id": "admissions",
        }
    ]


@pytest.mark.asyncio
async def test_activate_untouched_no_ops_when_already_active(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Case 2: the active extraction already equals the snapshot's -- already
    published, nothing to do."""
    calls = _patched_activate_packet(monkeypatch)
    by_domain = {
        "admissions": _domain_summary("admissions", _SNAPSHOT_EXTRACTION, created_at=_BASE_TIME),
    }
    conn = _FakeConn(
        [
            {
                "domain_id": "admissions",
                "extraction_id": _SNAPSHOT_EXTRACTION,
                "created_at": _BASE_TIME,
            }
        ]
    )

    await service_review_approve._activate_untouched(conn, _DOCUMENT_ID, by_domain, skip=set())

    assert calls == []


@pytest.mark.asyncio
async def test_activate_untouched_publishes_a_pending_correction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Case 3a (differ, snapshot is newer): an `active_update` correction's
    packet -- newer than what's currently live -- must be activated. This is
    the CRITICAL bug: the old code saw "something is active" and skipped,
    which meant a correction's packet was never published."""
    calls = _patched_activate_packet(monkeypatch)
    snapshot_time = _BASE_TIME + timedelta(minutes=5)
    by_domain = {
        "admissions": _domain_summary(
            "admissions", _SNAPSHOT_EXTRACTION, created_at=snapshot_time
        ),
    }
    conn = _FakeConn(
        [
            {
                "domain_id": "admissions",
                "extraction_id": _CONCURRENT_EXTRACTION,
                "created_at": _BASE_TIME,
            }
        ]
    )

    await service_review_approve._activate_untouched(conn, _DOCUMENT_ID, by_domain, skip=set())

    assert calls == [
        {
            "document_id": _DOCUMENT_ID,
            "extraction_id": _SNAPSHOT_EXTRACTION,
            "domain_id": "admissions",
        }
    ]


@pytest.mark.asyncio
async def test_activate_untouched_refuses_a_concurrent_reactivation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Case 3b (differ, active is newer-or-equal): the original A-01 race --
    a concurrent write activated a fresher extraction than the snapshot knows
    about. Must refuse rather than reactivate the stale snapshot over it."""
    calls = _patched_activate_packet(monkeypatch)
    snapshot_time = _BASE_TIME
    by_domain = {
        "admissions": _domain_summary(
            "admissions", _SNAPSHOT_EXTRACTION, created_at=snapshot_time
        ),
    }
    conn = _FakeConn(
        [
            {
                "domain_id": "admissions",
                "extraction_id": _CONCURRENT_EXTRACTION,
                "created_at": _BASE_TIME + timedelta(minutes=5),
            }
        ]
    )

    with pytest.raises(CdsAdminConflictError):
        await service_review_approve._activate_untouched(conn, _DOCUMENT_ID, by_domain, skip=set())

    assert calls == []
