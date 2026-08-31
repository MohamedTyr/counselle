"""The review screen's read model, metric-level edits, and approve/reject/rerun
(plan §B1 `app/cds/service_review.py`).

The `sections`/`metrics` shape is assembled from three sources: P3's
per-domain packet summaries (`adapters/cds_admin_queries.get_document_review`),
each packet's own embedded `provider_contract.metric_definitions` (the exact
manifest contract that run's claims were made against -- self-describing, so
this never depends on today's live manifest matching a past extraction), and
`counselle.cds_pending_edits` (uncommitted admin corrections).

**An edit is a NEW packet, never a mutation** (plan §B5): `approve_document`
builds one `domain.cds.packet_build.build_packet` call per touched domain,
seeded with the document's own most recent packet as `base_metrics` so
untouched refs keep their model-extracted values, under a fresh
`extractor_version='human-review-v1'` extraction row, with `provider_contract`
carrying forward the model's own `metric_definitions` (this is what line 6
above depends on staying true for a human-reviewed packet too) plus a merged
`human_review` block with the reviewer/audit trail.
`adapters/cds_store.py::insert_packet` self-validates every packet's *shape*
through the reader's own `parse_packet_row()` before it lands -- this module
never needs to (and cannot) fight the immutability trigger. It does not judge
the packet's *values*: that is `_prepare_edited_packets`' job, which runs the
validators over each synthesized packet and refuses the approve outright,
before any of this writes anything, when the admin's own edit produced a
blocking flag.
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg
import structlog

from adapters import cds_admin_queries, cds_pdf, cds_store
from adapters.cds_admin_types import DocumentMeta, DomainPacketSummary, EvidenceRow, MetricRow
from adapters.cds_store import HUMAN_REVIEW_EXTRACTOR_VERSION
from app.agent_node import model_name_from_setting
from app.cds import audit
from app.cds import manifest as manifest_mod
from app.cds.engine import EXTRACTOR_VERSION as MODEL_EXTRACTOR_VERSION
from app.cds.errors import CdsAdminConflictError, CdsAdminNotFoundError, CdsAdminValidationError
from app.cds.models import (
    ApproveResult,
    DocumentReviewOut,
    FlagsSummary,
    MetricEditIn,
    PendingEditOut,
    RerunResult,
    ReviewExtraction,
    ReviewFlagOut,
    ReviewMetric,
    ReviewSection,
)
from counselle_db.formatting import format_decimal
from domain.cds import packet_build, validators
from domain.cds.claims import Finding

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
    extraction = (
        ReviewExtraction(
            id=raw.extractions[0].id,
            status=raw.extractions[0].status,
            extractor_version=raw.extractions[0].extractor_version,
            model_id=raw.extractions[0].model_id,
            finished_at=raw.extractions[0].finished_at,
            error_code=raw.extractions[0].error_code,
            counts=_aggregate_counts(raw.domains),
        )
        if raw.extractions
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
    return await get_review(pipeline_pool, app_pool, document_id=document_id)


# ---------------------------------------------------------------------------
# Approve / reject / rerun (endpoints #12, #13, #14)
# ---------------------------------------------------------------------------


def _base_metrics_dict(metric_rows: list[MetricRow]) -> dict[str, dict[str, Any]]:
    base: dict[str, dict[str, Any]] = {}
    for row in metric_rows:
        base[row.ref] = {
            "availability_status": row.availability_status,
            "extraction_status": row.extraction_status,
            "value": row.value,
            "raw_value": row.raw_value,
            "evidence": row.evidence.model_dump(mode="json") if row.evidence else None,
            "diagnostic_code": row.diagnostic_code,
        }
    return base


def _finding_from_pending(row: dict[str, Any]) -> Finding:
    payload = row["payload"]
    evidence = payload["evidence"]
    return Finding(
        metric_id=row["metric_ref"],
        availability_status=payload["availability_status"],
        value=payload.get("value"),
        raw_value=payload.get("raw_value"),
        page_number=evidence["page_number"],
        section=evidence.get("section"),
        row_label=evidence.get("row_label"),
        column_label=evidence.get("column_label"),
        excerpt=evidence["excerpt"],
    )


async def _clear_pending_edits(
    app_pool: asyncpg.Pool, document_id: int, *, metric_refs: list[str] | None = None
) -> None:
    """Delete pending-edit rows for the document -- scoped to exactly
    ``metric_refs`` when given, every row for the document when omitted
    (`reject_document`'s case: the whole document is being discarded, so
    there is nothing later that could apply a leftover edit).

    `approve_document` must pass the metric_refs it actually snapshotted
    from `cds_pending_edits` before opening its write transaction, not omit
    this: an admin's `PATCH .../metrics` (`save_metric_edits`) can insert a
    *new* edit in the gap between that snapshot and this delete. An
    unconditional `DELETE ... WHERE document_id = $1` would silently discard
    that concurrent edit -- never applied to any packet, and gone with no
    error or trace. Scoping to the snapshotted refs lets a concurrent edit
    survive to be picked up (and actually applied) by the next approve."""
    async with app_pool.acquire() as conn:
        if metric_refs is None:
            await conn.execute(
                "DELETE FROM counselle.cds_pending_edits WHERE document_id = $1", document_id
            )
        else:
            await conn.execute(
                "DELETE FROM counselle.cds_pending_edits "
                "WHERE document_id = $1 AND metric_ref = ANY($2::text[])",
                document_id,
                metric_refs,
            )


def _human_reviewed_packet(
    *,
    manifest: Any,
    domain_id: str,
    edit_rows: list[dict[str, Any]],
    base_metrics: dict[str, dict[str, Any]],
    source_provider_contract: dict[str, Any] | None,
    document: Any,
    original_page_count: int,
    extraction_id: str,
    actor_user_id: UUID,
    base_extraction_id: str,
    note: str | None,
) -> dict[str, Any]:
    """Build one domain's human-review packet (plan §B5): the currently
    stored packet's metric map as `base_metrics`, edited refs replacing it,
    and `provider_contract` carrying the model's own `metric_definitions`
    (`source_provider_contract`, the domain's most recent packet contract)
    with the `human_review` provenance block merged in alongside it -- never
    replacing it wholesale. `_domain_contract` (this module) and
    `domain.cds.validators._metric_definition` both key off
    `provider_contract["metric_definitions"]` for every metric's title,
    description, unit, source_hints, and sort position; discarding it would
    silently and permanently lose all of that for this domain the moment an
    admin corrects even one metric in it."""
    findings = [_finding_from_pending(row) for row in edit_rows]
    packet = packet_build.build_packet(
        manifest_content=manifest.content,
        domain_hashes=manifest.domain_hashes,
        domain_id=domain_id,
        findings=findings,
        provider_contract={},
        document_page_count=original_page_count,
        document_sha256=bytes.fromhex(document.pdf_sha256),
        academic_year=document.academic_year,
        extraction_id=extraction_id,
        manifest_version=manifest.version,
        model_id="human",
        extractor_version=HUMAN_REVIEW_EXTRACTOR_VERSION,
        base_metrics=base_metrics,
    )
    packet["provider_contract"] = {
        **(source_provider_contract or {}),
        "human_review": {
            "reviewer_user_id": str(actor_user_id),
            "reviewed_at": datetime.now(UTC).isoformat(),
            "base_extraction_id": base_extraction_id,
            "changed_refs": sorted(row["metric_ref"] for row in edit_rows),
            "note": note,
        },
    }
    return packet


@dataclass(frozen=True)
class _EditedPackets:
    """One human-review packet per touched domain, built and validated but not
    yet written anywhere."""

    extraction_id: uuid.UUID
    pdf_sha256: bytes
    packets: tuple[tuple[str, dict[str, Any], tuple[validators.ReviewFlag, ...]], ...]

    @property
    def domain_ids(self) -> list[str]:
        return [domain_id for domain_id, _packet, _flags in self.packets]

    @property
    def blocking_flags(self) -> tuple[validators.ReviewFlag, ...]:
        """The `error`-severity subset — the same blocking tier
        `_flags_summary.unresolved` counts, never the warnings alongside it."""
        return tuple(
            flag
            for _domain_id, _packet, flags in self.packets
            for flag in flags
            if flag.severity == "error"
        )


async def _prepare_edited_packets(
    conn: asyncpg.Connection,
    *,
    manifest: Any,
    document_id: int,
    document: Any,
    by_domain: dict[str, DomainPacketSummary],
    edits_by_domain: dict[str, list[dict[str, Any]]],
    actor_user_id: UUID,
    note: str | None,
    override_flags: bool,
) -> _EditedPackets:
    """Synthesize one human-review packet per touched domain, run the same
    `domain.cds.validators.run_validators` gate the model extraction path runs
    (`app/cds/calling.py::_store_packet`) over each one, and **refuse the whole
    approve** if the result carries a blocking flag.

    Reads only. Nothing here writes, which is the point: the approve gate in
    `approve_document` is computed from the packets the document *already has*,
    so it cannot see a defect the admin's own edit introduces -- an edit setting
    a `unit: percent` metric to `150`, or breaking `denominator_sanity`'s
    admits<=applicants order, used to sail through it and land live, its own
    error flag recorded as inert JSON on a packet nobody would reopen. Building
    and checking here, before `_write_edited_packets` opens its transaction,
    means a refused correction leaves no extraction row, no packet, and no
    half-activated domain behind -- and `override_flags` remains the single
    escape hatch, for this gate exactly as for the pre-edit one."""
    doc = await cds_store.fetch_document_for_extraction(conn, document_id=document_id)
    original_page_count = await cds_pdf.get_page_count(doc.pdf_content)
    corrupt_report = await cds_pdf.detect_corrupt_text_layer(doc.pdf_content)
    routing_text = await cds_pdf.extract_routing_text(doc.pdf_content)
    doc_facts = validators.DocFacts(
        page_text={} if corrupt_report.is_corrupt else routing_text,
        corrupt_text_layer=corrupt_report.is_corrupt,
        expected_academic_year=document.academic_year,
    )
    extraction_id = uuid.uuid4()
    built: list[tuple[str, dict[str, Any], tuple[validators.ReviewFlag, ...]]] = []
    for domain_id, edit_rows in edits_by_domain.items():
        domain_summary = by_domain.get(domain_id)
        if domain_summary is None:
            raise CdsAdminValidationError(f"unknown domain {domain_id!r} in pending edits")
        try:
            packet = _human_reviewed_packet(
                manifest=manifest, domain_id=domain_id, edit_rows=edit_rows,
                base_metrics=_base_metrics_dict(domain_summary.metrics),
                source_provider_contract=domain_summary.provider_contract, document=document,
                original_page_count=original_page_count, extraction_id=str(extraction_id),
                actor_user_id=actor_user_id, base_extraction_id=domain_summary.extraction_id,
                note=note,
            )
        except packet_build.ZeroVerifiedMetricsError as exc:
            raise CdsAdminValidationError(
                f"review edits leave domain {domain_id!r} with zero verified metrics "
                f"(counts={exc.counts!r}); a domain packet must verify at least one metric"
            ) from exc
        built.append((domain_id, packet, tuple(validators.run_validators(packet, doc_facts))))
    edited = _EditedPackets(extraction_id, doc.pdf_sha256, tuple(built))
    if edited.blocking_flags and not override_flags:
        raise CdsAdminConflictError(
            f"these edits fail {len(edited.blocking_flags)} validation check(s) — "
            + "; ".join(flag.message for flag in edited.blocking_flags)
            + " — correct them or approve with override_flags=true"
        )
    return edited


async def _write_edited_packets(
    conn: asyncpg.Connection,
    *,
    settings: Any,
    manifest: Any,
    document_id: int,
    document: Any,
    edited: _EditedPackets,
) -> str:
    """Store + activate the already-validated packets under one new
    human-review extraction. Each packet's flags land as `insert_packet`'s
    `validation`, so a warning the admin was never blocked on (and an
    overridden error) stays visible on the review screen instead of
    disappearing into insert_packet's `{}` default."""
    await cds_store.create_human_review_extraction(
        conn,
        extraction_id=edited.extraction_id,
        school_year_id=document.school_year_id,
        document_id=document_id,
        manifest_version=manifest.version,
        requested_domains=edited.domain_ids,
    )
    for domain_id, packet, flags in edited.packets:
        try:
            await cds_store.insert_packet(
                conn, settings=settings, document_id=document_id,
                extraction_id=edited.extraction_id,
                manifest_version=manifest.version, domain_id=domain_id,
                domain_schema_hash=bytes.fromhex(manifest.domain_hashes[domain_id]),
                academic_year=document.academic_year, pdf_sha256=edited.pdf_sha256,
                status=packet["status"], packet=packet,
                validation={"flags": [flag.model_dump() for flag in flags]},
            )
        except cds_store.PacketValidationError as exc:
            raise CdsAdminValidationError(str(exc)) from exc
        await cds_store.activate_packet(
            conn, document_id=document_id, extraction_id=edited.extraction_id, domain_id=domain_id
        )
    return str(edited.extraction_id)


async def _activate_untouched(
    conn: asyncpg.Connection,
    document_id: int,
    by_domain: dict[str, DomainPacketSummary],
    *,
    skip: set[str],
) -> None:
    for domain_id, domain_summary in by_domain.items():
        if domain_id in skip:
            continue
        await cds_store.activate_packet(
            conn, document_id=document_id, extraction_id=uuid.UUID(domain_summary.extraction_id),
            domain_id=domain_id,
        )


async def approve_document(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    settings: Any,
    *,
    document_id: int,
    actor_user_id: UUID,
    override_flags: bool,
    note: str | None,
) -> ApproveResult:
    raw = await cds_admin_queries.get_document_review(pipeline_pool, document_id)
    if raw is None:
        raise CdsAdminNotFoundError(f"document {document_id} not found")
    await _require_reviewable(pipeline_pool, raw.document, document_id, action="approve")
    if not raw.domains:
        raise CdsAdminValidationError("document has no extracted domains to approve")

    # `pending` is every row on the document (what the closing `_clear_pending_
    # edits` sweeps, so a superseded orphan is cleaned up rather than left to
    # accumulate); `current` is the subset this approve may actually act on.
    pending = await _pending_edits(app_pool, document_id)
    current = _current_edits(pending, raw.domains)
    flags_summary = _flags_summary(raw.domains, current)
    if flags_summary.unresolved > 0 and not override_flags:
        raise CdsAdminConflictError(
            f"{flags_summary.unresolved} unresolved review flag(s) — resolve them or "
            "approve with override_flags=true"
        )

    manifest = manifest_mod.load_compiled_manifest()
    by_domain = {domain.domain_id: domain for domain in raw.domains}
    edits_by_domain: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in current.values():
        edits_by_domain[row["domain_id"]].append(row)

    new_extraction_id: str | None = None
    edited: _EditedPackets | None = None
    async with pipeline_pool.acquire() as conn:
        # Outside the transaction on purpose: this both builds the new packets
        # and refuses the approve on a blocking flag they introduce, so a
        # refusal never has a write to unwind.
        if edits_by_domain:
            edited = await _prepare_edited_packets(
                conn, manifest=manifest, document_id=document_id, document=raw.document,
                by_domain=by_domain, edits_by_domain=edits_by_domain,
                actor_user_id=actor_user_id, note=note, override_flags=override_flags,
            )
        async with conn.transaction():
            if edited is not None:
                new_extraction_id = await _write_edited_packets(
                    conn, settings=settings, manifest=manifest, document_id=document_id,
                    document=raw.document, edited=edited,
                )
            await _activate_untouched(
                conn, document_id, by_domain, skip=set(edited.domain_ids) if edited else set()
            )
            if raw.document.is_candidate:
                await cds_store.promote_candidate_document(
                    conn, school_year_id=raw.document.school_year_id, document_id=document_id
                )
            # else: an `active_update` correction against an already-active
            # document -- skip the document-level swap (it would be a harmless
            # no-op, both fields are already correct) so the audit log stays
            # honest: this approval corrected the document in place, it didn't
            # promote anything (SHIP-PLAN §2.2).
            await cds_store.close_pending_active_updates(conn, document_id=document_id)

    await _clear_pending_edits(app_pool, document_id, metric_refs=list(pending))
    # Non-zero only when the approve was overridden -- `_prepare_edited_packets`
    # raises otherwise -- so an override of an edit's own flags is recorded as
    # such even when the document had no pre-edit flag to override.
    overridden_edit_flags = len(edited.blocking_flags) if edited else 0
    async with app_pool.acquire() as conn:
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action=(
                "approve_override"
                if flags_summary.unresolved > 0 or overridden_edit_flags > 0
                else "approve"
            ),
            school_id=raw.document.school_id,
            academic_year=raw.document.academic_year,
            document_id=document_id,
            extraction_id=new_extraction_id,
            detail={
                "note": note,
                "activated_domains": sorted(by_domain),
                "unresolved_flags": flags_summary.unresolved,
                "overridden_edit_flags": overridden_edit_flags,
            },
        )
    return ApproveResult(
        document_id=document_id,
        activated_domains=sorted(by_domain),
        extraction_id=new_extraction_id,
    )


