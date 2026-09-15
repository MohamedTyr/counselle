"""Phase-0 contract freeze for admissions-fit input facts.

The estimator consumes ``current_school_facts`` rows, not crawler HTML.  These
tests keep its planned adapter tied to the mapper's existing public contract:
the exact keys, the GPA selector/payload shape, and the stored test-policy
enum codes.  They intentionally do not calculate a fit; that belongs to the
later pure-domain and adapter suites.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest

from adapters.collegedata.parse import parse_page
from app.facts.mapper import MapResult, map_snapshot
from counselle_db.models import FactValueRow
from domain.facts.models import FactRow

_ROOT = Path(__file__).resolve().parents[2]
_COLLEGEDATA_FIXTURES = _ROOT / "fixtures" / "collegedata"
_FIT_FIXTURES = _ROOT / "fixtures" / "admissions_fit"

_FIXTURE_FILES = (
    "complete_required_school.json",
    "partial_gpa.json",
    "not_reported_gpa.json",
    "invalid_rank_shares.json",
    "stale_observations.json",
    "test_policy_codes.json",
)

_FIT_FACT_KEYS = frozenset(
    {
        "admissions.test_policy_sat_or_act",
        "class_profile.gpa_distribution",
        "class_profile.class_rank_top_tenth",
        "class_profile.class_rank_top_quarter",
        "class_profile.class_rank_top_half",
        "class_profile.sat_math_p25",
        "class_profile.sat_math_p75",
        "class_profile.sat_ebrw_p25",
        "class_profile.sat_ebrw_p75",
        "class_profile.act_composite_p25",
        "class_profile.act_composite_p75",
    }
)


def _load(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((_FIT_FIXTURES / name).read_text(encoding="utf-8")))


def _mapped_admission(slug: str) -> MapResult:
    page = json.loads((_COLLEGEDATA_FIXTURES / slug / "admission.json").read_text())
    return map_snapshot({"admission": parse_page("admission", page)})


def _walk_nodes(nodes: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for node in nodes:
        yield node
        children = node.get("data", {}).get("children")
        if isinstance(children, list):
            yield from _walk_nodes(children)


def _fact(result: MapResult, key: str) -> FactRow:
    return next(fact for fact in result.facts if fact.fact_key == key)


def test_phase_zero_normalized_fixture_set_exists() -> None:
    """RED before Phase 0: these inputs did not have a frozen test corpus."""
    assert _FIT_FIXTURES.is_dir()
    for name in _FIXTURE_FILES:
        assert (_FIT_FIXTURES / name).is_file(), name


def test_frozen_rows_still_parse_as_current_school_facts_contract() -> None:
    for name in _FIXTURE_FILES:
        payload = _load(name)
        rows = payload["current_school_facts"]
        assert isinstance(rows, list) and rows, name
        parsed = tuple(FactValueRow.model_validate(row) for row in rows)
        assert all(row.fact_key in _FIT_FACT_KEYS for row in parsed), name


def test_complete_fixture_pins_the_full_existing_fit_key_set() -> None:
    payload = _load("complete_required_school.json")
    assert payload["school_explore"] == {"admit_rate": 21}
    assert {row["fact_key"] for row in payload["current_school_facts"]} == _FIT_FACT_KEYS


def test_partial_gpa_fixture_preserves_mixed_reported_and_absent_buckets() -> None:
    row = _load("partial_gpa.json")["current_school_facts"][0]
    payload = row["value"]["value"]
    assert row["value_type"] == "distribution"
    assert payload["scale"] == "gpa"
    assert payload["sums_to"] == 90.0
    buckets = payload["buckets"]
    assert any(bucket.get("absence") == "not_reported" for bucket in buckets)
    assert any(bucket.get("pct") is not None for bucket in buckets)


def test_mapper_gpa_selector_is_the_exact_4_scale_heading_and_normalizes_gpa_payload() -> None:
    """The key must not be emitted for a superficially similar GPA heading."""
    raw = json.loads(
        (_COLLEGEDATA_FIXTURES / "University-of-Georgia" / "admission.json").read_text()
    )
    result = map_snapshot({"admission": parse_page("admission", raw)})
    gpa = _fact(result, "class_profile.gpa_distribution")
    assert gpa.value is not None
    assert gpa.value.kind == "distribution"
    assert isinstance(gpa.value.value, dict)
    assert gpa.value.value["scale"] == "gpa"

    changed = copy.deepcopy(raw)
    nodes = changed["pageProps"]["profile"]["bodyContent"]
    selector = "Grade Point Average of Enrolled Freshmen (4.0 Scale)"
    divider = next(
        node
        for node in _walk_nodes(nodes)
        if node.get("type") == "CategoryDivider" and node.get("data", {}).get("value") == selector
    )
    divider["data"]["value"] = "Grade Point Average of Enrolled Freshmen (5.0 Scale)"
    changed_result = map_snapshot({"admission": parse_page("admission", changed)})
    assert "class_profile.gpa_distribution" not in {
        fact.fact_key for fact in changed_result.facts
    }


@pytest.mark.parametrize(
    ("slug", "expected"),
    (
        ("University-of-Georgia", "required"),
        ("Yale-University", "considered_if_submitted"),
    ),
)
def test_mapper_preserves_observed_sat_or_act_policy_codes(slug: str, expected: str) -> None:
    fact = _fact(_mapped_admission(slug), "admissions.test_policy_sat_or_act")
    assert fact.value is not None
    assert fact.value.kind == "enum"
    assert fact.value.value_text == expected


def test_live_observed_policy_fixture_pins_all_current_codes() -> None:
    payload = _load("test_policy_codes.json")
    assert {
        row["value_text"] for row in payload["current_school_facts"]
    } == {
        "considered_if_submitted",
        "not_used_if_submitted",
        "recommended",
        "required",
        "required_for_some",
    }
