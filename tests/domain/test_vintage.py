"""Vintage resolution per source (DATABASE_GUIDE §9, ARCHITECTURE §16).

`vintage_for(source, cycle_year, *, scorecard_filename=..., field_key=...)`
returns the citation parts `(vintage, caveat)`.
"""

from domain.vintage import vintage_for

SCORECARD_FILENAME = "College_Scorecard_Raw_Data_03232026.zip"


def test_ipeds_current_cycle_reads_as_provisional() -> None:
    # Arrange / Act
    vintage, caveat = vintage_for("ipeds", 2024)

    # Assert
    assert vintage == "IPEDS 2024-25 (provisional)"
    assert caveat is None


def test_ipeds_prior_cycle_reads_as_financial_aid_data() -> None:
    # Arrange / Act
    vintage, caveat = vintage_for("ipeds", 2023)

    # Assert
    assert vintage == "IPEDS 2023-24 financial-aid data"
    assert caveat is None


def test_scorecard_vintage_parses_publication_date_from_filename() -> None:
    # Arrange / Act
    vintage, caveat = vintage_for("scorecard", None, scorecard_filename=SCORECARD_FILENAME)

    # Assert
    assert vintage == "College Scorecard, published Mar 2026"
    assert caveat is None


def test_cds_vintage_names_the_filed_common_data_set() -> None:
    # Arrange / Act
    vintage, caveat = vintage_for("cds", 2024)

    # Assert
    assert vintage == "2024-25 Common Data Set filed by the school"
    assert caveat is None


def test_scorecard_10yr_earnings_carries_entry_cohort_lag_caveat() -> None:
    # Mar 2026 publication − 10 years → students who entered around 2016.
    # Arrange / Act
    vintage, caveat = vintage_for(
        "scorecard",
        None,
        scorecard_filename=SCORECARD_FILENAME,
        field_key="earnings.median_10yr",
    )

    # Assert
    assert vintage == "College Scorecard, published Mar 2026"
    assert caveat is not None
    assert "around 2016" in caveat
    assert "not current students" in caveat


def test_scorecard_4yr_earnings_carries_entry_cohort_lag_caveat() -> None:
    # Mar 2026 publication − 4 years → students who entered around 2022.
    # Arrange / Act
    _vintage, caveat = vintage_for(
        "scorecard",
        None,
        scorecard_filename=SCORECARD_FILENAME,
        field_key="earnings.median_4yr_postcompletion",
    )

    # Assert
    assert caveat is not None
    assert "around 2022" in caveat