async def reject_document(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    *,
    document_id: int,
    actor_user_id: UUID,
    reason: str,
) -> None:
    raw = await cds_admin_queries.get_document_review(pipeline_pool, document_id)
    if raw is None:
        raise CdsAdminNotFoundError(f"document {document_id} not found")
    await _require_reviewable(pipeline_pool, raw.document, document_id, action="reject")
    async with pipeline_pool.acquire() as conn, conn.transaction():
        if raw.document.is_candidate:
            try:
                await cds_store.reject_candidate_document(
                    conn, school_year_id=raw.document.school_year_id, document_id=document_id
                )
            except cds_store.CdsStoreError as exc:
                raise CdsAdminConflictError(str(exc)) from exc
        else:
            # Rejecting an `active_update` correction against an already-
            # active document (SHIP-PLAN §2.3): the document keeps serving
            # its prior packets untouched -- no `invalidated_at`, no
            # `cds_school_years` write. "Discard" can only mean taking no
            # action on `status` (no DELETE grant, no `rejected` status);
            # closing the gate is the only write.
            await cds_store.close_pending_active_updates(conn, document_id=document_id)
    await _clear_pending_edits(app_pool, document_id)
    async with app_pool.acquire() as conn:
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action="reject",
            school_id=raw.document.school_id,
            academic_year=raw.document.academic_year,
            document_id=document_id,
            detail={"reason": reason},
        )


