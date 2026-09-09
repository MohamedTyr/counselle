"""LabeledTable/IconTable/SubscreenNavigator handlers for `app/facts/mapper.py`.

Split out of `mapper_handlers.py` to stay under CLAUDE.md's 800-line file cap
— these are the "whole group, many rows" handlers (an entire table maps to
many fact_keys or one matrix fact), as opposed to that module's per-leaf
scalar/sentence handlers. Same contract: every function returns
`list[MappedFact]`, absence-checks before parsing, and never raises
`NormalizeError` past its own boundary.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from adapters.collegedata.parse import WalkedNode
from app.facts.mapper_handlers import MappedFact, list_value, text_fallback_date, to_str_list
from domain.envelope import JsonValue
from domain.facts import normalize as N
from domain.facts.models import NormalizedValue
from domain.facts.normalize import NormalizeError, absence_display

__all__ = [
    "forms_required_table",
    "hs_requirements_table",
    "icon_matrix",
    "ordinal_table",
    "subscreen_list",
]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")


_ORDINAL_LEVELS = ("Not Considered", "Considered", "Important", "Very Important")


def ordinal_table(group: Sequence[WalkedNode], *, key_prefix: str) -> list[MappedFact]:
    """The "Selection of Students" importance-scale table: one ordinal fact per row."""
    out: list[MappedFact] = []
    for row in group:
        raw = row.raw
        if not isinstance(raw, dict):
            continue
        values = raw.get("values")
        if not isinstance(values, list):
            continue
        marked = [
            i for i, cell in enumerate(values) if isinstance(cell, str) and cell.strip() == "X"
        ]
        if len(marked) != 1:
            continue
        try:
            value = N.normalize_ordinal(_ORDINAL_LEVELS, marked[0])
        except NormalizeError:
            continue
        out.append(MappedFact(f"{key_prefix}{_slug(row.label)}", value))
    return out


# Subject -> canonical slug used in the units-table fact_key (appendix ii §2).
_UNIT_SUBJECTS: Mapping[str, str] = {
    "english": "english",
    "mathematics": "mathematics",
    "science": "science",
    "social studies": "social_studies",
    "foreign language": "foreign_language",
    "academic electives": "academic_electives",
    "history": "history",
}

# Exam row label -> canonical slug for the test-policy/test-due table (appendix ii §2).
_TEST_POLICY_ROWS: Mapping[str, str] = {
    "sat or act": "sat_or_act",
    "sat only": "sat_only",
    "act only": "act_only",
    "sat & sat subject tests, or act": "sat_and_sat_subject_tests_or_act",
    "sat subject tests only": "sat_subject_tests_only",
    "act writing test policy": "act_writing_test_policy",
}


def hs_requirements_table(
    group: Sequence[WalkedNode], *, cycle_year: int | None
) -> list[MappedFact]:
    """Dispatches on the table's own columns, not on which `CategoryDivider`
    hosts it or its ordinal position — both shapes below appear under either
    divider across the real captures."""
    if not group:
        return []
    columns = group[0].raw.get("columns") if isinstance(group[0].raw, dict) else None
    if columns == ["Req", "Reco"]:
        return _units_table(group)
    if columns == ["Required Units", "Due in Admissions Office"]:
        return _test_policy_table(group, cycle_year=cycle_year)
    return []


def _as_optional_str(value: JsonValue) -> str | None:
    return value if isinstance(value, str) else None


def _cell_decimal_or_absent(raw: JsonValue) -> NormalizedValue | None:
    text = _as_optional_str(raw)
    if text is None or absence_display(text) is not None:
        return None
    try:
        return N.normalize_decimal(text)
    except NormalizeError:
        return N.normalize_text(text)


def _units_table(group: Sequence[WalkedNode]) -> list[MappedFact]:
    out: list[MappedFact] = []
    for row in group:
        subject = _UNIT_SUBJECTS.get(row.label.strip().lower())
        raw = row.raw
        if subject is None or not isinstance(raw, dict):
            continue
        values = raw.get("values")
        if not isinstance(values, list) or len(values) != 2:
            continue
        required, recommended = values
        out.append(
            MappedFact(f"admissions.units_required_{subject}", _cell_decimal_or_absent(required))
        )
        out.append(
            MappedFact(
                f"admissions.units_recommended_{subject}", _cell_decimal_or_absent(recommended)
            )
        )
    return out


def _cell_enum_or_absent(raw: JsonValue) -> NormalizedValue | None:
    text = _as_optional_str(raw)
    if text is None or absence_display(text) is not None:
        return None
    try:
        return N.normalize_enum(text)
    except NormalizeError:
        return N.normalize_text(text)


def _test_policy_table(group: Sequence[WalkedNode], *, cycle_year: int | None) -> list[MappedFact]:
    out: list[MappedFact] = []
    for row in group:
        slug = _TEST_POLICY_ROWS.get(row.label.strip().lower())
        raw = row.raw
        if slug is None or not isinstance(raw, dict):
            continue
        values = raw.get("values")
        if not isinstance(values, list) or len(values) != 2:
            continue
        required, due = values
        out.append(MappedFact(f"admissions.test_policy_{slug}", _cell_enum_or_absent(required)))
        if isinstance(due, str):
            out.extend(
                text_fallback_date(
                    due, base_key=f"deadlines.test_due_{slug}", cycle_year=cycle_year
                )
            )
    return out


def forms_required_table(group: Sequence[WalkedNode]) -> list[MappedFact]:
    """The "Forms Required" table: `FAFSA Code is NNNNNN` (the code is a label
    capture, not a cell value) and `CSS/Financial Aid Profile` (a free-text
    fee — no clean boolean vocabulary is observed in the real captures, so
    `money.css_profile_required` is deliberately not derived)."""
    out: list[MappedFact] = []
    for row in group:
        fafsa = re.match(r"^FAFSA Code is\s+(?P<code>\S+)$", row.label.strip(), re.IGNORECASE)
        raw = row.raw
        if not isinstance(raw, dict):
            continue
        values = raw.get("values")
        if not isinstance(values, list) or not values:
            continue
        if fafsa:
            out.append(MappedFact("money.fafsa_code", N.normalize_text(fafsa["code"])))
        elif row.label.strip().lower() == "fafsa":
            # A code-less "FAFSA" row (observed live at University of Phoenix)
            # — real, but with no code digits to capture; not an absence
            # marker either, so record it as an unresolved code rather than
            # silently dropping the row.
            out.append(MappedFact("money.fafsa_code", None))
        elif row.label.strip().lower() == "css/financial aid profile" and isinstance(
            values[0], str
        ):
            absence = absence_display(values[0])
            out.append(
                MappedFact(
                    "money.css_profile_fee",
                    None if absence is not None else N.normalize_text(values[0]),
                )
            )
    return out


def icon_matrix(
    group: Sequence[WalkedNode], *, columns: Sequence[str], base_key: str
) -> list[MappedFact]:
    """A whole `IconTable` (sports offered/scholarship grid) -> one `matrix` fact."""
    rows: list[Mapping[str, bool | None]] = []
    labels: list[str] = []
    for row in group:
        raw = row.raw
        if not isinstance(raw, dict):
            continue
        values = raw.get("values")
        if not isinstance(values, list) or len(values) != len(columns):
            continue
        rows.append(
            {column: (cell is not None) for column, cell in zip(columns, values, strict=True)}
        )
        labels.append(row.label)
    if not rows:
        return []
    return [MappedFact(base_key, N.normalize_matrix(rows, row_labels=labels, row_noun="sports"))]


_COUNT_IN_PARENS_RE = re.compile(r"\((?P<n>\d+)\)")


def subscreen_list(node: WalkedNode, *, base_key: str) -> list[MappedFact]:
    """A `SubscreenNavigator` -> a list fact + its own `_count` (from the
    button text's `"View All ... (N)"`, never re-derived from `len(items)` —
    the button text is what the source actually published)."""
    raw = node.raw
    if not isinstance(raw, dict):
        return []
    items, button_text = raw.get("items"), raw.get("buttonText")
    item_list = to_str_list(items)
    facts = (
        list_value(item_list, base_key=base_key)
        if item_list is not None
        else [MappedFact(base_key, None)]
    )
    if isinstance(button_text, str):
        match = _COUNT_IN_PARENS_RE.search(button_text)
        if match:
            facts.append(MappedFact(f"{base_key}_count", N.normalize_count(match["n"])))
    return facts
