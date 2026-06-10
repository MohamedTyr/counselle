"""Behavioral vectors for the normalization engine (DATABASE_GUIDE §6, R1-R12).

Each test pins one reading rule. These tests were written BEFORE the
implementation (TDD RED) — they are the contract `domain/normalize.py` builds to.
"""

from typing import Any

from domain.normalize import (
    SOURCE_PREFERENCE,
    FieldMeta,
    NormalizedValue,
    normalize,
    preferred_field,
)


def _meta(**overrides: Any) -> FieldMeta:
    base: dict[str, Any] = {
        "key": "admissions.acceptance_rate",
        "label": "Acceptance Rate",
        "category": "admissions",
        "data_type": "percent",
        "source": "scorecard",
        "raw_table": "raw.scorecard_institution",
        "raw_column": "ADM_RATE",
    }
    base.update(overrides)
    return FieldMeta(**base)


# --- percent (R2) ---


def test_percent_fraction_displays_with_one_decimal() -> None:
    # Arrange
    meta = _meta(data_type="percent")

    # Act
    result = normalize(meta, 0.0361)

    # Assert
    assert result.display == "3.6%"
    assert result.raw == 0.0361
    assert result.available is True
    assert result.unit == "percent"


def test_percent_strips_a_trailing_zero_decimal() -> None:
    # Arrange
    meta = _meta(data_type="percent")

    # Act
    result = normalize(meta, 0.58)

    # Assert
    assert result.display == "58%"


def test_percent_keeps_real_precision_to_one_decimal() -> None:
    # Arrange
    meta = _meta(data_type="percent")

    # Act
    result = normalize(meta, 0.587)

    # Assert
    assert result.display == "58.7%"


# --- NULL / missing (R3) ---


def test_null_value_reads_not_available() -> None:
    # Arrange
    meta = _meta(data_type="percent")

    # Act
    result = normalize(meta, None)

    # Assert
    assert result.available is False
    assert result.display == "not available"
    assert result.raw is None


def test_missing_row_convention_is_caller_passes_none() -> None:
    # R3: a missing field_values row and a NULL value are indistinguishable to the
    # student — the caller passes None for both, and the engine never invents a value.
    # Arrange
    meta = _meta(key="cds.c12_avg_hs_gpa", data_type="number", source="cds")

    # Act
    result = normalize(meta, None)

    # Assert
    assert result.available is False
    assert result.display == "not available"


# --- currency (R5) ---


def test_currency_rounds_to_whole_dollars_with_thousands_separator() -> None:
    # Arrange
    meta = _meta(key="cost.tuition_in_state", data_type="currency", source="ipeds")

    # Act
    result = normalize(meta, 59885.0)

    # Assert
    assert result.display == "$59,885"
    assert result.raw == 59885.0
    assert result.unit == "currency"


def test_currency_rounds_half_up_to_whole_dollars() -> None:
    # Arrange
    meta = _meta(key="aid.avg_net_price_title4", data_type="currency", source="ipeds")

    # Act
    result = normalize(meta, 17146.5)

    # Assert
    assert result.display == "$17,147"


def test_currency_keeps_a_negative_sign() -> None:
    # Negative net price is valid (grants exceed cost) — R5.
    # Arrange
    meta = _meta(key="aid.avg_net_price_0_30k", data_type="currency", source="ipeds")

    # Act
    result = normalize(meta, -2536.0)

    # Assert
    assert result.display == "-$2,536"


# --- int (R6 + R1) ---


def test_int_strips_trailing_zeros_and_formats_thousands() -> None:
    # jsonb stores ints as numbers with trailing zeros: 6370.0000000000000000 — R6.
    # Arrange
    meta = _meta(key="enrollment.undergrad_total", data_type="int", source="ipeds")

    # Act
    result = normalize(meta, 6370.0)

    # Assert
    assert result.display == "6,370"


