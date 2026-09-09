"""Tests for adapters/collegedata/parse.py — NO network calls (all fixtures
inline, condensed from live captures verified 2026-09-07 against Yale's six
tabs; the committed 11-school fixture corpus is
`tests/app/facts/test_mapper_fixtures.py`'s job, not this module's).
"""

from __future__ import annotations

import pytest

from adapters.collegedata.parse import (
    ParseError,
    content_hash,
    extract_profile,
    parse_page,
    walk_header,
    walk_page,
)
from domain.envelope import JsonValue


def _top_level(profile: dict[str, JsonValue]) -> dict[str, JsonValue]:
    return {"pageProps": {"isStateList": False, "profile": profile}, "__N_SSP": True}


# A condensed but structurally real body, covering all nine node types plus
# the academics-only headerCardContent shape — every `data` field name and
# nesting matches a live capture.
_BODY: list[JsonValue] = [
    {
        "type": "ExpandableSection",
        "data": {
            "title": "Admissions",
            "iconType": None,
            "link": None,
            "children": [
                {
                    "type": "CategoryDivider",
                    "data": {"value": "High School Preparation"},
                },
                {
                    "type": "TitleValue",
                    "data": {"title": "High School Graduation", "value": ["Required"]},
                },
                {
                    "type": "TitleValue",
                    "data": {"title": "Overall Admission Rate", "value": [
                        "5% of 50,264 applicants were admitted"
                    ]},
                },
                {
                    "type": "TitleLink",
                    "data": {
                        "title": "Electronic Application",
                        "text": "Apply Now",
                        "link": "https://apply.example.edu",
                    },
                },
                {
                    "type": "NestedTitleValue",
                    "data": {
                        "topTitleValue": {
                            "title": "Overall Admission Rate",
                            "value": ["5% of 50,264 applicants were admitted"],
                        },
                        "children": [
                            {"title": "Women", "value": ["4% of 27,445 applicants"]},
                            {"title": "Men", "value": ["5% of 22,819 applicants"]},
                        ],
                    },
                },
                {
                    "type": "LabeledTable",
                    "data": {
                        "tableTitle": "Examinations",
                        "keyTitle": "Subject",
                        "valueTitles": ["Required Units", "Due in Admissions Office"],
                        "data": [
                            {"label": "SAT or ACT", "values": ["Considered", "March 15"]},
                            {"label": "SAT Only", "values": ["Not reported", "Not reported"]},
                        ],
                    },
                },
                {
                    "type": "IconTable",
                    "data": {
                        "tableTitle": "",
                        "keyTitle": "Sports",
                        "valueTitles": ["Women", "Women", "Men", "Men"],
                        "data": [
                            {"label": "Archery", "values": ["check", None, "check", None]},
                        ],
                    },
                },
                {
                    "type": "BarGraph",
                    "data": {
                        "title": "",
                        "data": [
                            {"label": "4.00 and Above", "value": -1},
                            {"label": "3.75 - 3.99", "value": 26.3},
                        ],
                    },
                },
                {
                    "type": "SubscreenNavigator",
                    "data": {
                        "title": "Undergraduate Majors",
                        "buttonText": "View All Majors (90)",
                        "data": ["Biology", "Chemistry"],
                    },
                },
            ],
        },
    }
]

_PROFILE: dict[str, JsonValue] = {
    "id": 391,
    "slug": "Yale-University",
    "name": "Yale University",
    "website": "https://www.yale.edu/",
    "description": "Yale is a private, Ivy League university.",
    "universityType": "Private",
    "populationType": "Coed",
    "undergradPopulation": 6591,
    "gradPopulation": None,
    "malePercentage": 48.8,
    "femalePercentage": 50.1,
    "address": {
        "street1": "38 Hillhouse Avenue",
        "street2": None,
        "city": "New Haven",
        "state": "CT",
        "zipCode": "06520",
    },
    "admissionsPhone": "(203) 432-9316",
    "attendanceCost": ["$99,085", "$99,085"],
    "chance": None,
    "bodyContent": _BODY,
}


