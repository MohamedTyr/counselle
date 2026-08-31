"""Approve / reject / rerun (endpoints #12, #13, #14) -- the second half of
the review screen's write path, split out of `app/cds/service_review.py`
(plan §B1) once that file grew past the house 800-line limit. The read model
and metric-level edits (endpoints #9, #11) stay in `service_review.py`; this
module imports its pending-edit and flags-summary helpers
(`_pending_edits`, `_current_edits`, `_flags_summary`, `_require_reviewable`).

**An edit is a NEW packet, never a mutation** (plan §B5): `approve_document`
builds one `domain.cds.packet_build.build_packet` call per touched domain,
seeded with the document's own most recent packet as `base_metrics` so
untouched refs keep their model-extracted values, under a fresh
`extractor_version='human-review-v1'` extraction row, with `provider_contract`
carrying forward the model's own `metric_definitions` (this is what
`service_review._domain_contract` and `domain.cds.validators._metric_
definition` depend on staying true for a human-reviewed packet too) plus a
merged `human_review` block with the reviewer/audit trail.
`adapters/cds_store.py::insert_packet` self-validates every packet's *shape*
through the reader's own `parse_packet_row()` before it lands -- this module
never needs to (and cannot) fight the immutability trigger. It does not judge
the packet's *values*: that is `_prepare_edited_packets`' job, which runs the
validators over each synthesized packet and refuses the approve outright,
before any of this writes anything, when the admin's own edit produced a
blocking flag.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg

from adapters import cds_admin_queries, cds_pdf, cds_store
from adapters.cds_admin_types import DomainPacketSummary, MetricRow
from adapters.cds_store import HUMAN_REVIEW_EXTRACTOR_VERSION
from app.agent_node import model_name_from_setting
from app.cds import audit
from app.cds import manifest as manifest_mod
from app.cds.engine import EXTRACTOR_VERSION as MODEL_EXTRACTOR_VERSION
from app.cds.errors import CdsAdminConflictError, CdsAdminNotFoundError, CdsAdminValidationError
from app.cds.models import ApproveResult, FlagsSummary, RerunResult
from app.cds.service_review import (
    _current_edits,
    _flags_summary,
    _pending_edits,
    _require_reviewable,
)
from domain.cds import packet_build, validators
from domain.cds.claims import Finding

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
    replacing it wholesale. `_domain_contract` (`service_review.py`) and
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


async def _approve_writes(
    pipeline_pool: asyncpg.Pool,
    *,
    settings: Any,
    document_id: int,
    document: Any,
    by_domain: dict[str, DomainPacketSummary],
    current: dict[str, dict[str, Any]],
    actor_user_id: UUID,
    note: str | None,
    override_flags: bool,
) -> tuple[str | None, _EditedPackets | None]:
    """`approve_document`'s gated write step (plan §B5): build+validate any
    edited packets outside the transaction (so a refusal never has a write to
    unwind), then inside one transaction write them, activate every untouched
    domain, and close out the document/school-year bookkeeping."""
    manifest = manifest_mod.load_compiled_manifest()
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
                conn, manifest=manifest, document_id=document_id, document=document,
                by_domain=by_domain, edits_by_domain=edits_by_domain,
                actor_user_id=actor_user_id, note=note, override_flags=override_flags,
            )
        async with conn.transaction():
            if edited is not None:
                new_extraction_id = await _write_edited_packets(
                    conn, settings=settings, manifest=manifest, document_id=document_id,
                    document=document, edited=edited,
                )
            await _activate_untouched(
                conn, document_id, by_domain, skip=set(edited.domain_ids) if edited else set()
            )
            if document.is_candidate:
                await cds_store.promote_candidate_document(
                    conn, school_year_id=document.school_year_id, document_id=document_id
                )
            # else: an `active_update` correction against an already-active
            # document -- skip the document-level swap (it would be a harmless
            # no-op, both fields are already correct) so the audit log stays
            # honest: this approval corrected the document in place, it didn't
            # promote anything (SHIP-PLAN §2.2).
            await cds_store.close_pending_active_updates(conn, document_id=document_id)
    return new_extraction_id, edited


async def _record_approve_audit(
    app_pool: asyncpg.Pool,
    *,
    document: Any,
    document_id: int,
    actor_user_id: UUID,
    note: str | None,
    new_extraction_id: str | None,
    activated_domains: list[str],
    flags_summary: FlagsSummary,
    edited: _EditedPackets | None,
) -> None:
    """`approve_document`'s closing audit row. Non-zero `overridden_edit_flags`
    only when the approve was overridden -- `_prepare_edited_packets` raises
    otherwise -- so an override of an edit's own flags is recorded as such
    even when the document had no pre-edit flag to override."""
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
            school_id=document.school_id,
            academic_year=document.academic_year,
            document_id=document_id,
            extraction_id=new_extraction_id,
            detail={
                "note": note,
                "activated_domains": activated_domains,
                "unresolved_flags": flags_summary.unresolved,
                "overridden_edit_flags": overridden_edit_flags,
            },
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

    by_domain = {domain.domain_id: domain for domain in raw.domains}
    new_extraction_id, edited = await _approve_writes(
        pipeline_pool, settings=settings, document_id=document_id, document=raw.document,
        by_domain=by_domain, current=current, actor_user_id=actor_user_id, note=note,
        override_flags=override_flags,
    )

    await _clear_pending_edits(app_pool, document_id, metric_refs=list(pending))
    await _record_approve_audit(
        app_pool, document=raw.document, document_id=document_id, actor_user_id=actor_user_id,
        note=note, new_extraction_id=new_extraction_id, activated_domains=sorted(by_domain),
        flags_summary=flags_summary, edited=edited,
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
    "reject_document",
    "rerun_extraction",
]
