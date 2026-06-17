"""Unit test for the single school-SELECT column source (audit M4).

`_SCHOOL_COLUMNS` is the one source for every `schools` SELECT; the literal
column list must stay in lockstep with `SchoolBasics` (the `_school_basics`
builder iterates `SchoolBasics.model_fields`). No live DB needed.
"""

from __future__ import annotations

from counselle_db.models import SchoolBasics
from counselle_db.service import _SCHOOL_COLUMNS, _SCHOOL_SELECT


def test_school_columns_cover_school_basics_fields() -> None:
    columns = [col.strip() for col in _SCHOOL_COLUMNS.split(",")]
    assert columns == list(SchoolBasics.model_fields), (
        "the schools SELECT columns must match SchoolBasics (the _school_basics builder)"
    )


def test_school_select_derives_from_columns() -> None:
    assert f"SELECT {_SCHOOL_COLUMNS} FROM schools" == _SCHOOL_SELECT