class TestExtractProfile:
    def test_extracts_pageprops_profile(self) -> None:
        top = _top_level(_PROFILE)
        assert extract_profile(top) == _PROFILE

    def test_raises_when_pageprops_missing(self) -> None:
        with pytest.raises(ParseError, match="pageProps"):
            extract_profile({"nope": True})

    def test_raises_when_profile_missing(self) -> None:
        with pytest.raises(ParseError, match="profile"):
            extract_profile({"pageProps": {"isStateList": False}})


class TestParsePage:
    def test_parses_all_nine_node_types_and_header_scalars(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))

        assert page.tab == "admission"
        assert page.header.universityType == "Private"
        assert page.header.undergradPopulation == 6591
        assert page.header.address is not None
        assert page.header.address.city == "New Haven"
        assert len(page.body) == 1  # one top-level ExpandableSection

    def test_raises_parse_error_on_an_unrecognized_node_shape(self) -> None:
        bad_body: JsonValue = [{"type": "TotallyNew", "data": {}}]
        bad_profile: dict[str, JsonValue] = {**_PROFILE, "bodyContent": bad_body}
        with pytest.raises(ParseError):
            parse_page("admission", _top_level(bad_profile))

    def test_raises_parse_error_when_body_content_is_not_a_list(self) -> None:
        bad_profile = {**_PROFILE, "bodyContent": "not a list"}
        with pytest.raises(ParseError):
            parse_page("admission", _top_level(bad_profile))

    def test_an_unknown_header_key_is_ignored_not_fatal(self) -> None:
        # extra="ignore" on ProfileHeader — a school-specific new key must
        # never crash the whole crawl pass (module docstring).
        profile = {**_PROFILE, "someBrandNewFieldNobodyHasSeenYet": 42}
        page = parse_page("admission", _top_level(profile))
        assert not hasattr(page.header, "someBrandNewFieldNobodyHasSeenYet")


