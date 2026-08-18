"""Pydantic authoring-schema models for ``config/cds/*.yaml``.

These replace the ~690 lines of hand-rolled key/vocabulary checking in the old
pipeline's ``library/manifest.py`` (see ``plans/cds-pipeline/recon-old-pipeline.md``
§2) with declarative Pydantic models. The closed vocabularies (``UNITS``,
``POPULATIONS``, ``DENOMINATORS``, ``DEFINITION_VARIANTS``) and the required/
allowed key sets are copied **verbatim** from that module — any drift here
changes which YAML validates, not what a *valid* manifest hashes to.

Compilation (``manifest_compile.py``) uses these models purely as a validation
gate; the raw YAML dicts (unchanged) still flow into the hashed content, which
is what keeps the port byte-identical to the live manifest (plan §B2).
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EXTRACTION_CONTRACT_VERSION = "8"

_ID = re.compile(r"^[a-z][a-z0-9_]*$")
_FULL_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")

MetricType = Literal["integer", "number", "string", "boolean", "enum"]
PeriodKind = Literal[
    "academic_year", "admission_cycle", "aid_year", "cohort_year", "cost_year",
    "degree_window", "document", "fall_term", "policy", "reporting_cycle",
]
FormulaOperation = Literal["ratio", "sum", "difference"]

UNITS = frozenset({
    "academic_year", "applicants", "awards", "boolean", "carnegie_units", "category",
    "count", "credits",
    "date", "email", "faculty", "gpa", "percent", "ratio", "score", "sections",
    "source_unit_value", "students", "text", "url", "usd", "weeks", "years",
})
POPULATIONS = frozenset({
    "aided_undergraduates", "all_or_most_students", "all_students", "all_students_full_time",
    "all_students_part_time", "all_undergraduates",
    "bachelors_cohort_neither_pell_nor_subsidized_stafford", "bachelors_cohort_pell_grant",
    "bachelors_cohort_subsidized_stafford_no_pell", "conferred_majors",
    "degree_seeking_nonresident_undergraduates", "degree_seeking_undergraduates",
    "domestic_first_year_aid_applicants",
    "enrolled_first_time_first_year",
    "enrolled_first_time_first_year_act_submitters",
    "enrolled_first_time_first_year_gpa_reported",
    "enrolled_first_time_first_year_rank_reported",
    "enrolled_first_time_first_year_sat_submitters", "enrolled_undergraduates",
    "first_time_bachelors_graduates", "first_time_first_year", "first_time_first_year_men",
    "first_time_first_year_waitlist",
    "first_time_first_year_women", "first_time_full_time_bachelors_cohort",
    "first_time_part_time_bachelors_cohort", "first_time_undergraduate",
    "first_year_students", "first_year_undergraduates", "full_time_first_year_undergraduates",
    "full_time_undergraduates",
    "graduate", "graduate_full_time", "graduate_part_time", "institution",
    "incoming_students", "institutional_aid_applicants", "instructional_faculty",
    "less_than_full_time_undergraduates",
    "nonresident_first_year_aid_applicants",
    "prospective_undergraduate", "student_faculty_ratio_instructional_faculty",
    "student_faculty_ratio_students", "transfer", "two_year_cohort", "undergraduate",
    "undergraduate_class_sections", "undergraduate_class_subsections",
    "undergraduate_commuter_at_home", "undergraduate_commuter_not_at_home",
    "undergraduate_institution", "undergraduate_on_campus", "undergraduates",
    "undergraduate_part_time",
})
DENOMINATORS = frozenset({
    "academic_year", "act_composite_submitters", "act_english_submitters",
    "act_math_submitters", "act_reading_submitters", "act_science_submitters",
    "act_writing_submitters", "adjusted_cohort", "admitted_total", "any_aid_recipients",
    "applicants_total", "application", "associate_conferred_majors",
    "bachelors_conferred_majors", "class_sections", "cohort", "credit",
    "demonstrated_need", "diploma_certificate_conferred_majors", "domestic_enrolled_students",
    "enrolled_students", "full_time_equivalent_faculty", "full_time_undergraduates",
    "gpa_reported_students", "gpa_reported_test_score_nonsubmitters",
    "gpa_reported_test_score_submitters", "institutional_athletic_grant_recipients",
    "graduating_class_first_time_bachelors_count", "loan_borrowers", "men_enrolled",
    "need_based_aid_recipients",
    "need_based_grant_recipients", "need_based_loan_recipients",
    "need_based_self_help_recipients", "no_need_institutional_grant_recipients",
    "non_need_based_aid_recipients", "none", "nonresident_institutional_aid_recipients",
    "rank_reported_students", "sat_composite_submitters", "sat_ebrw_submitters",
    "sat_math_submitters", "term", "waitlist_accepted", "waitlist_total", "women_enrolled",
})
DEFINITION_VARIANTS = frozenset({
    "availability", "average", "capacity", "deadline", "derived", "estimated", "maximum",
    "minimum", "percentile_25", "percentile_50", "percentile_75", "policy", "printed",
    "published", "rate", "recommended", "reported", "required", "selected",
    "selected_list", "share", "total",
})
TARGET_SELECTORS = frozenset(
    {"all", "source_hints", "metric_ids", "metric_id_prefixes", "period_kinds"}
)
NON_SEMANTIC_METRIC_KEYS = frozenset({"title"})


class ManifestError(ValueError):
    """An authoring error that must be fixed before a manifest can compile."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("must be nonempty text")
    return value


def _unique_nonempty(values: tuple[str, ...], *, label: str) -> tuple[str, ...]:
    if not values:
        raise ValueError(f"{label} must be a nonempty list")
    if len(set(values)) != len(values):
        raise ValueError(f"{label} must not repeat entries")
    return values


