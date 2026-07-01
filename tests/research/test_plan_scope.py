from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.research.plan import (
    _augment_user_text_with_scope,
    _candidate_school_mentions,
    _declines_scope_research,
    _fallback_plan,
    _format_plan_summary,
    _needs_scope_clarification,
    _scope_clarify_spec,
    research_plan_confirm_node,
    research_scope_node,
)
from domain.specs import ResearchPlanSpec, SourceConfig


def test_candidate_school_mentions_splits_connected_schools() -> None:
    mentions = _candidate_school_mentions(
        "MIT and Stanford comparison for computer science admissions. Keep it concise."
    )

    assert "MIT" in mentions
    assert "Stanford" in mentions
    assert "Keep" not in mentions


def test_candidate_school_mentions_does_not_treat_sat_as_school() -> None:
    mentions = _candidate_school_mentions(
        "MIT and Stanford comparison for current SAT/ACT policy."
    )

    assert "MIT" in mentions
    assert "Stanford" in mentions
    assert "SAT" not in mentions
    assert "ACT" not in mentions


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


def _state(messages_text: str, **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "messages": [
            {
                "kind": "request",
                "parts": [{"part_kind": "user-prompt", "content": messages_text}],
            }
        ],
        "source_config": {"web": True, "edu": True, "reddit": False},
        "research": {},
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_scope_node_persists_augmented_scope_onto_research_state() -> None:
    """Regression (2026-07-01 live-caught bug): research_scope_node must write
    the resolved user_text/schools into research state, not just a local
    variable — research_plan_confirm_node has no other way to see them, since
    a clarify answer never re-enters state["messages"]."""
    deps = object()
    with (
        patch("app.research.plan.get_stream_writer", return_value=lambda _chunk: None),
        patch("app.research.plan._parse_schools", new_callable=AsyncMock, return_value=[]),
        patch(
            "app.research.plan.interrupt",
            return_value="CS major, needs financial aid, Northeast region",
        ),
    ):
        result = await research_scope_node(
            _state("Do deep research on the best colleges for me."), deps
        )

    research = result["research"]
    assert research["branch"] == "scoped"
    assert "Scope details from student" in research["user_text"]
    assert "financial aid" in research["user_text"]
    assert research["schools"] == []


@pytest.mark.asyncio
async def test_plan_confirm_node_uses_persisted_scope_not_raw_messages() -> None:
    """Regression (2026-07-01 live-caught bug): the old single-node design
    re-derived user_text/schools from state["messages"] on every resume,
    including the resume that should have run the CONFIRMED plan — silently
    discarding the scope answer and re-planning from the bare original
    question. research_plan_confirm_node must read the already-resolved
    research["user_text"]/research["schools"] instead."""
    deps = object()
    resolved_text = (
        "Do deep research on the best colleges for me.\n\n"
        "Scope details from student: Compare MIT, Stanford, and Carnegie Mellon "
        "for undergraduate computer science admissions, financial aid, and "
        "current test policy."
    )
    state = _state(
        # Deliberately misleading: if the node re-derives from raw messages
        # instead of research state, it will see this bare, unscoped text.
        "Do deep research on the best colleges for me.",
        research={
            "user_text": resolved_text,
            "schools": ["Massachusetts Institute of Technology", "Stanford University"],
            "emissions": [],
        },
    )
    canned_plan = ResearchPlanSpec(
        summary="Compare MIT and Stanford for CS admissions and aid.",
        planner="fallback",
        schools=["Massachusetts Institute of Technology", "Stanford University"],
        topics=["Admissions"],
        tasks=[],
        source_policy=[],
        limitations=[],
        max_runtime_seconds=90,
    )
    with (
        patch("app.research.plan.get_stream_writer", return_value=lambda _chunk: None),
        patch(
            "app.research.plan._build_research_plan",
            new_callable=AsyncMock,
            return_value=canned_plan,
        ) as build_plan,
        patch("app.research.plan.interrupt", return_value="Run deep research"),
    ):
        result = await research_plan_confirm_node(state, deps)

    assert build_plan.await_args is not None
    assert build_plan.await_args.kwargs["user_text"] == resolved_text
    assert build_plan.await_args.kwargs["schools"] == [
        "Massachusetts Institute of Technology",
        "Stanford University",
    ]
    assert result["research"]["branch"] == "run"
    assert result["research"]["plan"]["user_text"] == resolved_text
