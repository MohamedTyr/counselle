"""The five-state absence model and the section fetch-state derivation
(plan §5.1/§5.2) — the honesty-critical core of `domain/facts/state.py`.
Table-driven per CLAUDE.md's testing stance: one row per distinguishable
state, plus the two "a reported 0/false is not absence" regression cases
that motivated the `has_row`/`value` split.
"""

from datetime import UTC, datetime, timedelta

import pytest

from domain.facts.models import FACT_STATES, FactState, NormalizedValue, PageStatus, TabName
from domain.facts.normalize import normalize_bool, normalize_money
from domain.facts.state import fact_state, is_stale, section_state

VALUE = normalize_money("$72,685")

FACT_STATE_CASES = [
    # (has_row, value, page_status, has_collegedata) -> expected state
    (False, None, "ok", False, "not_collected"),
    (True, VALUE, "ok", True, "value"),
    (True, None, "ok", True, "not_reported"),
    (False, None, "ok", True, "not_reported"),
    (False, None, "http_error", True, "not_fetched"),
    (False, None, "build_id_rotated", True, "not_fetched"),
    (False, None, "parse_error", True, "not_fetched"),
    (False, None, "never_fetched", True, "not_fetched"),
    (False, None, "not_found", True, "not_published"),
]


@pytest.mark.parametrize("has_row,value,page_status,has_collegedata,expected", FACT_STATE_CASES)
def test_fact_state_table(
    has_row: bool,
    value: NormalizedValue | None,
    page_status: PageStatus,
    has_collegedata: bool,
    expected: FactState,
) -> None:
    assert fact_state(has_row, value, page_status, has_collegedata) == expected


def test_fact_state_covers_all_five_states() -> None:
    seen = {case[-1] for case in FACT_STATE_CASES}
    assert seen == set(FACT_STATES)


def test_a_reported_zero_dollars_is_a_value_never_not_reported() -> None:
    zero = normalize_money("$0")
    assert fact_state(True, zero, "ok", True) == "value"


def test_a_reported_false_is_a_value_never_not_reported() -> None:
    false_bool = normalize_bool("No")
    assert false_bool.value_bool is False
    assert fact_state(True, false_bool, "ok", True) == "value"


SECTION_STATE_CASES: list[tuple[dict[TabName, PageStatus], tuple[str, bool]]] = [
    ({"overview": "ok", "admission": "ok"}, ("ok", False)),
    ({"overview": "never_fetched", "admission": "never_fetched"}, ("not_fetched", True)),
    ({"overview": "never_fetched", "admission": "http_error"}, ("not_fetched", False)),
    ({"campus-life": "not_found", "students": "not_found"}, ("not_published", False)),
    ({"campus-life": "ok", "students": "not_found"}, ("partial", False)),
    ({"campus-life": "not_found", "students": "http_error"}, ("partial", False)),
]


@pytest.mark.parametrize("tab_statuses,expected", SECTION_STATE_CASES)
def test_section_state_table(
    tab_statuses: dict[TabName, PageStatus], expected: tuple[str, bool]
) -> None:
    assert section_state(tab_statuses) == expected


def test_section_state_requires_at_least_one_tab() -> None:
    with pytest.raises(ValueError, match="at least one"):
        section_state({})


def test_is_stale() -> None:
    now = datetime(2026, 9, 7, tzinfo=UTC)
    fresh = now - timedelta(days=10)
    old = now - timedelta(days=200)
    assert is_stale(fresh, 120, now=now) is False
    assert is_stale(old, 120, now=now) is True
    assert is_stale(None, 120, now=now) is False
