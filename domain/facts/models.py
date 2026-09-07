"""Typed value shapes the mapper and store hand around (plan §1/§4.4/§5.1).

``TabName``/``TAB_NAMES`` mirror ``cds_library.tab_names()`` in
``deploy/seed/cds_library_schema.sql`` — the domain properly under this
module's roof, and pinned equal to the DDL by
``tests/domain/facts/test_tab_names.py`` (see that file for why the test
lives outside ``domain/`` rather than in it: the purity gate forbids
``domain/facts/`` from reading the seed file itself).

``NormalizedValue`` is the mapper's per-fact output shape. It always
represents a genuine, parsed value — never an absence. A "Not reported"
observation is represented by the *absence* of a ``NormalizedValue``
(``value: NormalizedValue | None`` with ``None`` meaning "no value"), never
by a ``NormalizedValue`` with null fields; see ``normalize.absence_display``
and ``state.fact_state``. This is deliberate: a legitimate ``0`` or ``False``
must round-trip as a real, present ``NormalizedValue`` at full weight
(plan §5.1's "a legitimate 0/false renders at full weight") — never treat
``value_num == 0`` or ``value_bool is False`` as falsy/absent anywhere
downstream.

At most one of ``value_num``/``value_text``/``value_bool``/``value_date`` is
ever set, mirroring ``school_facts_value_shape_check`` in the committed seed
(``num_nonnulls(value_num, value_text, value_bool, value_date) <= 1``) —
compound kinds (``address``, ``range``, ``table``, ``distribution``, ``list``)
carry their data in ``value`` instead, and ``matrix``/``ordinal`` carry a
denormalized ``value_num`` count/rank alongside their structured ``value``.
"""

from __future__ import annotations

from datetime import date as _date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from domain.envelope import JsonValue, reject_non_finite_json

TAB_NAMES: tuple[str, ...] = (
    "overview",
    "admission",
    "money-matters",
    "academics",
    "campus-life",
    "students",
)
TabName = Literal[
    "overview", "admission", "money-matters", "academics", "campus-life", "students"
]

# cds_library.school_pages.last_status CHECK, verbatim.
PageStatus = Literal[
    "ok", "http_error", "not_found", "build_id_rotated", "parse_error", "never_fetched"
]
PAGE_STATUSES: tuple[str, ...] = (
    "ok", "http_error", "not_found", "build_id_rotated", "parse_error", "never_fetched",
)
# The four "checked, but the read failed" statuses (plan §5.1/§5.2): distinct
# from `not_found` (checked; the school genuinely has no such page) and from
# `ok`. A page in one of these is why a fact renders "Not checked" rather
# than "Not on file".
NOT_FETCHED_STATUSES: frozenset[str] = frozenset(
    {"http_error", "build_id_rotated", "parse_error", "never_fetched"}
)

# plan §5.1 — the whole set, exactly five, `not_applicable` retired.
FactState = Literal["value", "not_reported", "not_fetched", "not_published", "not_collected"]
FACT_STATES: tuple[str, ...] = (
    "value", "not_reported", "not_fetched", "not_published", "not_collected",
)

# A section's resolved fetch outcome (plan §5.2) — distinct from FactState:
# a section is `partial` when its contributing tabs disagree, a state no
# single fact can be in.
FetchState = Literal["ok", "partial", "not_fetched", "not_published"]

ValueKind = Literal[
    "money", "percent", "count", "decimal", "bool", "enum", "date", "range",
    "address", "url", "text", "list", "ordinal", "table", "matrix", "distribution",
]
# Kinds whose data lives entirely in `NormalizedValue.value` (compound
# shapes) — no typed column carries their meaning, per §4.4's node table.
COMPOUND_KINDS: frozenset[str] = frozenset({"address", "range", "table", "distribution"})


class NormalizedValue(BaseModel):
    """One normalized CollegeData value, as `normalize.py`'s functions produce it.

    Never represents absence — see the module docstring. `kind` doubles as
    `school_facts.value_type`.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: ValueKind
    display: str = Field(min_length=1)
    unit: str | None = None
    value_num: float | None = None
    value_text: str | None = None
    value_bool: bool | None = None
    value_date: _date | None = None
    # Extra structured payload beyond the typed columns (bucket lists, table
    # rows, address parts, ordinal levels, range bounds, list items). `None`
    # for kinds a typed column already fully captures (money, percent,
    # count, decimal, bool, enum, date, url, text).
    value: JsonValue = None

    @field_validator("value")
    @classmethod
    def _value_is_finite_json(cls, value: JsonValue) -> JsonValue:
        reject_non_finite_json(value)
        return value

    @model_validator(mode="after")
    def _at_most_one_typed_column(self) -> NormalizedValue:
        typed = (self.value_num, self.value_text, self.value_bool, self.value_date)
        if sum(1 for column in typed if column is not None) > 1:
            raise ValueError(
                "at most one of value_num/value_text/value_bool/value_date may be set "
                "(mirrors cds_library.school_facts_value_shape_check)"
            )
        return self


class FactRow(BaseModel):
    """One mapped fact, ready for `adapters/facts_store.py` to persist.

    Deliberately excludes `school_id`, `snapshot_id`/`snapshot_sha256`,
    `mapper_version` and the SCD2 `valid_from`/`valid_to` columns — those are
    attached at persistence time by `app/facts/crawl.py`/`adapters/facts_store.py`,
    which know the school and the snapshot the mapper ran over; the mapper
    itself (and this shape) is pure per-page computation.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    fact_key: str = Field(min_length=1)
    tab: TabName
    section: str = Field(min_length=1)
    label: str = Field(min_length=1)
    value: NormalizedValue | None
    source_path: str = Field(min_length=1)
    reported_period: str | None = None
    reported_period_year: int | None = None

    @model_validator(mode="after")
    def _period_year_requires_period(self) -> FactRow:
        # Mirrors school_facts_reported_period_year_check.
        if self.reported_period_year is not None and self.reported_period is None:
            raise ValueError("reported_period_year requires reported_period")
        return self


class SectionSpec(BaseModel):
    """The part of one `facts_sections.yaml` section that `state.section_state`
    needs: its id/title and the tabs its keys draw from.

    Deliberately does not model a section's `groups:`/`facts:`/`chart:`
    layout — that is Phase 1's own asset-authoring surface
    (`config/assets/facts_sections.yaml`, `app/facts/mapper.py`) and Phase 2's
    wire contract (`counselle_db/catalog.py`'s `CatalogSnapshot.sections`),
    neither of which this unit owns; keeping this shape minimal avoids
    pinning a layout decision that unit hasn't made yet.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    tabs: tuple[TabName, ...] = Field(min_length=1)


__all__ = [
    "COMPOUND_KINDS",
    "FACT_STATES",
    "FactRow",
    "FactState",
    "FetchState",
    "NOT_FETCHED_STATUSES",
    "NormalizedValue",
    "PAGE_STATUSES",
    "PageStatus",
    "SectionSpec",
    "TAB_NAMES",
    "TabName",
    "ValueKind",
]
