"""Typed results for the counselle-db service layer (the real API — eng-review D2).

Every value travels as a ``CitationEnvelope`` (built only by
``service.envelope_for``); these models are the structured shells around them.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from domain.envelope import Citation, CitationEnvelope
from domain.tiers import CoverageTier


class ServiceError(Exception):
    """A tool-level error with an agent-readable message (never a stack trace)."""


class SchoolBasics(BaseModel):
    """Identity columns from ``public.schools`` (control is already decoded — R12)."""

    unitid: int
    name: str
    city: str | None = None
    state: str | None = None
    control: str | None = None
    level: str | None = None


class ResolveMatch(BaseModel):
    status: Literal["match"] = "match"
    school: SchoolBasics
    coverage_tier: CoverageTier
    tier_explanation: str


class ResolveCandidates(BaseModel):
    status: Literal["candidates"] = "candidates"
    candidates: list[SchoolBasics]
    hint: str


class ResolveNotFound(BaseModel):
    status: Literal["not_found"] = "not_found"
    message: str


ResolveResult = ResolveMatch | ResolveCandidates | ResolveNotFound


class FieldKeyError(BaseModel):
    """Per-key error entry for an unknown field key — never an invented row (ADR 0014)."""

    field: str
    error: str


class DossierSection(BaseModel):
    id: str
    title: str
    values: list[CitationEnvelope]


class ProgramRow(BaseModel):
    """One ``raw.scorecard_fos`` program row; suppressed cells stay null (§8)."""

    cipcode: str
    cipdesc: str
    credlev: int
    creddesc: str | None = None
    completions: int | None = None
    debt_median: float | None = None
    debt_monthly_payment: float | None = None
    earnings_1yr: float | None = None
    earnings_4yr: float | None = None
    earnings_5yr: float | None = None
    citation: Citation


class RaceGroup(BaseModel):
    race_label: str
    total: int | None = None
    men: int | None = None
    women: int | None = None


class DiversityBreakdown(BaseModel):
    """Undergrad race/sex enrollment (``raw.ipeds_ef2024a``, EFALEVEL='2', §8)."""

    unitid: int
    total: int | None = None
    men: int | None = None
    women: int | None = None
    by_race: list[RaceGroup]
    citation: Citation


class Dossier(BaseModel):
    school: SchoolBasics
    tier: CoverageTier
    tier_explanation: str
    sections: list[DossierSection]
    programs_preview: list[ProgramRow]
    diversity: DiversityBreakdown | None = None
    #: One message per shortlist key that drifted out of the catalog — never silent.
    warnings: list[str] = Field(default_factory=list)


class CompareRow(BaseModel):
    field: str
    label: str
    cells: list[CitationEnvelope]  # one per school, input order; missing → available=False


class CompareResult(BaseModel):
    schools: list[SchoolBasics]
    rows: list[CompareRow]
    errors: list[FieldKeyError] = Field(default_factory=list)


class BenchmarkStat(BaseModel):
    raw: float
    display: str


class BenchmarkResult(BaseModel):
    """National distribution for one field (§14.4), display-normalized."""

    field: str
    label: str
    n: int
    median: BenchmarkStat
    mean: BenchmarkStat
    p25: BenchmarkStat
    p75: BenchmarkStat
    citation: Citation


class FindHit(BaseModel):
    school: SchoolBasics
    values: list[CitationEnvelope]  # the filtered/ordered field values, cited


class QueryResult(BaseModel):
    """Layer-3 escape-hatch result — raw rows, normalization bypassed."""

    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    truncated: bool
