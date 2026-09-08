"""Exit test for R14/D10 (plan §4.5, Unit E): no `school_explore_rows`
column may be the sum of two percentile facts — the 25th percentile of a
combined score is not the sum of the two section 25th percentiles. A
fabricated `sat_total_p25`/`sat_total_p75` (`sat_math_p25 + sat_ebrw_p25`)
shipped in Phase 0's seed and `EXPLORE_COLUMNS` once (Finding 2, 2026-09-07
hardening); this pins the correction so it cannot come back.

Mirrors `tests/app/facts/test_mapper_fixtures.py`'s
`test_no_fact_key_is_a_sum_of_two_percentile_facts` (the `school_facts`
side of the same rule) — that test used to carve out an explicit exception
for this column; there is no exception now.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from adapters.facts_store import EXPLORE_COLUMNS
from app.facts.explore_projection import (
    UnmappedControlError,
    _control_from_classification,
    ipeds_filter_columns,
    project_explore_row,
)

_BANNED_SUBSTRINGS = ("sat_total", "combined_score", "composite_total")

# A minimal, valid `basic_profile.classification` -- every test below that
# doesn't exercise the control mapping itself needs one of these so
# `_control_from_classification` doesn't raise on an unrelated fixture.
_PUBLIC_CLASSIFICATION = {"classification": {"control": "Public"}}


def test_no_explore_column_is_a_sum_of_two_percentile_facts() -> None:
    for column in EXPLORE_COLUMNS:
        lowered = column.lower()
        assert not any(bad in lowered for bad in _BANNED_SUBSTRINGS), column
    # Source-level guard: the projection never adds two percentile-shaped
    # values together to synthesize a new one.
    source = (
        Path(__file__).resolve().parents[3] / "app" / "facts" / "explore_projection.py"
    ).read_text()
    assert "values[f\"sat_total" not in source
    assert "math + ebrw" not in source


def test_project_explore_row_never_emits_a_synthesized_sat_total() -> None:
    values = project_explore_row(basic_profile=_PUBLIC_CLASSIFICATION, current_facts=[])
    assert "sat_total_p25" not in values
    assert "sat_total_p75" not in values


def test_explore_not_for_profit_control_must_not_match_for_profit() -> None:
    """Sibling of the `app.facts.service._control` honesty bug: this
    projection feeds `school_explore_rows.control` (Explore's 3-way filter
    and `control_counts`), which shares the same substring hazard --
    "for-profit" also occurs inside "not-for-profit"."""
    assert _control_from_classification("Private not-for-profit") == "private"
    assert _control_from_classification("Public") == "public"
    assert _control_from_classification("Private for-profit") == "private_for_profit"


def test_unmapped_control_raises_instead_of_guessing_private() -> None:
    """Finding 2 (Phase 2 review): `control` is `NOT NULL` with no
    `not_reported` member (plan §5.3) -- an unrecognised or missing
    `classification.control` must raise, never silently default to
    `"private"`."""
    with pytest.raises(UnmappedControlError) as excinfo:
        _control_from_classification("Some New IPEDS Category")
    assert excinfo.value.label == "Some New IPEDS Category"
    assert excinfo.value.source_path == "classification.control"

    with pytest.raises(UnmappedControlError):
        _control_from_classification(None)

    with pytest.raises(UnmappedControlError):
        ipeds_filter_columns({"classification": {"control": "Some New IPEDS Category"}})


def test_gender_model_is_null_when_both_ipeds_flags_are_null() -> None:
    """Finding 1 (Phase 2 review): `"coed"` asserts "admits all genders" --
    a claim IPEDS does not make when both `men_only`/`women_only` are
    unreported. Only an actual `False` on at least one flag earns the
    `"coed"` default."""
    columns = ipeds_filter_columns(
        {
            "classification": {"control": "Public"},
            "identity_and_mission": {"men_only": None, "women_only": None},
        }
    )
    assert columns["gender_model"] is None


def test_gender_model_is_coed_only_when_a_flag_is_actually_false() -> None:
    columns = ipeds_filter_columns(
        {
            "classification": {"control": "Public"},
            "identity_and_mission": {"men_only": False, "women_only": False},
        }
    )
    assert columns["gender_model"] == "coed"


def test_gender_model_men_and_women_only_still_resolve() -> None:
    men = ipeds_filter_columns(
        {**_PUBLIC_CLASSIFICATION, "identity_and_mission": {"men_only": True, "women_only": False}}
    )
    assert men["gender_model"] == "men"
    women = ipeds_filter_columns(
        {**_PUBLIC_CLASSIFICATION, "identity_and_mission": {"men_only": False, "women_only": True}}
    )
    assert women["gender_model"] == "women"


def _fact_row(fact_key: str, **overrides: object) -> dict[str, object]:
    """A plain dict duck-types as the `asyncpg.Record` the extractors index
    with `record["..."]` -- no live connection needed for this unit."""
    row: dict[str, object] = {
        "fact_key": fact_key,
        "value": None,
        "value_num": None,
        "value_text": None,
        "value_bool": None,
        "value_date": None,
    }
    row.update(overrides)
    return row


def test_merit_aid_pct_is_populated_from_its_fact_key() -> None:
    """Finding 3 (Phase 2 review): `merit_aid_pct` was absent from
    `EXPLORE_COLUMNS`/`_FACT_KEY_MAP`, so it was permanently `NULL`."""
    facts = [
        _fact_row("aid.merit_no_need_recipients_pct_all_undergraduates", value_num=16.6),
    ]
    values = project_explore_row(basic_profile=_PUBLIC_CLASSIFICATION, current_facts=facts)
    assert values["merit_aid_pct"] == 16.6


def test_need_fully_met_pct_is_the_ratio_of_the_two_raw_counts() -> None:
    """Finding 3 (Phase 2 review): the plan's one sanctioned stored derived
    ratio -- `aid.need_fully_met_all_undergraduates` ÷
    `aid.received_all_undergraduates` -- never the printed percentage
    embedded in either string (each is against a different base)."""
    facts = [
        _fact_row(
            "aid.need_fully_met_all_undergraduates",
            value_text="1,695 (25.5%) of aid recipients",
        ),
        _fact_row(
            "aid.received_all_undergraduates",
            value_text="6,647 (98.4%) of applicants with financial need",
        ),
    ]
    values = project_explore_row(basic_profile=_PUBLIC_CLASSIFICATION, current_facts=facts)
    assert values["need_fully_met_pct"] == round(1695 / 6647 * 100, 1)


def test_need_fully_met_pct_is_null_when_either_input_is_missing() -> None:
    only_received = [
        _fact_row("aid.received_all_undergraduates", value_text="100 (100.0%) of applicants"),
    ]
    values = project_explore_row(basic_profile=_PUBLIC_CLASSIFICATION, current_facts=only_received)
    assert values["need_fully_met_pct"] is None

    zero_received = [
        _fact_row("aid.need_fully_met_all_undergraduates", value_text="0 (0.0%) of recipients"),
        _fact_row("aid.received_all_undergraduates", value_text="0 (0.0%) of applicants"),
    ]
    values = project_explore_row(basic_profile=_PUBLIC_CLASSIFICATION, current_facts=zero_received)
    assert values["need_fully_met_pct"] is None
