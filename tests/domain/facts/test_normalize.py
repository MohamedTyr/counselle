"""Table-driven normalizer tests (plan §4.5). One row per kind's happy path
plus the awkward cases the plan calls out by name: absence markers (all five
spellings), a legitimate `0`/`False` surviving at full weight, a `BarGraph`
bucket at `-1` vs. one omitted entirely, and `dual_merit`'s sentence (never
positional) parse.
"""

from typing import Any

import pytest

from domain.envelope import JsonValue
from domain.facts.normalize import (
    AddressParts,
    NormalizeError,
    absence_display,
    normalize_address,
    normalize_bool,
    normalize_count,
    normalize_date,
    normalize_decimal,
    normalize_distribution,
    normalize_dual_merit,
    normalize_enum,
    normalize_list,
    normalize_matrix,
    normalize_money,
    normalize_ordinal,
    normalize_percent,
    normalize_range,
    normalize_table,
    normalize_text,
    normalize_url,
)


def _as_dict(value: JsonValue) -> dict[str, Any]:
    """Narrow a `NormalizedValue.value` payload to a dict for test assertions."""
    assert isinstance(value, dict)
    return value


def _as_list(value: JsonValue) -> list[Any]:
    """Narrow a `NormalizedValue.value` payload to a list for test assertions."""
    assert isinstance(value, list)
    return value


# ---------------------------------------------------------------------------
# Absence — one rule, five printed spellings (§4.4)
# ---------------------------------------------------------------------------

ABSENCE_CASES = [
    ("Not reported", "Not reported"),
    ("Not Reported", "Not reported"),
    ("not available", "Not available"),
    ("Not Available", "Not available"),
    ("—", "Not reported"),
    ("-", "Not reported"),
    ("", "Not reported"),
    (None, "Not reported"),
]


@pytest.mark.parametrize("raw,expected", ABSENCE_CASES)
def test_absence_display(raw: str | None, expected: str) -> None:
    assert absence_display(raw) == expected


def test_absence_display_rejects_a_genuine_value() -> None:
    assert absence_display("$72,685") is None
    assert absence_display("Yes") is None


# ---------------------------------------------------------------------------
# Scalars — including the 0/False-at-full-weight regression cases
# ---------------------------------------------------------------------------


def test_normalize_money_a_legitimate_zero_is_not_absence() -> None:
    # Berea College's `$0` cost lines (§4.5) — must round-trip as a real value.
    value = normalize_money("$0")
    assert value.value_num == 0.0
    assert value.display == "$0"


def test_normalize_money_typical() -> None:
    value = normalize_money("$72,685")
    assert value.value_num == 72685.0
    assert value.unit == "USD"


def test_normalize_percent_a_legitimate_zero() -> None:
    assert normalize_percent("0%").value_num == 0.0


def test_normalize_count_a_legitimate_zero() -> None:
    assert normalize_count("0").value_num == 0.0


def test_normalize_decimal() -> None:
    assert normalize_decimal("4").value_num == 4.0


def test_normalize_bool_false_survives_as_a_real_value() -> None:
    value = normalize_bool("No")
    assert value.value_bool is False
    assert value.display == "No"


def test_normalize_bool_true() -> None:
    assert normalize_bool("Yes").value_bool is True


def test_normalize_bool_rejects_unknown_text() -> None:
    with pytest.raises(NormalizeError):
        normalize_bool("Maybe")


def test_normalize_enum() -> None:
    value = normalize_enum("Available")
    assert value.value_text == "available"
    assert value.display == "Available"


def test_normalize_text_rejects_blank() -> None:
    with pytest.raises(NormalizeError):
        normalize_text("   ")


def test_normalize_url_with_link_text() -> None:
    value = normalize_url("https://yale.edu/aid", text="Financial aid")
    assert value.display == "Financial aid"
    assert value.value_text == "https://yale.edu/aid"


def test_normalize_url_rejects_non_url() -> None:
    with pytest.raises(NormalizeError):
        normalize_url("Not reported")


@pytest.mark.parametrize(
    "raw",
    [
        "www.bmtc.edu/",  # real full-crawl failure: Bais Medrash Toras Chesed
        "www.rabbinicalcollegeohryisroel.com/",  # real failure: Rabbinical College Ohr Yisroel
        "example.edu",  # bare domain, no "www."
        "www.example.edu/admissions?x=1",  # path + query survive
    ],
)
def test_normalize_url_accepts_schemeless_host(raw: str) -> None:
    """CollegeData often prints a school's own site without a scheme -- that
    is a real URL, not free text, and must not be rejected (school-data-v3
    fix review: two live schools' entire fact set was lost this way)."""
    value = normalize_url(raw)
    assert value.display == raw, "display must stay faithful to the source text"
    assert value.value_text == f"https://{raw}", "value_text needs a scheme to be a usable link"


@pytest.mark.parametrize(
    "raw",
    [
        "Not reported",
        "555-123-4567",
        "info@example.com",  # an email, not a URL
        "3.11.2024",  # numeric-only labels, not a domain
        "Visit our campus in New York",
    ],
)
def test_normalize_url_rejects_non_url_shapes(raw: str) -> None:
    with pytest.raises(NormalizeError):
        normalize_url(raw)