class Formula(_Strict):
    """Derived-metric spec; excluded from the provider schema (never sent to the model)."""

    operation: FormulaOperation
    inputs: tuple[str, ...] = Field(min_length=2)

    @field_validator("inputs")
    @classmethod
    def _inputs_are_metric_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for item in value:
            if not (_ID.fullmatch(item) or _FULL_METRIC_ID.fullmatch(item)):
                raise ValueError(f"invalid formula input id: {item!r}")
        return value


class Metric(_Strict):
    """One metric authored in a ``config/cds/domains/*.yaml`` file (local id, not yet
    domain-qualified — see ``manifest_compile._canonicalize_domains``)."""

    id: str
    title: str | None = None
    description: str
    type: MetricType
    unit: str
    population: str
    denominator: str
    definition_variant: str
    period_kind: PeriodKind
    source_hints: tuple[str, ...] = Field(min_length=1)
    instructions: str
    enums: tuple[str, ...] | None = None
    formula: Formula | None = None

    @field_validator("id")
    @classmethod
    def _id_is_stable(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("metric id must be a stable lowercase ID")
        return value

    @field_validator("description", "instructions")
    @classmethod
    def _text_nonblank(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("unit")
    @classmethod
    def _unit_known(cls, value: str) -> str:
        if value not in UNITS:
            raise ValueError(f"invalid unit {value!r}")
        return value

    @field_validator("population")
    @classmethod
    def _population_known(cls, value: str) -> str:
        if value not in POPULATIONS:
            raise ValueError(f"invalid population {value!r}")
        return value

    @field_validator("denominator")
    @classmethod
    def _denominator_known(cls, value: str) -> str:
        if value not in DENOMINATORS:
            raise ValueError(f"invalid denominator {value!r}")
        return value

    @field_validator("definition_variant")
    @classmethod
    def _definition_variant_known(cls, value: str) -> str:
        if value not in DEFINITION_VARIANTS:
            raise ValueError(f"invalid definition_variant {value!r}")
        return value

    @field_validator("source_hints")
    @classmethod
    def _source_hints_nonblank(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if not value or any(not hint.strip() for hint in value):
            raise ValueError("source_hints must be a nonempty list of text")
        return value

    @model_validator(mode="after")
    def _enums_match_type(self) -> Metric:
        if self.type == "enum":
            if not self.enums:
                raise ValueError("enum metrics need unique enum values")
            if any(not _ID.fullmatch(item) for item in self.enums):
                raise ValueError("enum values must be stable lowercase IDs")
            if len(set(self.enums)) != len(self.enums):
                raise ValueError("enum metrics need unique enum values")
        elif self.enums is not None:
            raise ValueError("enums are valid only for enum metrics")
        return self


class ContextTargets(_Strict):
    """Selector shape only; matching against a domain's local metrics happens at
    compile time (``manifest_compile._compile_contexts``), where the sibling
    metrics are known."""

    all: bool | None = None
    source_hints: tuple[str, ...] | None = None
    metric_ids: tuple[str, ...] | None = None
    metric_id_prefixes: tuple[str, ...] | None = None
    period_kinds: tuple[PeriodKind, ...] | None = None

    @model_validator(mode="after")
    def _exactly_all_or_selectors(self) -> ContextTargets:
        selectors = (self.source_hints, self.metric_ids, self.metric_id_prefixes, self.period_kinds)
        if self.all is True:
            if any(value is not None for value in selectors):
                raise ValueError("all:true is exclusive")
        else:
            if self.all is not None:
                raise ValueError("all must be true or omitted")
            if not any(selectors):
                raise ValueError("targets require selectors or exclusive all:true")
        for value in selectors:
            if value is not None:
                _unique_nonempty(value, label="target selector")
        return self


class ContextBinding(_Strict):
    id: str
    label: str
    binders: tuple[str, ...] = Field(min_length=1)
    targets: ContextTargets

    @field_validator("id")
    @classmethod
    def _id_is_stable(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("context id must be a stable lowercase ID")
        return value

    @field_validator("label")
    @classmethod
    def _label_nonblank(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("binders")
    @classmethod
    def _binders_valid(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        _unique_nonempty(value, label="binders")
        for binder in value:
            if not (_ID.fullmatch(binder) or _FULL_METRIC_ID.fullmatch(binder)):
                raise ValueError(f"invalid binder reference {binder!r}")
        return value


class Domain(_Strict):
    id: str
    title: str
    metrics: tuple[Metric, ...] = Field(min_length=1)
    context_bindings: tuple[ContextBinding, ...] = ()

    @field_validator("id")
    @classmethod
    def _id_is_stable(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("domain id must be a stable lowercase ID")
        return value

    @field_validator("title")
    @classmethod
    def _title_nonblank(cls, value: str) -> str:
        return _nonblank(value)

    @model_validator(mode="after")
    def _unique_metric_ids(self) -> Domain:
        ids = [metric.id for metric in self.metrics]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate metric ID within domain")
        return self


class RootManifest(_Strict):
    version: str
    description: str
    extraction_groups: tuple[tuple[str, ...], ...] = Field(min_length=1)
    page_routing_enabled: bool

    @field_validator("version", "description")
    @classmethod
    def _text_nonblank(cls, value: str) -> str:
        return _nonblank(value)

    @field_validator("extraction_groups")
    @classmethod
    def _groups_nonempty(cls, value: tuple[tuple[str, ...], ...]) -> tuple[tuple[str, ...], ...]:
        for group in value:
            if not group:
                raise ValueError("each extraction group must be a nonempty list of domain IDs")
        return value