def test_coded_int_decodes_via_decode_map_and_keeps_raw_code() -> None:
    # R1: CONTROL 2 must never be shown as "2".
    # Arrange
    meta = _meta(
        key="institution.control",
        label="Control",
        data_type="int",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="CONTROL",
    )
    decode_map = {"1": "Public", "2": "Private not-for-profit", "3": "Private for-profit"}

    # Act
    result = normalize(meta, 2.0, decode_map=decode_map)

    # Assert
    assert result.display == "Private not-for-profit"
    assert result.decoded_label == "Private not-for-profit"
    assert result.raw == 2


def test_admcon7_code_5_decodes_to_test_optional() -> None:
    # Arrange
    meta = _meta(
        key="admissions.req_test_scores",
        label="Test Score Requirement",
        data_type="int",
        source="ipeds",
        raw_table="raw.ipeds_adm2024",
        raw_column="ADMCON7",
    )
    decode_map = {"1": "Required", "3": "Test-Blind", "5": "Test-Optional"}

    # Act
    result = normalize(meta, 5.0, decode_map=decode_map)

    # Assert
    assert result.display == "Test-Optional"


def test_plain_int_without_decode_map_displays_as_a_count() -> None:
    # R1: SAT percentiles are plain scores, never "decoded".
    # Arrange
    meta = _meta(
        key="admissions.sat_ebrw_75",
        label="SAT EBRW 75th",
        data_type="int",
        source="ipeds",
        raw_table="raw.ipeds_adm2024",
        raw_column="SATVR75",
    )

    # Act
    result = normalize(meta, 790)

    # Assert
    assert result.display == "790"


# --- bool ---


def test_bool_true_displays_yes() -> None:
    # Arrange
    meta = _meta(key="academics.study_abroad", data_type="bool", source="ipeds")

    # Act
    result = normalize(meta, True)

    # Assert
    assert result.display == "Yes"


def test_bool_false_displays_no() -> None:
    # Arrange
    meta = _meta(key="institution.hbcu", data_type="bool", source="scorecard")

    # Act
    result = normalize(meta, False)

    # Assert
    assert result.display == "No"


# --- text (R4 / R7 / R8) ---


def test_cds_enum_string_formats_with_first_letter_capitalized() -> None:
    # R7: CDS enum strings need light formatting only.
    # Arrange
    meta = _meta(
        key="cds.c8a_test_policy",
        label="Test Policy",
        data_type="text",
        source="cds",
        raw_table=None,
        raw_column=None,
    )

    # Act
    result = normalize(meta, "considered_if_submitted")

    # Assert
    assert result.display == "Considered if submitted"


def test_system_name_sentinel_reads_not_part_of_a_system() -> None:
    # R4: the "-2" sentinel must never be printed.
    # Arrange
    meta = _meta(
        key="institution.system_name",
        label="System Name",
        data_type="text",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="F1SYSNAM",
    )

    # Act
    result = normalize(meta, "-2")

    # Assert
    assert result.display == "Not part of a system"
    assert result.available is True
    assert result.raw is None


def _bbrr_meta() -> FieldMeta:
    return _meta(
        key="outcomes.bbrr2_pell_default",
        label="Default Rate (Pell)",
        data_type="text",
        source="scorecard",
        raw_table="raw.scorecard_institution",
        raw_column="BBRR2_FED_UG_DFLT",
    )


def test_bbrr_plain_decimal_string_reads_as_a_percent() -> None:
    # Arrange
    meta = _bbrr_meta()

    # Act
    result = normalize(meta, "0.03")

    # Assert
    assert result.display == "3%"
    assert result.raw == 0.03


def test_bbrr_le_token_reads_as_a_range_with_no_arithmetic() -> None:
    # Arrange
    meta = _bbrr_meta()

    # Act
    result = normalize(meta, "<=0.05")

    # Assert
    assert result.display == "≤ 5% (reported as a range)"
    assert result.raw is None


def test_bbrr_dash_token_reads_as_a_range_with_no_arithmetic() -> None:
    # Arrange
    meta = _bbrr_meta()

    # Act
    result = normalize(meta, "0.05-0.09")

    # Assert
    assert result.display == "5%–9% (reported as a range)"
    assert result.raw is None