class TestWalkPage:
    def test_walks_every_node_type_to_a_leaf(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = list(walk_page("admission", page.body))
        node_types = {leaf.node_type for leaf in leaves}
        assert node_types == {
            "TitleValue",
            "TitleLink",
            "NestedTitleValue",
            "LabeledTable",
            "IconTable",
            "BarGraph",
            "SubscreenNavigator",
        }

    def test_section_title_and_divider_context_propagate(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = list(walk_page("admission", page.body))
        title_value_leaf = next(leaf for leaf in leaves if leaf.node_type == "TitleValue")
        assert title_value_leaf.section_title == "Admissions"
        assert title_value_leaf.divider == "High School Preparation"

    def test_nested_title_value_yields_parent_and_children(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = [leaf for leaf in walk_page("admission", page.body)
                  if leaf.node_type == "NestedTitleValue"]
        assert len(leaves) == 3  # parent + Women + Men
        labels = {leaf.label for leaf in leaves}
        assert labels == {"Overall Admission Rate", "Women", "Men"}

    def test_labeled_table_row_carries_values_and_column_titles(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        row = next(leaf for leaf in walk_page("admission", page.body)
                   if leaf.node_type == "LabeledTable")
        assert row.raw == {
            "values": ["Considered", "March 15"],
            "columns": ["Required Units", "Due in Admissions Office"],
        }

    def test_icon_table_null_cell_is_preserved(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        row = next(leaf for leaf in walk_page("admission", page.body)
                   if leaf.node_type == "IconTable")
        assert row.raw == {
            "values": ["check", None, "check", None],
            "columns": ["Women", "Women", "Men", "Men"],
        }

    def test_bar_graph_preserves_the_not_reported_sentinel_and_fractional_values(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        bar = next(leaf for leaf in walk_page("admission", page.body)
                   if leaf.node_type == "BarGraph")
        assert bar.raw == [
            {"label": "4.00 and Above", "value": -1},
            {"label": "3.75 - 3.99", "value": 26.3},
        ]

    def test_title_value_is_never_split_by_this_module(self) -> None:
        # "5% of 50,264 applicants were admitted" stays one raw string in a
        # one-element list — splitting into 3 facts is the mapper's job.
        page = parse_page("admission", _top_level(_PROFILE))
        leaf = next(
            leaf for leaf in walk_page("admission", page.body)
            if leaf.node_type == "TitleValue" and leaf.label == "Overall Admission Rate"
        )
        assert leaf.raw == ["5% of 50,264 applicants were admitted"]

    def test_ordinals_reset_per_divider(self) -> None:
        body: JsonValue = [{
            "type": "ExpandableSection",
            "data": {"title": "S", "iconType": None, "link": None, "children": [
                {"type": "CategoryDivider", "data": {"value": "A"}},
                {"type": "TitleValue", "data": {"title": "t1", "value": ["x"]}},
                {"type": "CategoryDivider", "data": {"value": "B"}},
                {"type": "TitleValue", "data": {"title": "t2", "value": ["y"]}},
            ]},
        }]
        profile: dict[str, JsonValue] = {**_PROFILE, "bodyContent": body}
        page = parse_page("admission", _top_level(profile))
        leaves = list(walk_page("admission", page.body))
        assert leaves[0].source_path == "admission/S/A/TitleValue#0"
        assert leaves[1].source_path == "admission/S/B/TitleValue#0"


class TestWalkHeader:
    def test_walks_declared_scalars(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = {leaf.label: leaf.raw for leaf in walk_header("admission", page.header)}
        assert leaves["universityType"] == "Private"
        assert leaves["undergradPopulation"] == 6591
        assert leaves["address"] == {
            "street1": "38 Hillhouse Avenue",
            "street2": None,
            "city": "New Haven",
            "state": "CT",
            "zipCode": "06520",
        }

    def test_null_scalars_are_not_walked(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = {leaf.label for leaf in walk_header("admission", page.header)}
        assert "gradPopulation" not in leaves  # null on this capture

    def test_two_element_arrays_walk_as_two_indexed_leaves(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        leaves = [
            leaf for leaf in walk_header("admission", page.header)
            if leaf.label == "attendanceCost"
        ]
        assert [leaf.source_path for leaf in leaves] == [
            "admission/@profile/attendanceCost/0",
            "admission/@profile/attendanceCost/1",
        ]
        assert [leaf.raw for leaf in leaves] == ["$99,085", "$99,085"]

    def test_chance_and_structural_keys_are_never_walked(self) -> None:
        page = parse_page("admission", _top_level(_PROFILE))
        labels = {leaf.label for leaf in walk_header("admission", page.header)}
        assert "chance" not in labels
        assert "id" not in labels
        assert "slug" not in labels
        assert "bodyContent" not in labels


class TestContentHash:
    def test_stable_across_chance_null_vs_absent(self) -> None:
        with_null = {"a": 1, "chance": None}
        without = {"a": 1}
        assert content_hash(with_null) == content_hash(without)

    def test_stable_across_key_order(self) -> None:
        assert content_hash({"a": 1, "b": 2}) == content_hash({"b": 2, "a": 1})

    def test_changes_when_a_real_value_changes(self) -> None:
        assert content_hash({"a": 1}) != content_hash({"a": 2})

    def test_ignores_chance_even_when_populated(self) -> None:
        # chance is session-derived, never a diff signal (E-N1).
        assert content_hash({"a": 1, "chance": "60%"}) == content_hash({"a": 1})

    def test_is_a_32_byte_sha256_digest(self) -> None:
        digest = content_hash({"a": 1})
        assert isinstance(digest, bytes)
        assert len(digest) == 32
