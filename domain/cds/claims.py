"""Typed shapes of what the model returns — a claim, never a verified packet metric.

Ported from the old pipeline's ``library/extractor.py`` response models (recon
§4.2/§4.3). A ``Finding`` only becomes packet data after ``packet_build.py``
applies membership/page/type verification; the model itself never sets
``extraction_status``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AvailabilityStatus = Literal[
    "reported", "not_reported", "not_applicable", "suppressed", "not_in_template_version"
]


class Finding(BaseModel):
    """One claim about one metric from one model call."""

    model_config = ConfigDict(extra="forbid")
    metric_id: str
    availability_status: AvailabilityStatus
    value: int | float | str | bool | None = None
    raw_value: str | None = None
    page_number: int = Field(ge=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None
    excerpt: str = Field(min_length=1)

    @field_validator("excerpt")
    @classmethod
    def _excerpt_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("excerpt must not be blank")
        return value


class WindowExtraction(BaseModel):
    """Static response shape for a domain-group extraction call; configured
    metrics are values, not model fields."""

    model_config = ConfigDict(extra="forbid")
    findings: list[Finding] = Field(default_factory=list)


class DomainPageRange(BaseModel):
    """One domain's detected page span; a routing hint, never extracted data."""

    model_config = ConfigDict(extra="forbid")
    domain_id: str
    first_page: int = Field(ge=1)
    last_page: int = Field(ge=1)


class DocumentRouting(BaseModel):
    """Static response shape for the routing pre-call."""

    model_config = ConfigDict(extra="forbid")
    domains: list[DomainPageRange] = Field(default_factory=list)


__all__ = [
    "AvailabilityStatus",
    "DocumentRouting",
    "DomainPageRange",
    "Finding",
    "WindowExtraction",
]
