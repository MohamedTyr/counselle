"""Schema-completeness and classification tests for profile field exposure
(agent mutation receipts plan §8.2). Pure — no DB, no LLM."""

from __future__ import annotations

import pytest

from app.profile_exposure import (
    PROFILE_ALL_LEAF_PATHS,
    PROFILE_CHANGED_ONLY_PATHS,
    PROFILE_EXACT_PATHS,
    classify_leaf,
    flatten_profile_patch,
)


def test_exact_and_changed_only_sets_are_disjoint() -> None:
    assert PROFILE_EXACT_PATHS.isdisjoint(PROFILE_CHANGED_ONLY_PATHS)


def test_schema_leaf_paths_equal_disjoint_union_of_exposure_sets() -> None:
    """The plan's own invariant (§8.2): adding/renaming a profile field must
    fail this test until deliberately classified — no silent exact/visible
    default for an unclassified leaf."""
    union = PROFILE_EXACT_PATHS | PROFILE_CHANGED_ONLY_PATHS
    assert union == PROFILE_ALL_LEAF_PATHS


class TestClassifyLeaf:
    def test_exact_path_classified(self) -> None:
        assert classify_leaf("basics.preferred_name") == "exact"

    def test_changed_only_path_classified(self) -> None:
        assert classify_leaf("basics.notes") == "changed_only"

    def test_unknown_path_raises(self) -> None:
        with pytest.raises(ValueError, match="unclassified profile leaf path"):
            classify_leaf("basics.made_up_field")


class TestFlattenProfilePatch:
    def test_flattens_nested_section_fields(self) -> None:
        patch = {"basics": {"preferred_name": "Alex", "notes": "likes tea"}}
        grouped = flatten_profile_patch(patch)
        paths = {path for path, _ in grouped["basics"]}
        assert paths == {"basics.preferred_name", "basics.notes"}

    def test_whole_section_clear_yields_one_bare_section_leaf(self) -> None:
        patch = {"academics": None}
        grouped = flatten_profile_patch(patch)
        assert grouped["academics"] == [("academics", None)]

    def test_list_of_scalars_is_one_leaf(self) -> None:
        patch = {"academics": {"current_courses": ["AP Calc", "AP Physics"]}}
        grouped = flatten_profile_patch(patch)
        assert grouped["academics"] == [
            ("academics.current_courses[]", ["AP Calc", "AP Physics"])
        ]

    def test_list_of_objects_expands_per_field(self) -> None:
        patch = {"background": {"hooks": [{"kind": "legacy", "detail": "parent alum"}]}}
        grouped = flatten_profile_patch(patch)
        paths = {path for path, _ in grouped["background"]}
        assert paths == {"background.hooks[].kind", "background.hooks[].detail"}

    def test_dynamic_dict_keys_collapse_to_wildcard(self) -> None:
        patch = {"testing": {"act": {"sections": {"english": 34.5}}}}
        grouped = flatten_profile_patch(patch)
        assert grouped["testing"] == [
            ("testing.act.sections.*", {"english": 34.5})
        ]

    def test_explicit_null_within_a_section_is_a_clear_leaf(self) -> None:
        patch = {"basics": {"pronouns": None}}
        grouped = flatten_profile_patch(patch)
        assert grouped["basics"] == [("basics.pronouns", None)]