async def rerun_extraction(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    settings: Any,
    *,
    document_id: int,
    actor_user_id: UUID,
    domains: list[str] | None,
) -> RerunResult:
    raw = await cds_admin_queries.get_document_review(pipeline_pool, document_id)
    if raw is None:
        raise CdsAdminNotFoundError(f"document {document_id} not found")
    manifest = manifest_mod.load_compiled_manifest()
    all_domains = manifest_mod.domain_ids(manifest)
    unknown = set(domains or []) - set(all_domains)
    if unknown:
        raise CdsAdminValidationError(f"unknown domain id(s): {sorted(unknown)}")
    requested = domains if domains else list(all_domains)
    # Keyed on `is_active` alone (SHIP-PLAN §2.1) -- a domain-scoped rerun of
    # an already-active document is still a correction against the active
    # document, not a full re-extraction. `is_active` is false by
    # construction for a candidate document (`cds_school_years_check`), so
    # that path is unaffected.
    target_kind = "active_update" if raw.document.is_active else "full_reextract"
    model_id = model_name_from_setting(settings.model_cds_extract)
    try:
        async with pipeline_pool.acquire() as conn, conn.transaction():
            extraction = await cds_store.create_extraction(
                conn,
                school_year_id=raw.document.school_year_id,
                document_id=document_id,
                manifest_version=manifest.version,
                target_kind=target_kind,  # type: ignore[arg-type]
                requested_domains=requested,
                extractor_version=MODEL_EXTRACTOR_VERSION,
                model_id=model_id,
            )
    except asyncpg.UniqueViolationError as exc:
        raise CdsAdminConflictError(
            "a job is already running or queued for this school-year slot"
        ) from exc
    async with app_pool.acquire() as conn:
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action="rerun",
            school_id=raw.document.school_id,
            academic_year=raw.document.academic_year,
            document_id=document_id,
            extraction_id=extraction.id,
            detail={"domains": requested, "target_kind": target_kind},
        )
    return RerunResult(extraction_id=str(extraction.id))


__all__ = [
    "approve_document",
    "get_review",
    "reject_document",
    "rerun_extraction",
    "save_metric_edits",
]