def test_normalize_date_anchored() -> None:
    value = normalize_date("2027-01-02")
    assert value.value_date is not None
    assert value.value_date.isoformat() == "2027-01-02"
    assert value.display == "January 2, 2027"


def test_normalize_date_rejects_bare_month_day() -> None:
    # "November 1" has no year of its own — period.py's roll rule resolves it.
    with pytest.raises(NormalizeError):
        normalize_date("November 1")


# ---------------------------------------------------------------------------
# Compound kinds
# ---------------------------------------------------------------------------


def test_normalize_range() -> None:
    value = normalize_range("740-790 range of middle 50%", unit="score")
    assert value.value == {"lo": 740.0, "hi": 790.0}
    assert value.value_num is None  # compound — no typed column


def test_normalize_address() -> None:
    parts = AddressParts(
        street1="38 Hillhouse Avenue", city="New Haven", state="CT", zip="06520"
    )
    value = normalize_address(parts)
    assert value.display == "38 Hillhouse Avenue, New Haven, CT 06520"
    assert _as_dict(value.value)["city"] == "New Haven"


def test_normalize_ordinal_rank_and_code() -> None:
    levels = ["Not considered", "Considered", "Important", "Very important"]
    value = normalize_ordinal(levels, 3)
    assert value.value_num == 3.0
    assert value.value == {
        "code": "very_important",
        "levels": ["not_considered", "considered", "important", "very_important"],
    }
    assert value.value_text is None  # ordinal's rank lives in value_num, not value_text too


def test_normalize_ordinal_rejects_out_of_range_mark() -> None:
    with pytest.raises(NormalizeError):
        normalize_ordinal(["a", "b"], 5)


def test_normalize_table() -> None:
    rows = [{"label": "FAFSA Code", "value": "001598"}]
    value = normalize_table(rows, row_noun="forms")
    assert value.value == {"rows": rows}


def test_normalize_matrix_null_cell_is_false() -> None:
    rows = [{"women_offered": True, "women_scholarship": None}]
    value = normalize_matrix(rows, row_labels=["Basketball"], row_noun="varsity sports")
    assert value.value_num == 1.0
    matrix_rows = _as_list(_as_dict(value.value)["rows"])
    assert _as_dict(matrix_rows[0])["women_scholarship"] is False


def test_normalize_matrix_requires_matching_lengths() -> None:
    with pytest.raises(NormalizeError):
        normalize_matrix([{"a": True}], row_labels=["x", "y"], row_noun="sports")


def test_normalize_list() -> None:
    value = normalize_list(["Honors program", "Study abroad", ""])
    assert value.value == {"items": ["Honors program", "Study abroad"]}
    assert value.display == "Honors program, Study abroad"


# ---------------------------------------------------------------------------
# Distribution — the `-1` vs. omitted-bucket distinction (never invent a 0)
# ---------------------------------------------------------------------------


def test_normalize_distribution_marks_negative_one_as_not_reported_not_zero() -> None:
    value = normalize_distribution(
        [("700-800", 88.0), ("600-699", -1.0)],
        scale="sat_math",
        unit="percent",
        all_labels=["700-800", "600-699", "500-599"],
    )
    payload = _as_dict(value.value)
    bucket_list = [_as_dict(bucket) for bucket in _as_list(payload["buckets"])]
    buckets = {bucket["label"]: bucket for bucket in bucket_list}
    assert buckets["600-699"]["absence"] == "not_reported"
    assert "pct" not in buckets["600-699"]
    assert buckets["700-800"]["pct"] == 88.0
    assert payload["omitted_buckets"] == ["500-599"]
    assert value.value_num is None  # distribution's typed column is always null


def test_normalize_distribution_parses_bucket_range_bounds() -> None:
    value = normalize_distribution([("700-800", 50.0)], scale="sat_math", unit="percent")
    bucket = _as_dict(_as_list(_as_dict(value.value)["buckets"])[0])
    assert bucket["lo"] == 700.0
    assert bucket["hi"] == 800.0


def test_normalize_distribution_requires_at_least_one_bucket() -> None:
    with pytest.raises(NormalizeError):
        normalize_distribution([], scale="sat_math", unit="percent")


# ---------------------------------------------------------------------------
# dual_merit — sentence pattern, never array position
# ---------------------------------------------------------------------------


def test_normalize_dual_merit_percent_and_money() -> None:
    share, average = normalize_dual_merit(
        "38% of students without need received merit-based gift aid averaging $18,450"
    )
    assert share.kind == "percent"
    assert share.value_num == 38.0
    assert average.kind == "money"
    assert average.value_num == 18450.0


def test_normalize_dual_merit_count_and_money() -> None:
    share, average = normalize_dual_merit(
        "944 students received merit-based gift aid averaging $12,450"
    )
    assert share.kind == "count"
    assert share.value_num == 944.0
    assert average.value_num == 12450.0


def test_normalize_dual_merit_rejects_a_sentence_with_no_money_figure() -> None:
    with pytest.raises(NormalizeError):
        normalize_dual_merit("Not reported")
