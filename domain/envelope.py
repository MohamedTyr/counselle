"""Strict v2 citation and value-envelope contracts."""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

type JsonScalar = str | int | float | bool
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue] | None
# "db" added school-data-v3 Phase 3 -- Counselle's own CollegeData
# facts store, minted by `app/tool_middleware.py` for `get_facts`,
# `get_school_profile`, and `resolve_school` (plan §5.4/§6a). Nothing mints
# "cds" or "profile" any more (`get_domain` is deleted; `app/viz.py`'s
# profile-cell path moved onto "db" during the same source-vocabulary
# resolution) -- but appendix F-iii's call to retire both from this Literal is
# WRONG and must not be done: sessions are durable via the LangGraph
# Postgres checkpointer with no backfill migration (ADR 0019), and
# `RegisteredSource.citation` (`app/state.py`) re-validates every persisted
# `source_registry` entry against this exact `Citation` model on every read
# of a session's turn history (`app/turns.py`, `app/agent_node.py`,
# `app/run_turn.py`) -- not just on resume. A session that ever called
# `get_domain` (live 2026-08-27 until this change) or the pre-F9
# `get_school_profile` (which minted "profile", not "db", until this same
# Phase 3) still carries those literals in its checkpointed state. Dropping
# them from `SourceName` would not fail a test -- it would throw the moment
# a real session's history is next read. "cds" and "profile" are therefore
# kept as read-only/replay-only members: no code may mint them again (only
# "db" for this data going forward), but the type must keep accepting them.
SourceName = Literal["cds", "profile", "web", "edu", "reddit", "db"]
Tier = Literal["official", "community"]
SourceCurrentness = Literal["current", "historical", "undated"]
SourcePeriodBasis = Literal["page_content", "metadata"]

_SHA256 = re.compile(r"^[0-9a-f]{64}$")

# The eight v3 caveat kinds (school-data-v3 Phase 3; plan §6a).
# `config/assets/caveats.yaml` and `app/caveats.py::caveat_catalog()`'s
# expected-kind set are pinned equal to this literal by a test
# (`tests/app/test_caveats.py`) -- this is the one place the set is spelled
# out; the other two derive from it or are checked against it.
CaveatKind = Literal[
    "profile_snapshot",
    "coverage_denominator",
    "not_reported",
    "not_collected",
    "not_fetched",
    "not_published",
    "stale_facts",
    "observed_at_spread",
]


class Caveat(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: CaveatKind
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
    # `None` only for "db" (Counselle's own data carries no source tier,
    # school-data-v3 §5.4); required for every other source -- enforced
    # below, not by the type, so a missing tier on cds/profile/web/edu/reddit
    # still fails loudly instead of silently defaulting.
    tier: Tier | None = None
    vintage: str = Field(min_length=1)
    url: str | None = None
    document_sha256: str | None = None
    source_kind: str | None = None
    retrieved_at: datetime | None = None
    academic_year: int | None = None
    manifest_version: str | None = None
    school_unitid: int | None = None
    profile_sha256: str | None = None
    # "db"-only (school-data-v3 §5.4): when Counselle last confirmed this
    # school's facts. `None` on a `db` citation minting the identity vintage
    # instead (no facts vintage over a null confirmation date); always
    # `None` on every other source.
    facts_updated_at: date | None = None
    source_period: str | None = None
    source_period_basis: SourcePeriodBasis | None = None
    source_period_evidence: str | None = None
    source_currentness: SourceCurrentness | None = None

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
            if self.facts_updated_at is not None:
                raise ValueError("CDS citations cannot carry a facts-store confirmation date")
        elif self.source == "profile":
            if self.tier != "official" or not (
                self.school_unitid
                and self.profile_sha256
                and _SHA256.fullmatch(self.profile_sha256)
            ):
                raise ValueError("profile citations require their official snapshot identity")
            if any(db_fields[:5]):
                raise ValueError("profile citations cannot carry CDS document identity")
            if self.facts_updated_at is not None:
                raise ValueError("profile citations cannot carry a facts-store confirmation date")
        elif self.source == "db":
            if self.tier is not None:
                raise ValueError("Counselle database citations carry no source tier")
            if not self.school_unitid:
                raise ValueError("database citations require the school they describe")
            if self.url is not None:
                raise ValueError("database citations carry no source URL")
            if any(db_fields[:5]) or self.profile_sha256 is not None:
                raise ValueError("database citations cannot carry CDS/profile document identity")
        else:
            if self.tier is None or not self.url:
                raise ValueError(f"{self.source} citations require a URL and a tier")
            if self.source == "reddit" and self.tier != "community":
                raise ValueError("reddit citations require tier community")
            if self.source == "edu" and self.tier != "official":
                raise ValueError("edu citations require tier official")
            if any(db_fields):
                raise ValueError("external citations cannot carry database identity")
            if self.facts_updated_at is not None:
                raise ValueError("external citations cannot carry a facts-store confirmation date")
        period_fields = (
            self.source_period,
            self.source_period_basis,
            self.source_period_evidence,
            self.source_currentness,
        )
        if self.source in {"cds", "profile", "db"} and any(period_fields):
            raise ValueError("database citations cannot carry web source-period evidence")
        if self.source_currentness in {"current", "historical"} and not all(
            period_fields[:3]
        ):
            raise ValueError("dated web currentness requires source-period evidence")
        if self.source_currentness == "undated" and any(period_fields[:3]):
            raise ValueError("undated web citations cannot claim source-period evidence")
        if self.source_currentness is None and any(period_fields[:3]):
            raise ValueError("source-period evidence requires an explicit currentness")
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
