"""Unit tests for the query_database escape-hatch honesty hints (DS-03).

These are UNIT tests — they exercise the pure ``_decode_hints_for`` helper with a
hand-built fake catalog (``fields_by_key`` populated by hand), no pool, no DB.
They run under the routine gate ``pytest -m "not live_llm and not live_search"``
so the hint logic is verified on every run, not only when a DB is attached.
"""

from __future__ import annotations

from types import SimpleNamespace

from counselle_db.service import _decode_hints_for
from domain.normalize import FieldMeta


def _fake_catalog() -> SimpleNamespace:
    """A catalog stand-in exposing only the ``fields_by_key`` index DS-03 reads."""
    fields_by_key: dict[str, FieldMeta] = {
        "admissions.acceptance_rate": FieldMeta(
            key="admissions.acceptance_rate",
            label="Acceptance Rate",
            category="admissions",
            data_type="percent",
            source="scorecard",
            raw_table="raw.scorecard_institution",
            raw_column="ADM_RATE",
        ),
        "institution.control": FieldMeta(
            key="institution.control",
            label="Control",
            category="institution",
            data_type="int",
            source="ipeds",
            raw_table="raw.ipeds_hd2024",
            raw_column="CONTROL",
        ),
    }
    return SimpleNamespace(fields_by_key=fields_by_key)


def test_query_database_flags_percent_and_coded_columns() -> None:
    # Arrange
    catalog = _fake_catalog()
    columns = [
        "name",
        "unitid",
        "admissions.acceptance_rate",
        "institution.control",
        "value",
    ]

    # Act
    hints = _decode_hints_for(catalog, columns)  # type: ignore[arg-type]

    # Assert — percent gets the R2 note, coded int gets the R1 note, raw `value`
    # gets the R1/R2/R4 note, and plain identity columns get no hint.
    assert "name" not in hints
    assert "unitid" not in hints
    assert "R2" in hints["admissions.acceptance_rate"]
    assert "multiply by 100" in hints["admissions.acceptance_rate"]
    assert "R1" in hints["institution.control"]
    assert "decode" in hints["institution.control"].lower()
    assert hints["value"].endswith("(R1/R2/R4).")
    assert "sentinel" in hints["value"].lower()


def test_decode_hints_empty_when_no_value_bearing_columns() -> None:
    # Arrange
    catalog = _fake_catalog()

    # Act
    hints = _decode_hints_for(catalog, ["name", "city", "state"])  # type: ignore[arg-type]

    # Assert — no false reassurance, no spurious hints.
    assert hints == {}


def test_decode_hints_skips_unresolvable_columns() -> None:
    # An unknown column name resolves to nothing → no hint (DS-03: no false
    # reassurance for a column we can't classify).
    # Arrange
    catalog = _fake_catalog()

    # Act
    hints = _decode_hints_for(catalog, ["some_unmapped_column"])  # type: ignore[arg-type]

    # Assert
    assert hints == {}
