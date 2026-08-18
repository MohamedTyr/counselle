"""Read-model shapes for the CDS admin surface (plan §D).

These are provisional — `app/cds/models.py` (owned by P5) is the eventual home
for the admin API's request/response Pydantic models. Until that module
exists, `adapters/cds_admin_queries.py` returns these local, permissive shapes;
P5 should reconcile/rename them rather than duplicate the fields.

Deliberately more permissive than `counselle_db.packets.Packet` (the
student-facing anti-corruption boundary, `extra="forbid"`): the admin surface's
whole job is to show a human a packet that might be partial, flagged, or from a
failed/candidate extraction, so these models never reject a row — they just
carry `None`/empty defaults through.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True)


CellStatus = Literal["none", "processing", "needs_review", "approved", "failed"]


class CoverageCell(_Model):
    """One school×year cell in the coverage grid (plan §D, endpoint #1)."""

    status: CellStatus
    school_year_id: int | None = None
    document_id: int | None = None
    extraction_id: str | None = None
    extractor_version: str | None = None
    error_code: str | None = None
    updated_at: datetime | None = None
    active_domains: int | None = None
    partial_domains: int | None = None
    candidate_domains: int | None = None


class CoverageRow(_Model):
    school_id: int
    name: str
    state: str | None
    cells: dict[int, CoverageCell]


class CoverageCounters(_Model):
    schools: int
    editions: int
    needs_review: int
    processing: int
    approved: int
    failed: int
    missing: int


class CoverageResult(_Model):
    years: list[int]
    rows: list[CoverageRow]
    counters: CoverageCounters
    total: int


class SchoolSummary(_Model):
    """Typeahead row for the upload screen's school picker (endpoint #2)."""

    id: int
    name: str
    state: str | None
    city: str | None


class DocumentMeta(_Model):
    id: int
    school_year_id: int
    school_id: int
    school_name: str
    academic_year: int
    pdf_sha256: str
    pdf_size_bytes: int
    original_filename: str | None
    source_kind: str
    retrieved_at: datetime
    invalidated_at: datetime | None
    superseded_at: datetime | None
    is_candidate: bool
    is_active: bool
    # Not selected by `get_document_review` (no column on `cds_documents` --
    # `cds_library.*` is never touched by this repo's migrations, plan §C1).
    # `app/cds/service_review.py::get_review` fills this in from
    # `counselle.cds_upload_files.page_count` (recorded at upload time, plan
    # §B1) when the document came through the upload flow; `None` for
    # documents from any other `source_kind`.
    page_count: int | None = None


class ExtractionRow(_Model):
    id: str
    document_id: int
    target_kind: str
    status: str
    requested_domains: list[str]
    extractor_version: str
    model_id: str
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_code: str | None
    error_message: str | None
    progress: dict[str, object]


class EvidenceRow(_Model):
    page_number: int | None = None
    excerpt: str | None = None
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None


class MetricRow(_Model):
    ref: str
    extraction_status: str | None = None
    availability_status: str | None = None
    value: object = None
    raw_value: str | None = None
    evidence: EvidenceRow | None = None
    diagnostic_code: str | None = None


class FlagRow(_Model):
    """One validator flag (mirrors ``domain.cds.validators.ReviewFlag``,
    read back out of ``cds_domain_packets.validation`` — see
    ``app/cds/engine.py::_build_and_store_domain_packet``)."""

    code: str
    severity: Literal["error", "warning"]
    message: str
    metric_ref: str | None = None


class DomainPacketSummary(_Model):
    """One domain's packet on a document — the most recent extraction attempt."""

    domain_id: str
    extraction_id: str
    status: str
    is_active: bool
    created_at: datetime
    counts: dict[str, int]
    metrics: list[MetricRow]
    flags: list[FlagRow] = []
    provider_contract: dict[str, Any] | None = None
    unparseable: bool = False


class DocumentReview(_Model):
    """Everything Screen 3 needs (plan §D, `DocumentReview`)."""

    document: DocumentMeta
    extractions: list[ExtractionRow]
    domains: list[DomainPacketSummary]


class DuplicateDocumentRef(_Model):
    """An existing `cds_library` document with identical PDF bytes — the
    upload staging table's `duplicate` status (plan §D endpoint #3)."""

    document_id: int
    school_year_id: int
    school_id: int
    school_name: str
    academic_year: int


class JobStatusRow(_Model):
    """One row of the upload screen's live job-polling list (endpoint #8)."""

    extraction_id: str
    school_id: int
    school_name: str
    academic_year: int
    document_id: int
    status: str
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_code: str | None
    progress: dict[str, object]
