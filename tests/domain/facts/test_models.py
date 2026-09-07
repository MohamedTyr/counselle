"""NormalizedValue/FactRow structural invariants (plan §5.1) — these mirror
`school_facts`'s own CHECK constraints, so a violation here is a bug that
would otherwise surface only as a database insert failure at crawl time.
"""

import pytest
from pydantic import ValidationError

from domain.facts.models import FactRow, NormalizedValue


def test_normalized_value_rejects_more_than_one_typed_column() -> None:
    with pytest.raises(ValidationError, match="at most one"):
        NormalizedValue(kind="money", display="$1", value_num=1.0, value_text="one")


def test_normalized_value_allows_exactly_one_typed_column() -> None:
    assert NormalizedValue(kind="money", display="$0", value_num=0.0).value_num == 0.0
    assert NormalizedValue(kind="bool", display="No", value_bool=False).value_bool is False


def test_normalized_value_rejects_non_finite_floats_in_compound_payload() -> None:
    with pytest.raises(ValidationError):
        NormalizedValue(kind="range", display="x", value={"lo": float("nan"), "hi": 1.0})


def test_fact_row_rejects_period_year_without_period() -> None:
    with pytest.raises(ValidationError, match="reported_period"):
        FactRow(
            fact_key="deadlines.regular",
            tab="admission",
            section="applying",
            label="Regular Decision",
            value=NormalizedValue(kind="date", display="January 2, 2027"),
            source_path="admission/@profile/admissionDeadlineDate",
            reported_period_year=2027,
        )


def test_fact_row_accepts_an_explicit_absence_as_a_none_value() -> None:
    row = FactRow(
        fact_key="money.fafsa_code",
        tab="money-matters",
        section="money",
        label="FAFSA Code",
        value=None,
        source_path="money-matters/@profile/fafsaCode",
    )
    assert row.value is None
