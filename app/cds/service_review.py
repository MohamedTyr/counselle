"""The review screen's read model and metric-level edits (plan §B1
`app/cds/service_review.py`).

The `sections`/`metrics` shape is assembled from three sources: P3's
per-domain packet summaries (`adapters/cds_admin_queries.get_document_review`),
each packet's own embedded `provider_contract.metric_definitions` (the exact
manifest contract that run's claims were made against -- self-describing, so
this never depends on today's live manifest matching a past extraction), and
`counselle.cds_pending_edits` (uncommitted admin corrections).

The approve/reject/rerun endpoints (#12-#14) -- the human-review packet build,
its validation gate, and the transactional write -- live alongside each other
in `app/cds/service_review_approve.py`, which imports the pending-edit and
flags-summary helpers below.
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from typing import Any
from uuid import UUID

import asyncpg
import structlog

from adapters import cds_admin_queries, cds_store
from adapters.cds_admin_types import (
    DocumentMeta,
    DomainPacketSummary,
    EvidenceRow,
    ExtractionRow,
    MetricRow,
)
from app.cds import audit
from app.cds.errors import CdsAdminConflictError, CdsAdminNotFoundError, CdsAdminValidationError
from app.cds.models import (
    DocumentReviewOut,
    FlagsSummary,
    MetricEditIn,
    PendingEditOut,
    ReviewExtraction,
    ReviewFlagOut,
    ReviewMetric,
    ReviewSection,
)
from counselle_db.formatting import format_decimal

logger = structlog.get_logger(__name__)

_HINT_RE = re.compile(r"^([A-Za-z]+)-?(\d*)")


async def _pending_active_update_id(
    pipeline_pool: asyncpg.Pool, document_id: int
) -> UUID | None:
    async with pipeline_pool.acquire() as conn:
        return await cds_store.find_pending_active_update(conn, document_id=document_id)


async def _require_reviewable(
    pipeline_pool: asyncpg.Pool, document: DocumentMeta, document_id: int, *, action: str
) -> UUID | None:
    """The broadened document-level gate (SHIP-PLAN §2.1): admissible either
    as an ordinary candidate document (returns `None`, the pre-existing
    behaviour), or as an already-active document with a still-pending
    `active_update` correction (returns that extraction's id). Raises
    otherwise -- e.g. an active document with nothing pending, or an
    invalidated one."""
    if document.is_candidate:
        return None
    if document.is_active:
        pending_id = await _pending_active_update_id(pipeline_pool, document_id)
        if pending_id is not None:
            return pending_id
    raise CdsAdminValidationError(
        f"document is not a candidate and has no pending correction to {action}"
    )


# ---------------------------------------------------------------------------
# Read model (endpoint #9)
# ---------------------------------------------------------------------------


async def _pending_edits(app_pool: asyncpg.Pool, document_id: int) -> dict[str, dict[str, Any]]:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT metric_ref, domain_id, base_extraction_id, payload, edited_by, edited_at "
            "FROM counselle.cds_pending_edits WHERE document_id = $1",
            document_id,
        )
    return {row["metric_ref"]: dict(row) for row in rows}


def _current_edits(
    pending: dict[str, dict[str, Any]], domains: list[DomainPacketSummary]
) -> dict[str, dict[str, Any]]:
    """The subset of ``pending`` still authored against the extraction whose
    packet the domain currently shows -- the only edits that may be displayed
    as pending or applied to a packet (migration 0016).

    Every edit is stamped at save time with the `extraction_id` of the packet
    the admin was reading (`save_metric_edits`). A row whose stamp no longer
    matches that domain's most recent packet is an orphan of a *superseded*
    generation of values, and there are two ways to make one:

    - `approve_document` applies the edits, commits the new packet on the
      pipeline pool, and only then clears `cds_pending_edits` on the app pool.
      Two roles, two connections, no shared transaction (`counselle_app` has
      zero grants on `cds_library` and vice versa), so a crash in that gap
      leaves rows describing a correction that is already live and serving.
    - `rerun_extraction` re-extracts a domain without touching pending edits,
      so an edit written against the model's previous numbers outlives them.

    Either way the orphan is a lie on the review screen ("pending" over a value
    that is already live, or over a value it was never written against), and
    applying it silently discards whatever the newer extraction actually found.
    Filtering on the stamp makes both harmless: superseded edits stop being
    shown and can never be applied. They are still deleted by the next
    approve/reject, which sweeps every row it read, not just the applied ones."""
    current = {domain.domain_id: domain.extraction_id for domain in domains}
    return {
        ref: row
        for ref, row in pending.items()
        if str(row["base_extraction_id"]) == current.get(row["domain_id"])
    }


async def _document_page_count(app_pool: asyncpg.Pool, document_id: int) -> int | None:
    """The true page count, already computed once at upload time
    (`service_ingest.create_upload` -> `adapters/cds_pdf.get_page_count`) and
    kept on the staging row after commit. `None` for documents that didn't
    come through the upload flow (no matching row)."""
    async with app_pool.acquire() as conn:
        value = await conn.fetchval(
            "SELECT page_count FROM counselle.cds_upload_files "
            "WHERE committed_document_id = $1 AND page_count IS NOT NULL "
            "LIMIT 1",
            document_id,
        )
    return int(value) if value is not None else None


_REF_ACRONYMS = {
    "act", "ap", "cip", "clep", "fafsa", "ged", "gpa", "ib",
    "ipeds", "rotc", "sat", "toefl",
}


def _humanize_ref(ref: str) -> str:
    """A readable row label for a metric whose manifest definition carries no
    `title` — which today is every one of them (`config/cds/domains/*.yaml`
    give each *domain* a title, never a metric). Without this the review
    screen labels every row with a raw identifier (`air_force_rotc_on_campus`),
    which is the one screen where an admin has to read 394 labels quickly.
    The full sentence stays in `description`, which the row's tooltip shows."""
    words = [
        word.upper() if word in _REF_ACRONYMS else word
        for word in ref.rsplit(".", 1)[-1].split("_")
    ]
    first, *rest = words
    return " ".join([first[:1].upper() + first[1:], *rest])


def _domain_contract(domain_summary: DomainPacketSummary) -> dict[str, Any] | None:
    contract = domain_summary.provider_contract or {}
    for domain in contract.get("metric_definitions", []):
        if domain.get("id") == domain_summary.domain_id:
            return dict(domain)
    return None


def _natural_key(hint: str) -> tuple[str, int]:
    match = _HINT_RE.match(hint)
    if not match:
        return (hint, 0)
    letters, digits = match.groups()
    return (letters.upper(), int(digits) if digits else 0)


def _domain_sort_key(domain_summary: DomainPacketSummary) -> tuple[str, int]:
    """CDS order: by the domain's first source_hint letter (plan §D
    `DocumentReview.sections`). A domain with no recoverable hints (its
    packet predates the `provider_contract` embedding, or was never
    extracted) sorts last, alphabetically among itself."""
    contract = _domain_contract(domain_summary)
    hints = [
        hint
        for metric in ((contract or {}).get("metrics", []))
        for hint in metric.get("source_hints", [])
    ]
    if not hints:
        return ("~", 0)
    return min(_natural_key(hint) for hint in hints)


def _display_value(metric_row: MetricRow, definition: dict[str, Any]) -> str | None:
    if metric_row.extraction_status != "verified" or metric_row.availability_status != "reported":
        return None
    value = metric_row.value
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        text = format_decimal(value)
        return f"{text}%" if definition.get("unit") == "percent" else text
    return str(value) if value is not None else None


def _pending_out(row: dict[str, Any]) -> PendingEditOut:
    payload = row["payload"]
    return PendingEditOut(
        value=payload.get("value"),
        raw_value=payload.get("raw_value"),
        availability_status=payload.get("availability_status"),
        evidence=EvidenceRow.model_validate(payload.get("evidence") or {}),
        note=payload.get("note"),
        edited_by=str(row["edited_by"]),
        edited_at=row["edited_at"],
    )


def _build_section(
    domain_summary: DomainPacketSummary, pending: dict[str, dict[str, Any]]
) -> ReviewSection:
    contract = _domain_contract(domain_summary)
    defs = {m["id"]: m for m in (contract or {}).get("metrics", [])}
    flags_by_ref: dict[str | None, list[ReviewFlagOut]] = defaultdict(list)
    for flag in domain_summary.flags:
        flags_by_ref[flag.metric_ref].append(
            ReviewFlagOut(
                code=flag.code, severity=flag.severity, message=flag.message,
                metric_ref=flag.metric_ref,
            )
        )
    metrics = []
    for metric_row in domain_summary.metrics:
        definition = defs.get(metric_row.ref, {})
        pending_row = pending.get(metric_row.ref)
        metrics.append(
            ReviewMetric(
                ref=metric_row.ref,
                title=definition.get("title") or _humanize_ref(metric_row.ref),
                description=definition.get("description"),
                type=definition.get("type", "string"),
                unit=definition.get("unit"),
                source_hints=list(definition.get("source_hints", [])),
                value=metric_row.value,
                raw_value=metric_row.raw_value,
                display=_display_value(metric_row, definition),
                availability_status=metric_row.availability_status,
                extraction_status=metric_row.extraction_status,
                evidence=metric_row.evidence,
                flags=flags_by_ref.get(metric_row.ref, []),
                pending_edit=_pending_out(pending_row) if pending_row else None,
            )
        )
    return ReviewSection(
        domain_id=domain_summary.domain_id,
        title=(contract or {}).get("title") or domain_summary.domain_id,
        status=domain_summary.status,
        counts=domain_summary.counts,
        metrics=metrics,
    )


# Mirrors the frontend's `CDS_NON_TERMINAL_EXTRACTION_STATUSES`
# (`frontend/src/api/cds-admin/types.ts`) and the coverage query's own
# `status IN ('queued', 'running')` -- there is no shared Python/TS constant
# to route both through, so this is the third literal copy of the same two
# values, not a new duplication pattern.
_NON_TERMINAL_EXTRACTION_STATUSES = {"queued", "running"}


def _select_header_extraction(
    domains: list[DomainPacketSummary], extractions: list[ExtractionRow]
) -> tuple[ExtractionRow | None, bool]:
    """Which extraction the review header's identity (id/model/version/finish
    time/error) is drawn from, and whether the domains on screen actually
    came from more than one (R-01).

    The old code took ``extractions[0]`` -- whichever extraction was queued
    most recently for the *document*, even if it had not produced a single
    domain packet yet. That let an unrelated in-flight or failed rerun
    narrate the header over other domains' unrelated, already-good data.
    Instead, only extractions a domain's *current* packet actually came from
    (``domain.extraction_id``, the same id ``_current_edits`` already keys
    on) are eligible.

    ``extractions`` is already ``ORDER BY queued_at DESC``
    (``_DOCUMENT_EXTRACTIONS_SQL``). When more than one is eligible, the
    most recently queued *non-terminal* one wins the identity fields, so the
    header's ``status`` stays "non-terminal if any contributing extraction
    is" -- the contract `document-status.ts` / `ReviewHeader.tsx` already
    rely on -- otherwise the most recently queued eligible one, matching the
    old tie-break.
    """
    contributing_ids = {d.extraction_id for d in domains}
    if not contributing_ids:
        # No domain has a packet yet (e.g. a document's very first
        # extraction hasn't finished any domain) -- there is no completed
        # data to misattribute, so the most recently queued extraction is
        # shown exactly as before.
        return (extractions[0] if extractions else None), False
    eligible = [
        extraction for extraction in extractions if extraction.id in contributing_ids
    ]
    if not eligible:
        # Every contributing id is missing from `extractions` -- shouldn't
        # happen (a packet's extraction row always exists), but leaves the
        # header honestly blank rather than guessing.
        return None, False
    is_mixed = len({extraction.id for extraction in eligible}) > 1
    primary = next(
        (e for e in eligible if e.status in _NON_TERMINAL_EXTRACTION_STATUSES),
        eligible[0],
    )
    return primary, is_mixed


def _aggregate_counts(domains: list[DomainPacketSummary]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for domain in domains:
        for key, value in domain.counts.items():
            totals[key] = totals.get(key, 0) + value
    return totals


def _flags_summary(
    domains: list[DomainPacketSummary], pending: dict[str, dict[str, Any]]
) -> FlagsSummary:
    """`total` is every flag on the document, addressed or not, for the
    review screen's "N unresolved of M total" line. `unresolved` is
    narrower and is the one that gates Approve (plan §D endpoint #12): a
    flag on a metric with a pending edit is treated as addressed (the admin
    has already proposed a fix), and -- per the measured false-alarm rate in
    `specs/cds-pipeline/plan/flag-precision.md` -- an unaddressed flag only
    counts against `unresolved` when its own validator marked it
    `severity="error"` (`domain.cds.validators.Severity`'s blocking tier).
    A `severity="warning"` flag (an evidence-verifiability gap the model's
    *value* usually survives -- excerpt/citation checks, corrupt-text-layer
    re-check requests) stays on the review screen and in `total` forever,
    never silently dropped, but never blocks Approve by itself."""
    total = 0
    unresolved = 0
    for domain in domains:
        for flag in domain.flags:
            total += 1
            addressed = flag.metric_ref is not None and flag.metric_ref in pending
            if not addressed and flag.severity == "error":
                unresolved += 1
    return FlagsSummary(unresolved=unresolved, total=total)


async def get_review(
    pipeline_pool: asyncpg.Pool, app_pool: asyncpg.Pool, *, document_id: int
) -> DocumentReviewOut:
    raw = await cds_admin_queries.get_document_review(pipeline_pool, document_id)
    if raw is None:
        raise CdsAdminNotFoundError(f"document {document_id} not found")
    pending = _current_edits(await _pending_edits(app_pool, document_id), raw.domains)
    page_count = await _document_page_count(app_pool, document_id)
    # Resolved server-side, once, from the same predicate the write-path
    # gates use (SHIP-PLAN §2.4) -- the review-screen header chip has no
    # other way to detect a pending `active_update` correction, since
    # approving/rejecting one with no edited domains never creates a new
    # extraction row (only `reactivated_at` changes, invisible on the wire
    # otherwise).
    is_correction_pending = (
        await _pending_active_update_id(pipeline_pool, document_id) is not None
        if raw.document.is_active
        else False
    )
    ordered = sorted(raw.domains, key=_domain_sort_key)
    sections = [_build_section(domain, pending) for domain in ordered]
    header_extraction, is_mixed = _select_header_extraction(raw.domains, raw.extractions)
    extraction = (
        ReviewExtraction(
            id=header_extraction.id,
            status=header_extraction.status,
            extractor_version=None if is_mixed else header_extraction.extractor_version,
            model_id=None if is_mixed else header_extraction.model_id,
            finished_at=None if is_mixed else header_extraction.finished_at,
            error_code=None if is_mixed else header_extraction.error_code,
            counts=_aggregate_counts(raw.domains),
            is_mixed_generation=is_mixed,
        )
        if header_extraction
        else None
    )
    return DocumentReviewOut(
        document=raw.document.model_copy(
            update={"page_count": page_count, "is_correction_pending": is_correction_pending}
        ),
        extraction=extraction,
        sections=sections,
        flags_summary=_flags_summary(raw.domains, pending),
    )


# ---------------------------------------------------------------------------
# Metric edits (endpoint #11)
# ---------------------------------------------------------------------------


async def save_metric_edits(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    *,
    document_id: int,
    actor_user_id: UUID,
    edits: list[MetricEditIn],
) -> DocumentReviewOut:
    raw = await cds_admin_queries.get_document_review(pipeline_pool, document_id)
    if raw is None:
        raise CdsAdminNotFoundError(f"document {document_id} not found")
    await _require_reviewable(pipeline_pool, raw.document, document_id, action="edit")
    # The domain each ref actually belongs to, and with it the extraction whose
    # packet the admin is editing against -- both resolved server-side from the
    # document's own packets, never from the client-supplied `domain_id`, so a
    # stored edit can only ever name the domain and generation it was really
    # written against (`_current_edits`).
    domain_by_ref = {
        metric.ref: domain for domain in raw.domains for metric in domain.metrics
    }
    async with app_pool.acquire() as conn, conn.transaction():
        for edit in edits:
            domain = domain_by_ref.get(edit.metric_ref)
            if domain is None:
                raise CdsAdminValidationError(f"unknown metric_ref {edit.metric_ref!r}")
            payload = {
                "value": edit.value,
                "raw_value": edit.raw_value,
                "availability_status": edit.availability_status,
                "evidence": edit.evidence.model_dump(mode="json"),
                "note": edit.note,
            }
            await conn.execute(
                """
                INSERT INTO counselle.cds_pending_edits
                    (document_id, metric_ref, domain_id, base_extraction_id, payload, edited_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (document_id, metric_ref)
                DO UPDATE SET domain_id = EXCLUDED.domain_id,
                              base_extraction_id = EXCLUDED.base_extraction_id,
                              payload = EXCLUDED.payload,
                              edited_by = EXCLUDED.edited_by, edited_at = now()
                """,
                document_id,
                edit.metric_ref,
                domain.domain_id,
                uuid.UUID(domain.extraction_id),
                payload,
                actor_user_id,
            )
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action="edit",
            school_id=raw.document.school_id,
            academic_year=raw.document.academic_year,
            document_id=document_id,
            detail={"metric_refs": [edit.metric_ref for edit in edits]},
        )
    review = await get_review(pipeline_pool, app_pool, document_id=document_id)
    superseded = _superseded_refs(edits, review)
    if superseded:
        raise CdsAdminConflictError(
            f"a re-extraction completed while saving -- {superseded} were not applied "
            "and must be re-entered"
        )
    return review


def _superseded_refs(edits: list[MetricEditIn], review: DocumentReviewOut) -> list[str]:
    """R-02: the `base_extraction_id` stamped in `save_metric_edits` comes
    from `raw`, read before that transaction opened. If a rerun
    (`rerun_extraction`) committed a new packet for one of these domains in
    that window, the row was written already-superseded, and
    `_current_edits` (inside the `get_review` call just before this)
    correctly drops it -- so without this check the endpoint would return
    200 with a review that silently omits the edit the admin just saved.
    Comparing what was written against what the fresh review still shows as
    pending turns that into a named 409 instead of a silent no-op."""
    written_refs = {edit.metric_ref for edit in edits}
    still_pending_refs = {
        metric.ref
        for section in review.sections
        for metric in section.metrics
        if metric.pending_edit is not None
    }
    return sorted(written_refs - still_pending_refs)


__all__ = [
    "get_review",
    "save_metric_edits",
]
