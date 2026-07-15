"""Strict v2 citation and value-envelope contracts."""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

type JsonScalar = str | int | float | bool
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue] | None
SourceName = Literal["cds", "profile", "web", "edu", "reddit"]
Tier = Literal["official", "community"]
Unit = Literal["percent", "currency", "count", "number", "bool", "text", "date"]

_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class Caveat(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    text: str = Field(min_length=1)


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    eid: str
    value_display: str
    label: str
    page: int = Field(ge=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None
    excerpt: str = Field(min_length=1)


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    source: SourceName
    tier: Tier
    vintage: str = Field(min_length=1)
    url: str | None = None
    document_sha256: str | None = None
    source_kind: str | None = None
    retrieved_at: datetime | None = None
    academic_year: int | None = None
    manifest_version: str | None = None
    school_unitid: int | None = None
    profile_sha256: str | None = None

    @model_validator(mode="after")
    def validate_identity(self) -> Citation:
        db_fields = (
            self.document_sha256,
            self.source_kind,
            self.retrieved_at,
            self.academic_year,
            self.manifest_version,
            self.school_unitid,
            self.profile_sha256,
        )
        if self.source == "cds":
            if self.tier != "official" or not (
                self.document_sha256
                and _SHA256.fullmatch(self.document_sha256)
                and self.source_kind
                and self.retrieved_at
                and self.academic_year
                and self.manifest_version
                and self.school_unitid
            ):
                raise ValueError("CDS citations require their complete official document identity")
            if self.profile_sha256 is not None:
                raise ValueError("CDS citations cannot carry profile identity")
        elif self.source == "profile":
            if self.tier != "official" or not (
                self.school_unitid
                and self.profile_sha256
                and _SHA256.fullmatch(self.profile_sha256)
            ):
                raise ValueError("profile citations require their official snapshot identity")
            if any(db_fields[:5]):
                raise ValueError("profile citations cannot carry CDS document identity")
        else:
            expected = "community" if self.source == "reddit" else "official"
            if self.tier != expected or not self.url:
                raise ValueError(f"{self.source} citations require tier {expected} and a URL")
            if any(db_fields):
                raise ValueError("external citations cannot carry database identity")
        return self


class CitationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    field: str | None
    label: str
    display: str
    raw: JsonValue = None
    available: bool
    unit: str | None = None
    citation: Citation | None = None
    evidence: EvidenceItem | None = None
    caveats: tuple[Caveat, ...] = ()
    marker: str | None = None

    @field_validator("raw")
    @classmethod
    def raw_must_be_finite_json(cls, value: JsonValue) -> JsonValue:
        reject_non_finite_json(value)
        return value

    @model_validator(mode="after")
    def validate_availability(self) -> CitationEnvelope:
        if not self.available:
            if self.display != "not available" or any(
                value is not None
                for value in (self.raw, self.unit, self.citation, self.evidence, self.marker)
            ):
                raise ValueError("unavailable envelopes use the exact uncited null shape")
            return self
        if not self.display.strip() or self.citation is None:
            raise ValueError("available envelopes require a citation and nonblank display")
        if isinstance(self.raw, float) and not math.isfinite(self.raw):
            raise ValueError("non-finite floats are not JSON values")
        if self.citation.source == "cds" and (
            self.evidence is None
            or self.evidence.eid != self.field
            or self.evidence.value_display != self.display
        ):
            raise ValueError("available CDS envelopes require matching exact evidence")
        if self.citation.source != "cds" and self.evidence is not None:
            raise ValueError("only CDS envelopes carry evidence")
        return self


def reject_non_finite_json(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("non-finite floats are not JSON values")
    if isinstance(value, list):
        for child in value:
            reject_non_finite_json(child)
    elif isinstance(value, dict):
        for child in value.values():
            reject_non_finite_json(child)
