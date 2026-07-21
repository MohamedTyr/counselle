"""Default-deny profile field exposure classification (mutation receipts plan §8.2).

Every profile leaf field is classified as either ``exact`` (its typed value
crosses the mutation-receipt seam) or ``changed_only`` (state-only — the
field changed, but its content stays hidden). An unclassified leaf is a bug:
``classify_leaf`` raises rather than silently defaulting to exact/visible, so
adding or renaming a profile field fails loudly until deliberately
classified. ``PROFILE_ALL_LEAF_PATHS`` walks the actual ``Profile`` pydantic
schema (not just runtime patch content), so the completeness test in
``tests/app/test_profile_exposure.py`` catches schema drift, not just today's
call sites.
"""

from __future__ import annotations

import types
from typing import Any, Literal, Union, get_args, get_origin

from pydantic import BaseModel

from app.workspace.models import Profile

Classification = Literal["exact", "changed_only"]

#: Exact typed value crosses the receipt (before/after when transactionally
#: captured). Copied verbatim from plan §8.2's ``PROFILE_EXACT_PATHS``.
PROFILE_EXACT_PATHS: frozenset[str] = frozenset(
    {
        "basics.preferred_name",
        "basics.pronouns",
        "basics.grade_level",
        "basics.graduation_year",
        "basics.high_school.name",
        "basics.high_school.type",
        "basics.high_school.city",
        "basics.high_school.state",
        "basics.high_school.country",
        "academics.gpa_unweighted",
        "academics.gpa_weighted",
        "academics.gpa_scale",
        "academics.class_rank",
        "academics.class_size",
        "academics.school_ranks",
        "academics.grade_trend.trend",
        "academics.current_courses[]",
        "testing.sat.total",
        "testing.sat.ebrw",
        "testing.sat.math",
        "testing.sat.date",
        "testing.act.composite",
        "testing.act.date",
        "testing.planned_tests[].test",
        "testing.planned_tests[].date",
        "testing.psat.total",
        "testing.psat.nmsqt_status",
        "testing.ap_scores[].subject",
        "testing.ap_scores[].score",
        "testing.ib.programme",
        "testing.ib.predicted",
        "testing.ib.final",
        "testing.english_proficiency.test",
        "testing.english_proficiency.score",
        "testing.english_proficiency.date",
        "background.residence.city",
        "background.residence.state",
        "background.residence.country",
        "background.languages[]",
        "background.community_type",
        "interests.intended_majors[]",
        "interests.major_certainty",
        "interests.alternate_majors[]",
        "interests.preprofessional[]",
        "preferences.sizes[]",
        "preferences.settings[]",
        "preferences.regions[]",
        "preferences.max_distance_from_home",
        "preferences.climate",
        "preferences.must_haves[]",
        "preferences.dealbreakers[]",
    }
)

#: Field changed, content hidden. Copied verbatim from plan §8.2's
#: ``PROFILE_CHANGED_ONLY_PATHS``.
PROFILE_CHANGED_ONLY_PATHS: frozenset[str] = frozenset(
    {
        "basics.notes",
        "academics.grade_trend.why",
        "academics.rigor_summary",
        "academics.notes",
        "testing.act.sections.*",
        "testing.notes",
        "background.citizenship",
        "background.visa_status",
        "background.first_gen",
        "background.family_education",
        "background.hooks[].kind",
        "background.hooks[].detail",
        "background.notes",
        "circumstances.disruptions",
        "circumstances.responsibilities",
        "circumstances.health_learning",
        "circumstances.disciplinary",
        "circumstances.notes",
        "aid.need_aid",
        "aid.budget_per_year",
        "aid.sai_estimate",
        "aid.css_complexity",
        "aid.loan_appetite",
        "aid.merit_priority",
        "aid.applying_for_scholarships",
        "aid.notes",
        "interests.career_direction",
        "interests.notes",
        "preferences.campus_culture",
        "preferences.notes",
        "narrative.spike",
        "narrative.defining_experiences",
        "narrative.self_description",
        "narrative.values_motivations",
        "narrative.essay_angles",
        "narrative.notes",
        "people.recommenders[].name",
        "people.recommenders[].role_or_subject",
        "people.recommenders[].why_them",
        "people.recommenders[].asked",
        "people.counselor_context",
        "people.family_stance",
        "people.other_support",
        "people.notes",
    }
)

