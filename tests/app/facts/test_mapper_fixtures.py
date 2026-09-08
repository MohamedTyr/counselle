"""Fixture-driven exit tests for `app/facts/mapper.py` (plan §4.5/§7 Phase 1).

Runs the real mapper over all eleven committed fixture schools (appendix
E-vi) — the routine-suite proof that `facts_keys.yaml` covers every label
CollegeData actually prints across a deliberately diverse corpus (a 2-year
open-admission college, a for-profit, an HBCU, a service academy, a
no-tuition college, a branch-campus/typo-slug pair, a multi-campus system),
not just Yale (appendix vi: "Yale alone is the least representative school
on the site").
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from adapters.collegedata.parse import ParsedPage, parse_page
from app.facts.mapper import MapResult, map_snapshot
from domain.facts.models import TAB_NAMES, TabName

# Typed as `tuple[TabName, ...]` (TAB_NAMES itself is `tuple[str, ...]`, pinned
# equal to this literal by tests/domain/facts/test_tab_names.py).
_TABS: tuple[TabName, ...] = (
    "overview",
    "admission",
    "money-matters",
    "academics",
    "campus-life",
    "students",
)
assert _TABS == TAB_NAMES

FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "collegedata"

# Appendix E-vi's eleven fixture slugs (Wellesley, marked optional there, is
# not included — eleven is the exit test's own number).
SLUGS: tuple[str, ...] = (
    "Yale-University",
    "University-of-Georgia",
    "Santa-Monica-College",
    "University-of-Phoenix",
    "School-of-the-Art-Institute-of-Chicago",
    "Spelman-College",
    "Ohio-State-University",
    "Berea-College",
    "United-States-Military-Academy",
    "Ohio-State-Universitity-at-Marion",
    "Arizona-State-University-at-the-West-campus",
)

# A handful of US city/state names that appear literally as labels somewhere
# in this fixture corpus ("Athens Population", "New Haven if officially part
# of the New York City m...", etc) — the plan's own worked examples for why
# a label capture must never leak into a fact_key.
_PLACE_TOKENS: tuple[str, ...] = (
    "yale",
    "georgia",
    "athens",
    "santa_monica",
    "phoenix",
    "chicago",
    "spelman",
    "atlanta",
    "columbus",
    "berea",
    "marion",
    "arizona",
    "west_point",
    "new_haven",
    "connecticut",
    "ohio",
    "tempe",
)


def _load_pages(slug: str) -> dict[TabName, ParsedPage]:
    pages: dict[TabName, ParsedPage] = {}
    for tab in _TABS:
        path = FIXTURE_ROOT / slug / f"{tab}.json"
        top_level = json.loads(path.read_text(encoding="utf-8"))
        pages[tab] = parse_page(tab, top_level)
    return pages


@pytest.fixture(scope="module")
def results() -> Mapping[str, MapResult]:
    return {slug: map_snapshot(_load_pages(slug)) for slug in SLUGS}


def test_all_eleven_fixtures_are_present_on_disk() -> None:
    for slug in SLUGS:
        for tab in TAB_NAMES:
            path = FIXTURE_ROOT / slug / f"{tab}.json"
            assert path.is_file(), f"missing fixture: {path}"


def test_identity_website_survives_an_unparseable_source_value() -> None:
    """`website` is a top-level profile field, not a header/body leaf, so it
    never went through the engine's `NormalizeError` -> `unmapped:` routing
    (school-data-v3 fix review). Before the fix, a school whose raw website
    string didn't parse as a URL crashed `map_snapshot` for the *whole*
    school, losing every fact from the pass, not just this one field -- two
    live schools hit exactly this in the full crawl. This must degrade to a
    dropped `unmapped:` fact instead."""
    pages = _load_pages("Yale-University")
    top_level = json.loads((FIXTURE_ROOT / "Yale-University" / "overview.json").read_text())
    top_level["pageProps"]["profile"]["website"] = "not a url at all"
    pages["overview"] = parse_page("overview", top_level)

    result = map_snapshot(pages)

    source_path = "overview/@profile/website"
    website_facts = [f for f in result.facts if f.source_path == source_path]
    assert len(website_facts) == 1
    assert website_facts[0].fact_key == f"unmapped:{source_path}"
    assert website_facts[0].value is None
    assert "identity.website" not in {f.fact_key for f in result.facts}


def test_zero_unmapped_labels_across_all_eleven_fixtures(
    results: Mapping[str, MapResult],
) -> None:
    failures = []
    for slug, result in results.items():
        unmapped = [f for f in result.facts if f.fact_key.startswith("unmapped:")]
        if unmapped:
            failures.append((slug, [f.source_path for f in unmapped]))
    assert not failures, f"unmapped labels found: {failures}"


def test_no_fact_key_matches_a_four_digit_year(results: Mapping[str, MapResult]) -> None:
    year_pattern = re.compile(r"\d{4}")
    offenders = {
        f.fact_key
        for result in results.values()
        for f in result.facts
        if not f.fact_key.startswith("unmapped:") and year_pattern.search(f.fact_key)
    }
    assert not offenders, f"fact_key(s) embed a year: {offenders}"


def test_no_fact_key_embeds_a_city_or_state_token(results: Mapping[str, MapResult]) -> None:
    offenders = {
        f.fact_key
        for result in results.values()
        for f in result.facts
        if not f.fact_key.startswith("unmapped:")
        and any(token in f.fact_key.lower() for token in _PLACE_TOKENS)
    }
    assert not offenders, f"fact_key(s) embed a city/state token: {offenders}"


def test_no_fact_key_is_emitted_from_two_tabs_for_one_school(
    results: Mapping[str, MapResult],
) -> None:
    failures = []
    for slug, result in results.items():
        tabs_by_key: dict[str, set[str]] = {}
        for fact in result.facts:
            if fact.fact_key.startswith("unmapped:"):
                continue
            tabs_by_key.setdefault(fact.fact_key, set()).add(fact.tab)
        multi_tab = {key: tabs for key, tabs in tabs_by_key.items() if len(tabs) > 1}
        if multi_tab:
            failures.append((slug, multi_tab))
    assert not failures, f"fact_key(s) sourced from more than one tab: {failures}"


def test_no_fact_key_is_a_sum_of_two_percentile_facts(
    results: Mapping[str, MapResult],
) -> None:
    """R14: CollegeData never prints a combined SAT total, and the mapper
    must never synthesize one — a `school_facts` fact_key claims to be an
    observed value. `school_explore_rows` must never synthesize one either
    (no exception for it): see `tests/app/facts/test_explore_projection.py`."""
    banned_substrings = ("sat_total", "combined_score", "composite_total")
    for result in results.values():
        for fact in result.facts:
            lowered = fact.fact_key.lower()
            assert not any(bad in lowered for bad in banned_substrings), fact.fact_key
    # Source-level guard: no handler ever adds two percentile-shaped
    # NormalizedValues together to synthesize a new one.
    source = (
        Path(__file__).resolve().parents[3] / "app" / "facts" / "mapper_handlers.py"
    ).read_text()
    assert "value_num +" not in source and "+ match" not in source


def test_a_fixture_with_an_intermediate_node_removed_produces_the_same_fact_keys() -> None:
    """Routing must key on (tab, section, divider, node_type, label) content
    — never ordinal position (plan §4.4). Removes the first BarGraph under
    admission/"Profile of Fall Admission"/"ACT Scores of Enrolled Freshmen"
    (Yale's untitled ACT-composite graph) from the raw JSON, which shifts
    every subsequent same-divider BarGraph's `_next_ordinal` counter down by
    one — the ACT Math/ACT Eng subscore graphs (which key on their own
    title's `ACT Math:`/`ACT Eng:` prefix, not their ordinal) must still
    resolve to the same fact_keys with the same values.
    """
    # University of Georgia, not Yale: Yale's ACT graphs are all "Not
    # reported" (no avg parses out of them at all, so there's nothing to
    # prove stayed put); UGA's carry real "ACT Math: 28"/"ACT Eng: 31"
    # averages.
    slug = "University-of-Georgia"
    original_pages = _load_pages(slug)
    original = map_snapshot(original_pages)
    original_by_key = {f.fact_key: f for f in original.facts}
    for key in ("class_profile.act_math_avg", "class_profile.act_english_avg"):
        assert key in original_by_key, f"fixture assumption changed: {key} missing before mutation"

    admission_top = json.loads((FIXTURE_ROOT / slug / "admission.json").read_text())
    mutated_top = copy.deepcopy(admission_top)
    body = mutated_top["pageProps"]["profile"]["bodyContent"]
    act_bar_graphs = _find_and_remove_first_bar_graph_under_divider(
        body, "ACT Scores of Enrolled Freshmen"
    )
    assert act_bar_graphs, "fixture assumption changed: no ACT BarGraph found to remove"

    from adapters.collegedata.parse import parse_page

    mutated_page = parse_page("admission", mutated_top)
    mutated_pages = dict(original_pages)
    mutated_pages["admission"] = mutated_page
    mutated = map_snapshot(mutated_pages)
    mutated_by_key = {f.fact_key: f for f in mutated.facts}

    for key in ("class_profile.act_math_avg", "class_profile.act_english_avg"):
        assert key in mutated_by_key, f"{key} disappeared after removing a sibling node"
        assert mutated_by_key[key].value == original_by_key[key].value, key
    unmapped_after = [f for f in mutated.facts if f.fact_key.startswith("unmapped:")]
    assert not unmapped_after, unmapped_after


def _find_and_remove_first_bar_graph_under_divider(
    body: list[dict[str, Any]], divider_value: str
) -> bool:
    """Depth-first search through `ExpandableSection`s for the first
    `CategoryDivider`-then-`BarGraph` run matching `divider_value`; removes
    the first `BarGraph` immediately following it. Returns whether it found
    (and removed) one."""
    for node in body:
        if node.get(
            "type"
        ) == "ExpandableSection" and _find_and_remove_first_bar_graph_under_divider(
            node["data"]["children"], divider_value
        ):
            return True
    current_divider = None
    for index, node in enumerate(body):
        if node.get("type") == "CategoryDivider":
            current_divider = node["data"]["value"]
        elif node.get("type") == "BarGraph" and current_divider == divider_value:
            del body[index]
            return True
    return False
