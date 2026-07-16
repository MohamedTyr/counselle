"""Frozen service boundary models for the CDS Library reader."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class ServiceError(Exception):
    """An expected, student-safe data service failure."""


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SchoolBasics(FrozenModel):
    unitid: int
    name: str
    city: str | None = None
    state: str | None = None
    official_domain: str | None = None


class SchoolCoverage(FrozenModel):
    selected_year: int | None = None
    selected_edition: str | None = None
    document_id: int | None = None
    currentness: str | None = None
    stale_reason: str | None = None
    usable_domain_count: int = 0
    partial_domain_count: int = 0
    usable_domain_ids: tuple[str, ...] = ()
    latest_status: str | None = None
    latest_error_code: str | None = None


class ResolvedSchool(FrozenModel):
    status: Literal["match"] = "match"
    school: SchoolBasics
    coverage: SchoolCoverage


class ResolveCandidates(FrozenModel):
    status: Literal["candidates"] = "candidates"
    candidates: tuple[SchoolBasics, ...]
    hint: str


class ResolveNotFound(FrozenModel):
    status: Literal["not_found"] = "not_found"
    message: str


ResolveResult = ResolvedSchool | ResolveCandidates | ResolveNotFound


class ProfileProvenanceReceipt(BaseModel):
    """Safe, typed subset of a pipeline profile-field receipt."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    status: str | None = None
    chosen_source: str | None = None
    source_column: str | None = None
    source_vintage: str | None = None
    file_sha256: str | None = None
    raw_value: Any = None
    normalized_value: Any = None
    normalization: str | None = None


class ProfileLeaf(FrozenModel):
    ref: str
    label: str
    display: str | None
    available: bool
    value: Any = None
    provenance: ProfileProvenanceReceipt | None = None
    caveat_kinds: tuple[str, ...] = ("profile_snapshot",)


class ProfileGroup(FrozenModel):
    id: str
    rows: tuple[ProfileLeaf, ...]


class ProfileGroupResult(FrozenModel):
    school: SchoolBasics
    profile_version: str
    profile_snapshot_date: date
    profile_sha256: str
    groups: tuple[ProfileGroup, ...]
    valid_groups: tuple[str, ...]


class DomainRow(FrozenModel):
    ref: str
    label: str
    display: str | None
    available: bool
    availability_status: str | None = None
    value: Any = None
    vintage: str
    caveat_kinds: tuple[str, ...] = ()
    evidence: dict[str, Any] | None = None


class AvailabilitySummary(FrozenModel):
    configured: int
    # Source assertions whose extraction_status is verified, including
    # evidence-backed source absences such as not_in_template_version.
    verified: int
    # Verified, reported metrics that carry a typed value and evidence.
    available: int
    not_in_template_version: int


class DomainResult(FrozenModel):
    school: SchoolBasics
    domain_id: str
    academic_year: int | None = None
    document_id: int | None = None
    document_sha256: str | None = None
    source_kind: str | None = None
    retrieved_at: datetime | None = None
    manifest_version: str | None = None
    packet_status: str | None = None
    currentness: str | None = None
    latest_status: str | None = None
    latest_error_code: str | None = None
    definition_match: bool | None = None
    rows: tuple[DomainRow, ...] = ()
    availability: AvailabilitySummary
    summary: str


class QueryResult(FrozenModel):
    columns: tuple[str, ...]
    rows: tuple[tuple[Any, ...], ...]
    row_count: int
    truncated: bool
    as_of: datetime
    warning: str