SECTION_LABELS: dict[str, str] = {
    "basics": "Basics",
    "academics": "Academics",
    "testing": "Testing",
    "background": "Background",
    "circumstances": "Personal context",
    "aid": "Financial aid",
    "interests": "Interests",
    "preferences": "Preferences",
    "narrative": "Narrative",
    "people": "People",
}


def classify_leaf(path: str) -> Classification:
    """Classify one normalized profile leaf path. Raises on an unknown path —
    default-deny: there is no silent fallback to exact/visible (plan §8.2)."""
    if path in PROFILE_EXACT_PATHS:
        return "exact"
    if path in PROFILE_CHANGED_ONLY_PATHS:
        return "changed_only"
    raise ValueError(
        f"unclassified profile leaf path {path!r} — add it to PROFILE_EXACT_PATHS or "
        "PROFILE_CHANGED_ONLY_PATHS in app/profile_exposure.py before it can appear in a "
        "mutation receipt"
    )


def _unwrap_optional(annotation: Any) -> Any:
    origin = get_origin(annotation)
    if origin is Union or origin is types.UnionType:
        args = [arg for arg in get_args(annotation) if arg is not type(None)]
        if len(args) == 1:
            return args[0]
    return annotation


def _annotation_leaf_paths(annotation: Any, path: str) -> set[str]:
    annotation = _unwrap_optional(annotation)
    origin = get_origin(annotation)
    if origin is list:
        (item_type,) = get_args(annotation)
        item_type = _unwrap_optional(item_type)
        if isinstance(item_type, type) and issubclass(item_type, BaseModel):
            return _model_leaf_paths(item_type, f"{path}[]")
        return {f"{path}[]"}
    if origin is dict:
        # A dynamic-key dict (only testing.act.sections today) — the plan's
        # wildcard notation names the whole mapping, not a specific key.
        return {f"{path}.*"}
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return _model_leaf_paths(annotation, path)
    return {path}


def _model_leaf_paths(model: type[BaseModel], prefix: str) -> set[str]:
    paths: set[str] = set()
    for name, field in model.model_fields.items():
        full = f"{prefix}.{name}" if prefix else name
        paths.update(_annotation_leaf_paths(field.annotation, full))
    return paths


#: Every leaf path the current ``Profile`` schema can produce. A schema-
#: completeness test asserts this equals the disjoint union of the two
#: exposure sets above (plan §8.2) — adding/renaming a field fails that test
#: until classified.
PROFILE_ALL_LEAF_PATHS: frozenset[str] = frozenset(_model_leaf_paths(Profile, ""))


def flatten_profile_patch(patch_dict: dict[str, Any]) -> dict[str, list[tuple[str, Any]]]:
    """Group a ``ProfilePatch``-shaped dict's changed leaves by section.

    ``patch_dict`` is exactly the shape ``_build_patch_dict`` in
    ``agent_tools_profile.py`` already produces: ``{section: None}`` for a
    whole-section clear, or ``{section: {field: value, ...}}`` (nested dicts
    from ``model_dump(exclude_unset=True)``) otherwise. A leaf value of
    ``None`` inside a section means that one field was explicitly cleared
    (pydantic keeps explicit nulls when only unset fields are excluded).
    """
    by_section: dict[str, list[tuple[str, Any]]] = {}
    for section, value in patch_dict.items():
        if value is None:
            by_section[section] = [(section, None)]
            continue
        by_section[section] = _flatten(section, value)
    return by_section


def _flatten(prefix: str, value: Any) -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        if prefix == "testing.act.sections":
            return [(f"{prefix}.*", value)]
        leaves: list[tuple[str, Any]] = []
        for key, sub_value in value.items():
            leaves.extend(_flatten(f"{prefix}.{key}", sub_value))
        return leaves
    if isinstance(value, list):
        if not value or not isinstance(value[0], dict):
            return [(f"{prefix}[]", value)]
        leaves = []
        for item in value:
            for key, sub_value in item.items():
                leaves.append((f"{prefix}[].{key}", sub_value))
        return leaves
    return [(prefix, value)]