def test_schemeless_website_gets_https_prefix() -> None:
    # R8: ~58% of websites are stored scheme-less; prepend https://, never http://.
    # Arrange
    meta = _meta(
        key="institution.website",
        label="Website",
        data_type="text",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="WEBADDR",
    )

    # Act
    result = normalize(meta, "www.duke.edu")

    # Assert
    assert result.display == "https://www.duke.edu"


def test_already_https_url_passes_through_unchanged() -> None:
    # Arrange
    meta = _meta(
        key="institution.website",
        label="Website",
        data_type="text",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="WEBADDR",
    )

    # Act
    result = normalize(meta, "https://www.duke.edu")

    # Assert
    assert result.display == "https://www.duke.edu"


# --- benchmark guard (R9) ---


def test_all_institutions_field_carries_the_national_benchmark_caveat() -> None:
    # Arrange
    meta = _meta(
        key="earnings.median_10yr_all_institutions",
        label="Median Earnings (10yr, all institutions)",
        data_type="currency",
        source="scorecard",
    )

    # Act
    result = normalize(meta, 50000.0)

    # Assert
    assert result.extra_caveat == (
        "National benchmark across all institutions — not this school's own value."
    )


# --- number ---


def test_number_keeps_up_to_two_meaningful_decimals() -> None:
    # Arrange
    meta = _meta(key="academics.fte", data_type="number", source="ipeds")

    # Act
    result = normalize(meta, 318.67)

    # Assert
    assert result.display == "318.67"


def test_number_strips_meaningless_trailing_zeros() -> None:
    # Arrange
    meta = _meta(key="academics.student_faculty_ratio", data_type="number", source="ipeds")

    # Act
    result = normalize(meta, 15.0)

    # Assert
    assert result.display == "15"


# --- weird data never raises ---


def test_garbage_value_reads_not_available_without_raising() -> None:
    # Data weirdness degrades honestly; exceptions are for programmer error only.
    # Arrange
    meta = _meta(data_type="percent")

    # Act
    result = normalize(meta, {"weird": ["blob", 1]})

    # Assert
    assert isinstance(result, NormalizedValue)
    assert result.available is False
    assert result.display == "not available"


def test_plain_text_value_passes_through_unchanged() -> None:
    # The identity path of the honesty engine deserves its own pin.
    # Arrange
    meta = _meta(
        key="institution.system_name",
        label="System Name",
        data_type="text",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="F1SYSNAM",
    )

    # Act
    result = normalize(meta, "University of California System")

    # Assert
    assert result.display == "University of California System"
    assert result.available is True


def test_stored_http_url_passes_through_unchanged() -> None:
    # R8 governs only what we ADD (https://, never http://) — existing schemes pass.
    # Arrange
    meta = _meta(key="institution.website", data_type="text", source="ipeds")

    # Act
    result = normalize(meta, "http://www.example.edu")

    # Assert
    assert result.display == "http://www.example.edu"


def test_cds_url_value_is_never_mangled_by_enum_formatting() -> None:
    # A URL on a CDS-sourced text field must hit the URL path, not the enum path.
    # Arrange
    meta = _meta(key="cds.some_link", data_type="text", source="cds")

    # Act
    result = normalize(meta, "www.admissions.example.edu")

    # Assert
    assert result.display == "https://www.admissions.example.edu"


def test_number_in_the_thousands_formats_with_separator() -> None:
    # Arrange
    meta = _meta(key="academics.fte", data_type="number", source="ipeds")

    # Act
    result = normalize(meta, 1234.56)

    # Assert
    assert result.display == "1,234.56"


def test_sub_cent_number_never_displays_as_flat_zero() -> None:
    # A real tiny value must not read as "0" — that would invent a zero.
    # Arrange
    meta = _meta(key="academics.some_ratio", data_type="number", source="ipeds")

    # Act
    result = normalize(meta, 0.001)

    # Assert
    assert result.available is True
    assert result.display == "0.001"


# --- source preference (R9) ---


def test_preferred_field_for_acceptance_rate_prefers_scorecard() -> None:
    # Arrange / Act
    preference = preferred_field("acceptance_rate")

    # Assert
    assert preference[0] == "admissions.acceptance_rate"
    assert "acceptance_rate" in SOURCE_PREFERENCE
