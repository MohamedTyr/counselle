"""Wire request/response models for `GET /v1/schools/explore` and `/majors`
(plan §5.3). Kept separate from `app/facts/response_models.py` (the facts
page's shapes) -- two different screens, two different reasons to change.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from counselle_db.models import FrozenModel

Control = Literal["public", "private", "private_for_profit"]
TestPolicy = Literal["required", "considered", "not_required", "not_reported"]
Gender = Literal["coed", "women", "men"]
CampusSettingFamily = Literal["City", "Suburb", "Town", "Rural"]
SizeBucket = Literal["lt2k", "2k-10k", "10k-25k", "gt25k"]
ScoreFit = Literal["any", "at_or_above_p25", "inside_band", "at_or_above_p75"]
ExclusionReason = Literal["missing", "not_reported"]

# plan §5.3's `RangeKey` union, minus the columns Phase 1's explore
# projection never populates (net price, out-of-state %, admit rate by home
# state, REA, any SAT composite -- dropped by the plan itself, R14/D10) and
# minus `sports`/ethnicity (no §5.3 filter reads them). `need_fully_met` and
# `merit_aid` are real columns with a real filter but are NULL on every row
# today -- see this unit's final report.
RangeKey = Literal[
    "admit",
    "cost",
    "needMet",
    "needFullyMet",
    "meritAid",
    "gradFour",
    "gradSix",
    "retention",
    "ratio",
    "housing",
    "international",
]


class ExploreQuery(BaseModel):
    """`GET /v1/schools/explore`'s bound query model (plan §5.3)."""

    q: str | None = None
    state: list[str] = Field(default_factory=list)
    region: list[str] = Field(default_factory=list)
    size_bucket: list[SizeBucket] = Field(default_factory=list)
    control: Control | None = None
    test_policy: TestPolicy | None = None
    campus_setting: list[CampusSettingFamily] = Field(default_factory=list)
    # A specific affiliation name, or the two frontend-authored sentinels
    # (plan §5.3): "any_affiliated" | "none_on_file".
    religious_affiliation: str | None = None
    gender: Gender | None = None
    hbcu: bool = False
    hsi: bool = False
    tribal: bool = False
    land_grant: bool = False
    entrance_difficulty: str | None = None
    calendar: str | None = None
    major: str | None = None
    no_application_fee: bool = False
    offers_early_decision: bool = False
    offers_early_action: bool = False
    rolling_admission: bool = False
    include_rolling: bool = False
    deadline_before: date | None = None
    home_state: str | None = None
    score_fit: ScoreFit = "any"
    sat_math: int | None = None
    sat_ebrw: int | None = None
    act: int | None = None
    # Percentage-point scale (0-100), not a 0-1 fraction: `school_explore`'s
    # rate/pct columns mirror the underlying percent-kind fact's `value_num`
    # verbatim (e.g. "58%" -> 58), matching what the facts page displays.
    # Appendix B's superseded draft assumed 0-1; live data (measured against
    # the running crawl) confirms 0-100 -- see this unit's final report.
    admit_min: float | None = Field(default=None, ge=0, le=100)
    admit_max: float | None = Field(default=None, ge=0, le=100)
    cost_min: float | None = None
    cost_max: float | None = None
    need_met_min: float | None = None
    need_met_max: float | None = None
    need_fully_met_min: float | None = None
    need_fully_met_max: float | None = None
    merit_aid_min: float | None = None
    merit_aid_max: float | None = None
    grad_four_min: float | None = None
    grad_four_max: float | None = None
    grad_six_min: float | None = None
    grad_six_max: float | None = None
    retention_min: float | None = None
    retention_max: float | None = None
    ratio_min: float | None = None
    ratio_max: float | None = None
    housing_min: float | None = None
    housing_max: float | None = None
    international_min: float | None = None
    international_max: float | None = None
    include_missing: list[RangeKey] = Field(default_factory=list)
    sort: str = "name:asc"
    page: int = Field(default=1, ge=1)
    page_size: int | None = Field(default=None, ge=1)


class ExploreSchoolCard(FrozenModel):
    """One `school_explore` row, verbatim by column name -- deliberately not a
    100-field hand-typed mirror (one source of truth: `adapters.facts_store.EXPLORE_COLUMNS`).
    """

    unitid: int
    name: str
    city: str | None
    state: str | None
    website_url: str | None
    fields: dict[str, object]


class Exclusion(FrozenModel):
    key: str
    metric_label: str
    count: int
    reason: ExclusionReason


class NullTail(FrozenModel):
    count: int
    metric_label: str


class Narrowest(FrozenModel):
    key: str
    label: str
    remaining_without_it: int


class FilterOption(FrozenModel):
    value: str
    label: str
    states: str | None = None


class FilterOptions(FrozenModel):
    region: tuple[FilterOption, ...]
    campus_setting: tuple[FilterOption, ...]
    religious_affiliation: tuple[FilterOption, ...]


class ExploreResponse(FrozenModel):
    schools: tuple[ExploreSchoolCard, ...]
    page: int
    page_size: int
    total: int
    total_is_capped: bool
    browsable_total: int
    catalog_total: int
    exclusions: tuple[Exclusion, ...]
    sorted_null_tail: NullTail | None
    control_counts: dict[Control, int]
    narrowest: Narrowest | None
    filter_options: FilterOptions
    facts_observed_from: str | None
    band_caption: str
    entrance_difficulty_note: str
    majors_match_note: str
    religious_affiliation_note: str


class MajorOption(FrozenModel):
    name: str
    school_count: int


class MajorsResponse(FrozenModel):
    majors: tuple[MajorOption, ...]
    majors_match_note: str
