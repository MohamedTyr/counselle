"""Honesty-critical unit tests for the Explore query builder (plan §5.3):
the three-way `control` filter, the missing-vs-not-reported exclusion
grammar, the METRIC_LABELS copy convention the plan's own exit test
enforces, and the shared-URL sort/region-label parsing fallbacks.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import pytest

from adapters.facts_store import EXPLORE_COLUMNS
from app.facts.explore_models import (
    ExploreQuery,
    FitEstimate,
    FitProfileSummary,
    FitSignal,
    UnavailableFactor,
)
from app.facts.service_explore import (
    METRIC_LABELS,
    _build_clauses,
    _combine,
    _resolve_sort,
    _split_region_label,
    run_explore,
)
from app.workspace.models import Academics, Profile
from counselle_db import service as _db_service
from counselle_db.models import FactValueRow


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


def _fake_settings() -> Any:
    return SimpleNamespace(
        facts_explore_page_size=24,
        facts_explore_max_page_size=100,
        facts_explore_max_count=3000,
        facts_stale_days=365,
    )


class _FakeCatalog:
    """`run_explore` only threads `catalog` through to `db_service.explore` --
    never touches it directly -- so a placeholder is enough."""


async def test_explore_wire_payload_serializes_numeric_columns_as_json_numbers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression for the 2026-09-09 `TypeError: value.toFixed is not a
    function` crash: asyncpg returns Postgres `numeric` columns (admit_rate,
    grad_rate_6y, ...) as `Decimal`, and `ExploreSchoolCard.fields` is typed
    `dict[str, object]` -- untyped, so nothing coerced it before this test
    existed. Pydantic serializes an unconverted `Decimal` to a JSON *string*.
    `tests/app/facts/test_service_explore.py`'s other tests call `run_explore()`
    but never inspect the serialized JSON shape of `fields`, so they never
    caught it. This test goes through `run_explore` -> `ExploreResponse.model_dump_json()`
    -> `json.loads()`, the same path the frontend actually receives, and
    asserts on real JSON types rather than Python objects survivable by
    duck typing."""
    main_row: dict[str, Any] = dict.fromkeys(EXPLORE_COLUMNS)
    main_row.update(
        school_id=1,
        name="Test University",
        city="Testville",
        state="CA",
        official_website="https://example.edu",
        facts_updated_at=None,
        total_count=1,
        region="West",
        control="public",
        hbcu=False,
        tribal=False,
        land_grant=False,
        # The crashing case: a non-integer `numeric` column.
        admit_rate=Decimal("12.5"),
        # A whole-valued `numeric` column -- silently wrong as a string
        # (`"90" % 1 === 0` is truthy in JS) rather than a loud crash, which
        # is exactly why this bug shipped undetected on some cards.
        grad_rate_6y=Decimal("90"),
        # An `integer` column -- must stay a JSON integer, never `90.0`.
        undergraduates=1200,
    )

    async def fake_fit_executor(
        catalog: Any, statement: tuple[str, list[Any]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, Any], ...], dict[int, tuple[object, ...]]]:
        return (main_row,), {1: ()}

    async def fake_explore(catalog: Any, statements: list[Any]) -> list[list[dict[str, Any]]]:
        results: list[list[dict[str, Any]]] = []
        for i, _ in enumerate(statements):
            if i in (0, 1):
                results.append([{"n": 1}])
            else:
                results.append([])
        return results

    monkeypatch.setattr(_db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(_db_service, "explore", fake_explore)

    response = await run_explore(_FakeCatalog(), ExploreQuery(), _fake_settings(), Profile())  # type: ignore[arg-type]
    payload = json.loads(response.model_dump_json())
    fields = payload["schools"][0]["fields"]

    assert fields["admit_rate"] == pytest.approx(12.5)
    assert isinstance(fields["admit_rate"], float)
    assert isinstance(fields["grad_rate_6y"], (int, float))
    assert not isinstance(fields["grad_rate_6y"], str)
    assert isinstance(fields["undergraduates"], int)


def test_fit_wire_models_serialize_every_closed_enum_value() -> None:
    """The API vocabulary is exhaustive and never leaks domain internals."""
    estimate = FitEstimate(
        category="Safety",
        baseline_category="Reach",
        baseline_admit_rate=52.5,
        basis="personalized",
        evidence_level="two_comparisons",
        signals=(
            FitSignal(factor="academic", source="gpa_distribution", assessment="strong"),
            FitSignal(factor="testing", source="sat_and_act", assessment="weak"),
        ),
        unavailable=(
            UnavailableFactor(factor="academic", reason="profile_gpa_missing"),
            UnavailableFactor(factor="testing", reason="test_band_stale"),
        ),
        caveats=("entering_class_benchmark_not_cutoff", "stale_optional_facts"),
        algorithm_version="admissions-fit-v1",
    )
    summary = FitProfileSummary(
        has_academic_candidate=True,
        has_complete_test_candidate=False,
        suggested_profile_fields=("test_scores",),
    )

    payload = json.loads(estimate.model_dump_json())
    assert payload == {
        "category": "Safety",
        "baseline_category": "Reach",
        "baseline_admit_rate": 52.5,
        "basis": "personalized",
        "evidence_level": "two_comparisons",
        "signals": [
            {"factor": "academic", "source": "gpa_distribution", "assessment": "strong"},
            {"factor": "testing", "source": "sat_and_act", "assessment": "weak"},
        ],
        "unavailable": [
            {"factor": "academic", "reason": "profile_gpa_missing"},
            {"factor": "testing", "reason": "test_band_stale"},
        ],
        "caveats": ["entering_class_benchmark_not_cutoff", "stale_optional_facts"],
        "algorithm_version": "admissions-fit-v1",
    }
    assert json.loads(summary.model_dump_json())["suggested_profile_fields"] == ["test_scores"]


def test_fit_wire_contract_exposes_each_closed_enum_and_no_internal_index() -> None:
    schema = FitEstimate.model_json_schema()
    props = schema["properties"]
    assert props["category"]["enum"] == ["Reach", "Target", "Safety", "Unknown"]
    assert props["baseline_category"]["enum"] == ["Reach", "Target", "Safety", "Unknown"]
    assert props["basis"]["enum"] == [
        "school_rate",
        "personalized",
        "missing_admit_rate",
    ]
    assert props["evidence_level"]["enum"] == [
        "baseline_only",
        "one_comparison",
        "two_comparisons",
    ]
    assert props["caveats"]["items"]["enum"] == [
        "entering_class_benchmark_not_cutoff",
        "stale_optional_facts",
    ]
    unavailable = schema["$defs"]["UnavailableFactor"]["properties"]["reason"]["enum"]
    assert unavailable == [
        "profile_gpa_missing",
        "profile_gpa_invalid",
        "gpa_scale_incompatible",
        "gpa_distribution_unavailable",
        "gpa_distribution_stale",
        "gpa_distribution_invalid",
        "profile_rank_unavailable",
        "rank_disabled",
        "rank_distribution_unavailable",
        "rank_distribution_stale",
        "rank_distribution_invalid",
        "profile_test_missing",
        "test_score_invalid",
        "incomplete_sat_comparison",
        "test_band_unavailable",
        "test_band_stale",
        "test_band_invalid",
        "test_policy_not_required_or_unknown",
    ]
    assert "fit_index" not in props
    assert "profile" not in props


def _fit_main_row(*, school_id: int = 1, admit_rate: object = Decimal("52")) -> dict[str, Any]:
    row: dict[str, Any] = dict.fromkeys(EXPLORE_COLUMNS)
    row.update(
        school_id=school_id,
        name="Test University",
        city="Testville",
        state="CA",
        official_website="https://example.edu",
        facts_updated_at=None,
        total_count=1,
        region="West",
        control="public",
        hbcu=False,
        tribal=False,
        land_grant=False,
        admit_rate=admit_rate,
    )
    return row


def _malformed_gpa_fact() -> FactValueRow:
    return FactValueRow(
        fact_key="class_profile.gpa_distribution",
        tab="admission",
        section="getting-in",
        label="GPA distribution",
        value={"kind": "distribution", "value": {"scale": "not-gpa"}},
        display="Malformed",
        unit=None,
        value_type="distribution",
        value_num=None,
        value_text=None,
        value_bool=None,
        value_date=None,
        reported_period=None,
        reported_period_year=None,
        observed_at=datetime(2026, 9, 15, tzinfo=UTC),
    )


def _complete_gpa_distribution_fact() -> FactValueRow:
    return FactValueRow(
        fact_key="class_profile.gpa_distribution",
        tab="admission",
        section="getting-in",
        label="GPA distribution",
        value={
            "kind": "distribution",
            "value": {
                "scale": "gpa",
                "buckets": [
                    {"label": "0.00 - 3.49", "lo": 0, "hi": 3.49, "pct": 10},
                    {"label": "3.50 - 3.74", "lo": 3.5, "hi": 3.74, "pct": 15},
                    {"label": "3.75 - 3.99", "lo": 3.75, "hi": 3.99, "pct": 50},
                    {"label": "4.00 and Above", "lo": 4, "hi": None, "pct": 25},
                ],
                "omitted_buckets": [],
                "sums_to": 100,
            },
        },
        display="GPA distribution",
        unit=None,
        value_type="distribution",
        value_num=None,
        value_text=None,
        value_bool=None,
        value_date=None,
        reported_period=None,
        reported_period_year=None,
        observed_at=datetime(2026, 9, 15, tzinfo=UTC),
    )


async def test_explore_uses_one_batch_and_saved_profile_not_url_assumptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fit comes from the typed Profile supplied by the route, never URL scores."""
    page_rows = (_fit_main_row(),)
    captured: dict[str, object] = {}

    async def fake_fit_executor(
        catalog: Any, statement: tuple[str, list[Any]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, Any], ...], dict[int, tuple[object, ...]]]:
        captured["statement"] = statement
        captured["max_page_size"] = max_page_size
        return page_rows, {1: ()}

    async def fake_explore(
        catalog: Any, statements: list[Any]
    ) -> tuple[tuple[dict[str, Any], ...], ...]:
        # The old main statement is no longer in the ancillary executor.
        assert len(statements) == 6
        return (
            ({"n": 1},),
            ({"n": 1},),
            (),
            (),
            (),
            (),
        )

    monkeypatch.setattr(_db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(_db_service, "explore", fake_explore)
    profile = Profile(academics=Academics(gpa_unweighted=Decimal("3.8"), gpa_scale=Decimal("4.0")))
    response = await run_explore(
        cast(Any, _FakeCatalog()),
        ExploreQuery(sat_math=800, sat_ebrw=800, act=36),
        _fake_settings(),
        profile,
    )

    # This is the effective page bound, not the broader configured maximum.
    assert captured["max_page_size"] == 24
    main_sql, _ = cast(tuple[str, list[Any]], captured["statement"])
    assert "LIMIT 24 OFFSET 0" in main_sql
    fit = response.schools[0].fit
    assert fit.category == "Safety"
    assert fit.baseline_category == "Safety"
    assert fit.basis == "school_rate"
    assert fit.baseline_admit_rate == 52.0
    assert response.fit_profile_summary.has_academic_candidate is True
    assert response.fit_profile_summary.has_complete_test_candidate is False


async def test_explore_missing_admit_rate_is_unknown_even_with_profile_and_facts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fit_executor(
        catalog: Any, statement: tuple[str, list[Any]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, Any], ...], dict[int, tuple[object, ...]]]:
        return (_fit_main_row(admit_rate=None),), {1: ()}

    async def fake_explore(
        catalog: Any, statements: list[Any]
    ) -> tuple[tuple[dict[str, Any], ...], ...]:
        return (({"n": 1},), ({"n": 1},), (), (), (), ())

    monkeypatch.setattr(_db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(_db_service, "explore", fake_explore)

    response = await run_explore(
        cast(Any, _FakeCatalog()),
        ExploreQuery(),
        _fake_settings(),
        Profile(academics=Academics(gpa_unweighted=Decimal("4.0"), gpa_scale=Decimal("4.0"))),
    )

    fit = response.schools[0].fit
    assert fit.category == "Unknown"
    assert fit.baseline_category == "Unknown"
    assert fit.basis == "missing_admit_rate"
    assert fit.baseline_admit_rate is None
    assert response.fit_profile_summary.has_academic_candidate is True
    assert response.fit_profile_summary.suggested_profile_fields == ("class_rank", "test_scores")


async def test_explore_malformed_optional_fact_degrades_only_that_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fit_executor(
        catalog: Any, statement: tuple[str, list[Any]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, Any], ...], dict[int, tuple[FactValueRow, ...]]]:
        return (_fit_main_row(),), {1: (_malformed_gpa_fact(),)}

    async def fake_explore(
        catalog: Any, statements: list[Any]
    ) -> tuple[tuple[dict[str, Any], ...], ...]:
        return (({"n": 1},), ({"n": 1},), (), (), (), ())

    monkeypatch.setattr(_db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(_db_service, "explore", fake_explore)

    response = await run_explore(
        cast(Any, _FakeCatalog()),
        ExploreQuery(),
        _fake_settings(),
        Profile(academics=Academics(gpa_unweighted=Decimal("3.8"), gpa_scale=Decimal("4.0"))),
    )

    fit = response.schools[0].fit
    assert fit.category == "Safety"
    assert fit.basis == "school_rate"
    assert fit.unavailable[0].reason == "gpa_distribution_invalid"


async def test_explore_calculates_different_fit_from_each_saved_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same school becomes a different server-calculated result per owner."""
    page = (_fit_main_row(admit_rate=Decimal("45")),)

    async def fake_fit_executor(
        catalog: Any, statement: tuple[str, list[Any]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, Any], ...], dict[int, tuple[FactValueRow, ...]]]:
        return page, {1: (_complete_gpa_distribution_fact(),)}

    async def fake_explore(
        catalog: Any, statements: list[Any]
    ) -> tuple[tuple[dict[str, Any], ...], ...]:
        return (({"n": 1},), ({"n": 1},), (), (), (), ())

    monkeypatch.setattr(_db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(_db_service, "explore", fake_explore)
    lower_profile = Profile(
        academics=Academics(gpa_unweighted=Decimal("3.2"), gpa_scale=Decimal("4"))
    )
    higher_profile = Profile(
        academics=Academics(gpa_unweighted=Decimal("4.0"), gpa_scale=Decimal("4"))
    )

    lower = await run_explore(
        cast(Any, _FakeCatalog()), ExploreQuery(), _fake_settings(), lower_profile
    )
    higher = await run_explore(
        cast(Any, _FakeCatalog()), ExploreQuery(), _fake_settings(), higher_profile
    )

    assert lower.schools[0].fit.category == "Target"
    assert higher.schools[0].fit.category == "Safety"
    assert lower.schools[0].fit.basis == higher.schools[0].fit.basis == "personalized"
