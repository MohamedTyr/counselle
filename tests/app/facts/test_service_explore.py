"""Honesty-critical unit tests for the Explore query builder (plan §5.3):
the three-way `control` filter, the missing-vs-not-reported exclusion
grammar, the METRIC_LABELS copy convention the plan's own exit test
enforces, and the shared-URL sort/region-label parsing fallbacks.
"""

from __future__ import annotations

from app.facts.explore_models import ExploreQuery
from app.facts.service_explore import (
    METRIC_LABELS,
    _build_clauses,
    _combine,
    _resolve_sort,
    _split_region_label,
)


def test_metric_labels_are_noun_phrases_of_at_most_four_words_no_trailing_period() -> None:
    for key, label in METRIC_LABELS.items():
        assert label, key
        assert not label.endswith("."), key
        assert len(label.split()) <= 4, (key, label)


def test_control_filter_builds_a_three_way_equality_not_a_bare_private_fold() -> None:
    query = ExploreQuery(control="private_for_profit")
    clauses = _build_clauses(query)
    (clause,) = [c for c in clauses if c.key == "control"]
    where, params = _combine([clause])
    assert where == "control = $1"
    assert params == ["private_for_profit"]
    # A three-way column has no exclusion accounting -- it is never null.
    assert clause.null_sql is None


def test_test_policy_filter_carries_reason_missing_never_not_reported() -> None:
    query = ExploreQuery(test_policy="required")
    (clause,) = [c for c in _build_clauses(query) if c.key == "testPolicy"]
    assert clause.reason == "missing"
    assert clause.null_sql == "test_policy IS NULL"


def test_gender_and_hsi_filters_carry_reason_not_reported_a_store_we_hold_entirely() -> None:
    gender_clause = next(
        c for c in _build_clauses(ExploreQuery(gender="women")) if c.key == "gender"
    )
    assert gender_clause.reason == "not_reported"
    hsi_clause = next(c for c in _build_clauses(ExploreQuery(hsi=True)) if c.key == "hsi")
    assert hsi_clause.reason == "not_reported"


def test_hbcu_and_control_are_not_null_columns_and_carry_no_exclusion_accounting() -> None:
    hbcu_clause = next(c for c in _build_clauses(ExploreQuery(hbcu=True)) if c.key == "hbcu")
    assert hbcu_clause.null_sql is None


def test_no_exclusion_chip_ever_says_no_before_a_metric_label() -> None:
    for label in METRIC_LABELS.values():
        assert not label.lower().startswith("no ")


def test_score_fit_predicate_reads_inside_band_between_p25_and_p75() -> None:
    query = ExploreQuery(sat_math=700, score_fit="inside_band")
    (clause,) = [c for c in _build_clauses(query) if c.key == "satMath"]
    where, params = _combine([clause])
    assert where == "700 BETWEEN sat_math_p25 AND sat_math_p75".replace("700", "$1")
    assert params == [700]


def test_entering_a_score_alone_with_default_score_fit_adds_no_predicate() -> None:
    query = ExploreQuery(sat_math=700)  # score_fit defaults to "any"
    assert not [c for c in _build_clauses(query) if c.key == "satMath"]


def test_include_missing_drops_a_ranges_own_clause_so_its_null_rows_are_not_excluded() -> None:
    query = ExploreQuery(admit_min=0.1, include_missing=["admit"])
    assert not [c for c in _build_clauses(query) if c.key == "admit"]


def test_retired_sort_param_falls_back_to_name_asc_rather_than_erroring() -> None:
    assert _resolve_sort("testFit:asc") == ("name", "asc")
    assert _resolve_sort("admit:desc") == ("admit", "desc")


def test_region_option_label_splits_the_state_list_from_the_region_name() -> None:
    label, states = _split_region_label(
        "Southeast (AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, VA, WV)"
    )
    assert label == "Southeast"
    assert states == "AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, VA, WV"
    label, states = _split_region_label("U.S. Service schools")
    assert label == "U.S. Service schools"
    assert states is None
