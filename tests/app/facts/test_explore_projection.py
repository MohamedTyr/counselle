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

from adapters.facts_store import EXPLORE_COLUMNS
from app.facts.explore_projection import project_explore_row

_BANNED_SUBSTRINGS = ("sat_total", "combined_score", "composite_total")


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
    values = project_explore_row(basic_profile={}, current_facts=[])
    assert "sat_total_p25" not in values
    assert "sat_total_p75" not in values
