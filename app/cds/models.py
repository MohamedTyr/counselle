"""Typed request/response models for the CDS admin API (plan §D). This is the
**frozen contract** — three screen agents build directly against these shapes.

Read-model types that P3's `adapters/cds_admin_queries.py` already returns
(`CoverageResult`, `SchoolSummary`, `DocumentMeta`, ...) are re-exported here
rather than duplicated (`adapters/cds_admin_types.py`'s own docstring asks
P5 to reconcile, not copy). Everything below that is net-new to P5 — upload
staging, the review screen's transformed `sections` shape, and every write
body — is defined here and only here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from adapters.cds_admin_types import (
    CellStatus,
    CoverageCell,
    CoverageCounters,
    CoverageResult,
    CoverageRow,
    DocumentMeta,
    EvidenceRow,
    ExtractionRow,
    FlagRow,
    JobStatusRow,
    SchoolSummary,
)

__all__ = [
    # re-exported read models (P3)
    "CellStatus",
    "CoverageCell",
    "CoverageCounters",
    "CoverageResult",
    "CoverageRow",
    "DocumentMeta",
    "EvidenceRow",
    "ExtractionRow",
    "FlagRow",
    "JobStatusRow",
    "SchoolSummary",
    # uploads / staging
    "MAX_ACADEMIC_YEAR",
    "MIN_ACADEMIC_YEAR",
    "DetectionCandidate",
    "DetectionInfo",
    "ProcessQueuedItem",
    "ProcessResult",
    "ProcessSkippedItem",
    "UploadBatch",
    "UploadPatchBody",
    "UploadRow",
    "UploadStatus",
    # review
    "ApproveBody",
    "ApproveResult",
    "DocumentReviewOut",
    "EvidenceIn",
    "FlagsSummary",
    "MetricEditIn",
    "MetricEditsBody",
    "PendingEditOut",
    "RejectBody",
    "RerunBody",
    "RerunResult",
    "ReviewExtraction",
    "ReviewFlagOut",
    "ReviewMetric",
    "ReviewSection",
]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True)


# ---------------------------------------------------------------------------
# Uploads / staging (endpoints #3-#7)
# ---------------------------------------------------------------------------

# The `counselle.cds_upload_files.academic_year` CHECK constraint
# (migrations/0015_cds_admin.sql) -- named once here so `UploadPatchBody` and
# `service_ingest.create_upload`'s detected-year guard can't drift into two
# copies of the same bound.
MIN_ACADEMIC_YEAR = 2000
MAX_ACADEMIC_YEAR = 2200

UploadStatus = Literal[
    "matched", "needs_input", "replaces_existing", "duplicate", "committed", "error"
]


class DetectionCandidate(_Model):
    school_id: int
    name: str
    state: str | None
    city: str | None
    score: float


class DetectionInfo(_Model):
    """`counselle.cds_upload_files.detection` jsonb, typed."""

    name: str | None = None
    year: int | None = None
    confident: bool = False
    candidates: list[DetectionCandidate] = Field(default_factory=list)
    error: str | None = None
    duplicate_of: int | None = None  # existing document_id, when status == "duplicate"


class UploadRow(_Model):
    id: str
    batch_id: str
    filename: str
    size_bytes: int
    sha256: str
    page_count: int | None
    status: UploadStatus
    school_id: int | None
    school_name: str | None = None
    academic_year: int | None
    detection: DetectionInfo
    error_message: str | None
    committed_document_id: int | None
    committed_extraction_id: str | None
    created_at: datetime
    updated_at: datetime


class UploadBatch(_Model):
    batch_id: str
    rows: list[UploadRow]


class UploadPatchBody(_Model):
    school_id: int | None = None
    academic_year: int | None = Field(
        default=None, ge=MIN_ACADEMIC_YEAR, le=MAX_ACADEMIC_YEAR
    )


class ProcessQueuedItem(_Model):
    file_id: str
    school_year_id: int
    document_id: int
    extraction_id: str


class ProcessSkippedItem(_Model):
    file_id: str
    reason: str


class ProcessResult(_Model):
    queued: list[ProcessQueuedItem]
    skipped: list[ProcessSkippedItem]


# ---------------------------------------------------------------------------
# Review (endpoints #9, #11, #12, #13, #14)
# ---------------------------------------------------------------------------


class ReviewFlagOut(_Model):
    code: str
    severity: Literal["error", "warning"]
    message: str
    metric_ref: str | None = None


class PendingEditOut(_Model):
    """One row of `counselle.cds_pending_edits`, typed for the review screen."""

    value: object = None
    raw_value: str | None = None
    availability_status: str | None = None
    evidence: EvidenceRow
    note: str | None = None
    edited_by: str
    edited_at: datetime


class ReviewMetric(_Model):
    ref: str
    title: str
    description: str | None
    type: str
    unit: str | None
    source_hints: list[str]
    value: object = None
    raw_value: str | None = None
    display: str | None = None
    availability_status: str | None = None
    extraction_status: str | None = None
    evidence: EvidenceRow | None = None
    flags: list[ReviewFlagOut] = Field(default_factory=list)
    pending_edit: PendingEditOut | None = None


class ReviewSection(_Model):
    domain_id: str
    title: str
    status: str | None
    counts: dict[str, int]
    metrics: list[ReviewMetric]


class ReviewExtraction(_Model):
    # `id` and `status` still name one "primary" contributing extraction
    # (the non-terminal one if any is in flight, else the most recently
    # queued) even when mixed -- `status` must, since `document-status.ts` /
    # `ReviewHeader.tsx` derive the header's processing/failed chip from it,
    # and `id` is just a reference to that same run, never asserted as a
    # claim about the data itself.
    id: str
    status: str
    # `extractor_version`, `model_id`, `finished_at`, and `error_code` are
    # all `None` when `is_mixed_generation` -- the domains behind `counts`
    # were not all produced by the same extraction, so naming one run's
    # version/model/finish-time/error here would misattribute the rest
    # (R-01). `finished_at` in particular is nulled rather than kept: the
    # primary is chosen by queue recency, not finish recency, so its
    # `finished_at` would not even genuinely mean "most recently finished"
    # once more than one run contributed.
    extractor_version: str | None
    model_id: str | None
    finished_at: datetime | None
    error_code: str | None
    counts: dict[str, int]
    # True when the document's current domains came from more than one
    # extraction run (e.g. a domain-scoped rerun completed for some domains
    # but not others). `counts` is always summed across every domain
    # regardless -- this flag is what stops that sum, and the rest of this
    # object's fields, from being presented as one named run's output.
    is_mixed_generation: bool = False


class FlagsSummary(_Model):
    unresolved: int
    total: int


class DocumentReviewOut(_Model):
    """The review screen's read model (plan §D `DocumentReview`)."""

    document: DocumentMeta
    extraction: ReviewExtraction | None
    sections: list[ReviewSection]
    flags_summary: FlagsSummary


class EvidenceIn(_Model):
    page_number: int = Field(ge=1)
    excerpt: str = Field(min_length=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None


class MetricEditIn(_Model):
    metric_ref: str
    domain_id: str
    value: object = None
    raw_value: str | None = None
    availability_status: str
    evidence: EvidenceIn
    note: str | None = None


class MetricEditsBody(_Model):
    edits: list[MetricEditIn] = Field(min_length=1)


class ApproveBody(_Model):
    override_flags: bool = False
    note: str | None = None


class ApproveResult(_Model):
    document_id: int
    activated_domains: list[str]
    extraction_id: str | None


class RejectBody(_Model):
    reason: str = Field(min_length=1)


class RerunBody(_Model):
    domains: list[str] | None = None


class RerunResult(_Model):
    extraction_id: str
