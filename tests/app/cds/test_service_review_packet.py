"""Unit tests for two honesty-critical, pure-ish pieces of
`app/cds/service_review.py`'s human-review write path (plan §B5, ADR 0036):

- `_human_reviewed_packet` must merge the domain's own model-derived
  `provider_contract` (metric definitions the review screen and validators
  both key off) with the new `human_review` audit block -- never replace one
  with the other. Regression for the bug where replacing it wholesale
  silently dropped every metric's title/description/unit/source_hints the
  moment an admin corrected even one value in the domain.
- `_clear_pending_edits` must delete exactly the snapshotted `metric_refs`
  when given, and everything for the document when omitted (`reject_document`'s
  case) -- never conflate "nothing was snapshotted" with "delete everything",
  or an admin's freshly-inserted edit (racing `approve_document`'s own
  snapshot) would be silently discarded with no error or trace.

No live database needed: `_human_reviewed_packet` only touches
`domain.cds.packet_build` (pure), and `_clear_pending_edits` is exercised
against a minimal fake pool that just records the SQL/params it was asked to
run, not a real `cds_pending_edits` table.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from app.cds.service_review import _clear_pending_edits, _human_reviewed_packet

_DOCUMENT_SHA_HEX = "ab" * 32


def _manifest() -> SimpleNamespace:
    content = {
        "domains": [
            {
                "id": "identity",
                "metrics": [{"id": "identity.applicants", "type": "integer", "unit": "count"}],
            }
        ]
    }
    return SimpleNamespace(
        content=content, domain_hashes={"identity": "hash-identity"}, version="1.0.0"
    )


def _document() -> SimpleNamespace:
    return SimpleNamespace(pdf_sha256=_DOCUMENT_SHA_HEX, academic_year=2025)


def _edit_row(**overrides: Any) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "metric_ref": "identity.applicants",
        "payload": {
            "value": 1300,
            "raw_value": "1,300",
            "availability_status": "reported",
            "evidence": {
                "page_number": 4, "excerpt": "corrected", "section": None,
                "row_label": None, "column_label": None,
            },
            "note": "typo fix",
        },
    }
    defaults.update(overrides)
    return defaults


def _base_metrics() -> dict[str, dict[str, Any]]:
    return {
        "identity.applicants": {
            "availability_status": "reported", "extraction_status": "verified",
            "value": 1200, "raw_value": "1,200",
            "evidence": {
                "page_number": 3, "excerpt": "prior", "section": None,
                "row_label": None, "column_label": None,
            },
            "diagnostic_code": None,
        }
    }


def _source_provider_contract() -> dict[str, Any]:
    return {
        "requested_domains": ("identity",),
        "allowed_metric_ids": ("identity.applicants",),
        "metric_definitions": [
            {
                "id": "identity",
                "title": "Identity",
                "metrics": [
                    {
                        "id": "identity.applicants", "type": "integer", "unit": "count",
                        "title": "Applicants", "source_hints": ["C1"],
                    },
                ],
            },
        ],
        "response_schema": {"fake": "schema"},
    }


def _build_packet(
    *, source_provider_contract: dict[str, Any] | None, note: str | None = "fix"
) -> dict[str, Any]:
    return _human_reviewed_packet(
        manifest=_manifest(), domain_id="identity", edit_rows=[_edit_row()],
        base_metrics=_base_metrics(), source_provider_contract=source_provider_contract,
        document=_document(), original_page_count=10, extraction_id="extraction-1",
        actor_user_id=uuid4(), base_extraction_id="extraction-0", note=note,
    )


class TestHumanReviewedPacketContractMerge:
    def test_keeps_the_models_metric_definitions_alongside_the_human_review_block(self) -> None:
        source = _source_provider_contract()
        packet = _build_packet(source_provider_contract=source)
        contract = packet["provider_contract"]
        assert contract["metric_definitions"] == source["metric_definitions"]
        assert contract["allowed_metric_ids"] == source["allowed_metric_ids"]
        assert contract["human_review"]["changed_refs"] == ["identity.applicants"]
        assert contract["human_review"]["note"] == "fix"

    def test_a_second_review_overwrites_the_stale_human_review_block_but_not_the_definitions(
        self,
    ) -> None:
        """A domain that was already human-reviewed once carries its own prior
        `human_review` block in `provider_contract` as `domain_summary.
        provider_contract` for the *next* review. That block must be replaced
        by the new review's own audit trail (never averaged/merged), while
        `metric_definitions` -- always the model's, never touched by any
        review -- survives both rounds unchanged."""
        source = _source_provider_contract()
        source["human_review"] = {
            "reviewer_user_id": "stale-reviewer", "note": "first fix",
            "changed_refs": ["identity.applicants"],
        }
        packet = _build_packet(source_provider_contract=source, note="second fix")
        contract = packet["provider_contract"]
        assert contract["metric_definitions"] == _source_provider_contract()["metric_definitions"]
        assert contract["human_review"]["note"] == "second fix"
        assert contract["human_review"]["reviewer_user_id"] != "stale-reviewer"

    def test_missing_source_contract_does_not_crash_and_still_carries_the_review_block(
        self,
    ) -> None:
        packet = _build_packet(source_provider_contract=None)
        contract = packet["provider_contract"]
        assert "metric_definitions" not in contract
        assert contract["human_review"]["note"] == "fix"


class _RecordingConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, *params: Any) -> None:
        self.calls.append((query, params))


class _AcquireCtx:
    def __init__(self, conn: _RecordingConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _RecordingConn:
        return self._conn

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _RecordingPool:
    def __init__(self) -> None:
        self.conn = _RecordingConn()

    def acquire(self) -> _AcquireCtx:
        return _AcquireCtx(self.conn)


class TestClearPendingEditsScoping:
    async def test_scoped_call_deletes_only_the_snapshotted_refs(self) -> None:
        pool = _RecordingPool()
        await _clear_pending_edits(pool, 42, metric_refs=["identity.applicants"])
        [(query, params)] = pool.conn.calls
        assert "metric_ref = ANY($2::text[])" in query
        assert params == (42, ["identity.applicants"])

    async def test_omitted_metric_refs_deletes_every_row_for_the_document(self) -> None:
        """`reject_document`'s case: the whole document is discarded, so an
        unscoped delete is correct -- there is nothing later that could ever
        apply a leftover edit."""
        pool = _RecordingPool()
        await _clear_pending_edits(pool, 42)
        [(query, params)] = pool.conn.calls
        assert "metric_ref" not in query
        assert params == (42,)

    async def test_empty_snapshot_deletes_nothing_not_everything(self) -> None:
        """The precise bug this scoping exists to avoid: an admin approving
        with zero pending edits of their own must never fall back to wiping
        the whole document's pending-edit table -- an empty snapshot means
        "nothing to clear", not "clear it all"."""
        pool = _RecordingPool()
        await _clear_pending_edits(pool, 42, metric_refs=[])
        [(query, params)] = pool.conn.calls
        assert "ANY($2::text[])" in query
        assert params == (42, [])
