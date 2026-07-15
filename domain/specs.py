"""Typed specs: source-config (ADR 0013), clarify (ARCHITECTURE §12.1), render (§17).

These are the contracts between the agent and every client: the agent emits a
spec, a dumb widget renders it.
"""

import re
from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from domain.envelope import Citation, CitationEnvelope, JsonValue


class SourceConfig(BaseModel):
    """Per-request source toggles — a disabled source's tool is never mounted."""

    web: bool
    reddit: bool
    reddit_subreddits: list[str] | None = None  # None = the full menu
    edu: bool

    @classmethod
    def defaults_from(cls, settings: Any) -> "SourceConfig":
        """Build the default config from a settings-ish object or mapping."""

        def read(name: str) -> bool:
            try:
                if isinstance(settings, dict):
                    return bool(settings[name])
                return bool(getattr(settings, name))
            except (KeyError, AttributeError) as exc:  # programmer/config error
                raise ValueError(f"settings object is missing {name!r}") from exc

        return cls(
            web=read("source_web_default"),
            reddit=read("source_reddit_default"),
            edu=read("source_edu_default"),
        )


class ClarifyOption(BaseModel):
    """One answer chip: a label plus a hint about what picking it means."""

    label: str
    hint: str


class ClarifySpec(BaseModel):
    """One focused clarifying question, 2-4 options, never an intake form.

    "Other" free-text is ALWAYS rendered by the widget — it is never one of
    these options, and a typed reply is always treated as the answer.
    """

    v: int = 1
    question: str
    header: str
    multi_select: bool
    options: list[ClarifyOption] = Field(min_length=2, max_length=4)


_DOMAIN = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def plausible_domain(value: str) -> str:
    """Validate a bare, plausible DNS host used only as viz decoration."""
    normalized = value.strip().casefold().rstrip(".")
    if not _DOMAIN.fullmatch(normalized):
        raise ValueError("domain must be a plausible bare DNS host")
    return normalized


class ColumnInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    unitid: int | None = None
    name: str | None = None
    domain: str | None = None

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str | None) -> str | None:
        return plausible_domain(value) if value is not None else None

    @model_validator(mode="after")
    def require_identity(self) -> "ColumnInput":
        if self.unitid is None and (self.name is None or not self.name.strip()):
            raise ValueError("a web-only column requires a nonblank name")
        return self


class MetricCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    metric_ref: str


class ProfileCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    profile_field: str


class SourcedCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    display: str = Field(min_length=1)
    raw: JsonValue = None
    marker: str


class UnavailableCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    unavailable: Literal[True]


CellInput = Annotated[
    MetricCellInput | ProfileCellInput | SourcedCellInput | UnavailableCellInput,
    Field(union_mode="left_to_right"),
]


class VizRowInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    label: str = Field(min_length=1)
    cells: tuple[CellInput, ...]


class SchoolRef(BaseModel):
    """A school as named in a visualization.

    ``domain`` is the registrable host of the school's ``institution.website``
    (e.g. ``nyu.edu``), derived live from the DB — the client builds a favicon
    URL from it and degrades to a monogram when absent or when the CDN fails.
    Never a stored/hardcoded logo.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    unitid: int | None = None
    name: str = Field(min_length=1)
    domain: str | None = None


class AvailableResolvedCell(CitationEnvelope):
    """A rendered value whose complete truth and provenance are resolved."""

    available: Literal[True] = True
    display: str = Field(min_length=1)
    citation: Citation
    marker: str = Field(pattern=r"^\[[1-9]\d*\]$")


class UnavailableResolvedCell(CitationEnvelope):
    """The only rendered missing-value state; deliberately inert."""

    available: Literal[False] = False
    display: Literal["not available"] = "not available"
    raw: None = None
    unit: None = None
    citation: None = None
    evidence: None = None
    marker: None = None


ResolvedCell = Annotated[
    AvailableResolvedCell | UnavailableResolvedCell,
    Field(discriminator="available"),
]


class VizRow(BaseModel):
    """One labeled row of envelope cells in a render spec."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    label: str = Field(min_length=1)
    cells: tuple[ResolvedCell, ...]

    @field_validator("cells", mode="before")
    @classmethod
    def dump_envelope_instances(cls, value: Any) -> Any:
        return tuple(
            cell.model_dump(mode="python") if isinstance(cell, CitationEnvelope) else cell
            for cell in value
        )


class TabularRenderSpec(BaseModel):
    """A visualization: the LLM picked the shape, the tool fetched the numbers."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    type: Literal["stat_block", "comparison_table"]
    title: str
    columns: tuple[SchoolRef, ...]
    rows: tuple[VizRow, ...]

    @model_validator(mode="after")
    def validate_grid(self) -> "TabularRenderSpec":
        if not self.columns or not self.rows:
            raise ValueError("tabular render specs require columns and rows")
        if any(len(row.cells) != len(self.columns) for row in self.rows):
            raise ValueError("every row must have exactly one cell per column")
        expected = 1 if self.type == "stat_block" else 2
        if (self.type == "stat_block" and len(self.columns) != expected) or (
            self.type == "comparison_table" and len(self.columns) < expected
        ):
            raise ValueError(f"invalid column count for {self.type}")
        return self


class OpaqueRenderSpec(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)
    v: int
    type: str
    title: str | None = None

    @field_validator("type")
    @classmethod
    def nonblank_type(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("render spec type must be nonblank")
        return value


RenderSpec = TabularRenderSpec
ParsedRenderSpec = TabularRenderSpec | OpaqueRenderSpec
_TABULAR_ADAPTER = TypeAdapter(TabularRenderSpec)
_OPAQUE_ADAPTER = TypeAdapter(OpaqueRenderSpec)


def parse_render_spec(payload: Mapping[str, Any] | ParsedRenderSpec) -> ParsedRenderSpec:
    """Strictly parse known v2 tables and preserve all unknown-type payload keys."""
    raw = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else dict(payload)
    if raw.get("type") in {"stat_block", "comparison_table"}:
        return _TABULAR_ADAPTER.validate_python(raw)
    return _OPAQUE_ADAPTER.validate_python(raw)
