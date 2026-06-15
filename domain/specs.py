"""Typed specs: source-config (ADR 0013), clarify (ARCHITECTURE §12.1), render (§17).

These are the contracts between the agent and every client: the agent emits a
spec, a dumb widget renders it. The score-band validator encodes the §17
honesty trap — IPEDS SAT percentiles are per *section* and must never be
combined into a fabricated 1600-scale composite row.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from domain.envelope import CitationEnvelope


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


class SchoolRef(BaseModel):
    """A school as named in a visualization.

    ``domain`` is the registrable host of the school's ``institution.website``
    (e.g. ``nyu.edu``), derived live from the DB — the client builds a favicon
    URL from it and degrades to a monogram when absent or when the CDN fails.
    Never a stored/hardcoded logo.
    """

    unitid: int
    name: str
    domain: str | None = None


class VizRow(BaseModel):
    """One labeled row of envelope cells in a render spec."""

    label: str
    cells: list[CitationEnvelope]


class ScoreBand(BaseModel):
    """Score-band chart definition: which test the band describes."""

    test: Literal["sat", "act", "both"]


class RenderSpec(BaseModel):
    """A visualization: the LLM picked the shape, the tool fetched the numbers."""

    v: int = 1
    type: Literal["stat_block", "comparison_table", "score_band"]
    title: str
    schools: list[SchoolRef]
    rows: list[VizRow]
    band: ScoreBand | None = None

    @model_validator(mode="after")
    def _reject_fabricated_sat_composite(self) -> "RenderSpec":
        """§17 honesty trap: never combine SAT EBRW + Math percentiles in one row."""
        if self.type != "score_band":
            return self
        for row in self.rows:
            fields = [cell.field for cell in row.cells]
            mixes_sections = any("sat_ebrw" in f for f in fields) and any(
                "sat_math" in f for f in fields
            )
            if mixes_sections:
                raise ValueError(
                    "score_band row mixes SAT EBRW and SAT Math percentiles — a "
                    "fabricated composite; render the sections as separate rows"
                )
        return self
