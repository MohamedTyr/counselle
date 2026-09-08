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


class SchoolFactsStatus(FrozenModel):
    """One row of `cds_library.school_data_status` — exists for every school, even one
    with no crosswalk row at all (`has_collegedata=False`) or no completed pass
    (`tabs` all `never_fetched`)."""

    facts_updated_at: datetime | None
    fact_count: int
    has_collegedata: bool
    tabs: dict[str, str]


class ResolvedSchool(FrozenModel):
    status: Literal["match"] = "match"
    school: SchoolBasics
    data: SchoolFactsStatus
    # The identity vintage's date slot ("...identity profile from
    # {snapshot_date}") — plan §5.4/§6a: `resolve_school` always mints the
    # identity vintage, never the facts vintage, so it needs this even
    # though `data` itself carries no snapshot date.
    profile_snapshot_date: date


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


class FactCoverageRow(FrozenModel):
    """One `cds_library.fact_coverage` row for a fact key `query_database` named
    (school-data-v3 Phase 3, `sql_guard._named_fact_keys`): the denominator a
    model must state on any cross-school aggregate or ranking, so a claim like
    "60% of schools require testing" carries how many schools that 60% is of.
    """

    fact_key: str
    schools_with_value: int
    schools_total: int
    as_of: datetime


class QueryResult(FrozenModel):
    columns: tuple[str, ...]
    rows: tuple[tuple[Any, ...], ...]
    row_count: int
    truncated: bool
    as_of: datetime
    warning: str
    coverage: tuple[FactCoverageRow, ...] = ()


# --- CollegeData facts store (school-data-v3 Phase 2) ---
# `FactValueRow`/`SchoolFactsStatus`/`FactsQueryResult` are the raw, typed
# shape of `cds_library.current_school_facts` + `school_data_status` —
# `counselle_db.service.get_facts`'s return value. They deliberately do not
# know about layout (sections/groups/kind) or student-facing copy: that is
# `app/facts/service.py`'s job, reading `Catalog.snapshot.sections` on top
# of this. `explore()`/`majors()` return raw `asyncpg.Record`s instead of a
# typed model — `school_explore_rows` is ~70 nullable columns and a second
# 70-field pydantic mirror of a table `app/facts/service_explore.py` already
# reads by name would be the "two homes for one shape" case CLAUDE.md's
# one-source-of-truth rule forbids; the type boundary is drawn at the
# response model instead (`app/facts/response_models.py`).


class FactValueRow(FrozenModel):
    """One row of `cds_library.current_school_facts` (a fact this school has a value for)."""

    fact_key: str
    tab: str
    section: str
    label: str
    value: Any
    display: str
    unit: str | None
    value_type: str
    value_num: float | None
    value_text: str | None
    value_bool: bool | None
    value_date: date | None
    reported_period: str | None
    reported_period_year: int | None
    observed_at: datetime


class FactsQueryResult(FrozenModel):
    school: SchoolBasics
    status: SchoolFactsStatus
    rows: tuple[FactValueRow, ...]
    # The identity vintage's date slot — `get_facts` falls back to the
    # identity vintage (never a facts vintage with an empty date slot) when
    # `status.facts_updated_at` is null (plan §5.4/§6a).
    profile_snapshot_date: date
