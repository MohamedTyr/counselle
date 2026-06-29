from __future__ import annotations

from app.research.plan import (
    _augment_user_text_with_scope,
    _candidate_school_mentions,
    _declines_scope_research,
    _fallback_plan,
    _format_plan_summary,
    _needs_scope_clarification,
    _scope_clarify_spec,
)
from domain.specs import SourceConfig


def test_candidate_school_mentions_splits_connected_schools() -> None:
    mentions = _candidate_school_mentions(
        "MIT and Stanford comparison for computer science admissions. Keep it concise."
    )

    assert "MIT" in mentions
    assert "Stanford" in mentions
    assert "Keep" not in mentions


def test_plan_summary_uses_enabled_sources_and_setting_cap() -> None:
    summary = _format_plan_summary(
        ["Massachusetts Institute of Technology", "Stanford University"],
        SourceConfig(web=False, reddit=False, edu=True),
        45,
    )

    assert "Massachusetts Institute of Technology, Stanford University" in summary
    assert "official school sites" in summary
    assert "the web" not in summary
    assert "Reddit" not in summary
    assert "45 seconds" in summary


def test_fallback_plan_is_structured_and_source_gated() -> None:
    plan = _fallback_plan(
        "MIT and Stanford comparison for computer science admissions and aid",
        ["Massachusetts Institute of Technology", "Stanford University"],
        SourceConfig(web=False, reddit=False, edu=True),
        60,
    )

    assert plan.schools == [
        "Massachusetts Institute of Technology",
        "Stanford University",
    ]
    assert plan.planner == "fallback"
    assert "fallback" in (plan.planner_note or "").lower()
    assert plan.max_runtime_seconds == 60
    assert plan.tasks
    task_sources = {source for task in plan.tasks for source in task.sources}
    assert "official" in task_sources
    assert "web" not in task_sources
    assert "reddit" not in task_sources
    assert not any("Reddit" in policy for policy in plan.source_policy)
    assert not any("Open web" in policy for policy in plan.source_policy)


def test_broad_schoolless_research_needs_scope_clarification() -> None:
    assert _needs_scope_clarification("Do deep research on colleges for me", [])


def test_constrained_schoolless_strategy_can_proceed() -> None:
    assert not _needs_scope_clarification(
        "Build an application strategy for strong merit aid in the Midwest for CS",
        [],
    )


def test_resolved_schools_do_not_need_scope_clarification() -> None:
    assert not _needs_scope_clarification(
        "Deep research MIT and Stanford for CS admissions and aid",
        ["Massachusetts Institute of Technology", "Stanford University"],
    )


def test_scope_clarify_spec_asks_for_typed_details() -> None:
    spec = _scope_clarify_spec(4)

    assert spec.header == "Research scope"
    assert "up to 4 schools" in spec.question
    assert [option.label for option in spec.options] == ["Answer normally", "Cancel"]
    assert spec.research_plan is None


def test_scope_answer_augments_user_text_for_planning() -> None:
    augmented = _augment_user_text_with_scope(
        "Do deep research on colleges for me",
        "CS, international applicant, needs aid, Northeast",
    )

    assert "Do deep research on colleges for me" in augmented
    assert "Scope details from student" in augmented
    assert "international applicant" in augmented


def test_scope_action_buttons_decline_deep_research() -> None:
    assert _declines_scope_research("Answer normally")
    assert _declines_scope_research("Cancel")
    assert not _declines_scope_research("MIT, Stanford, CS, need aid")
