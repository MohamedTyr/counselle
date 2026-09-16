"""Tests for app/goal_judge.py (plans/goal-mode-plan.md §6.2).

No live LLM calls: every Agent call is stubbed with pydantic_ai's
``FunctionModel`` (the same technique ``tests/app/test_ask_student_output_tool_seam.py``
and ``tests/app/test_plan_tool.py`` use), so these run in the routine
(non-``live_llm``) suite. ``app.goal_judge._vertex_model`` is monkeypatched to
hand back the stub model instead of constructing a real Vertex client.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RunUsage

import app.goal_judge as goal_judge
from app.goal_judge import GoalCriteriaError, judge_goal, select_evidence, unknown_step_ids
from config.settings import get_settings
from domain.events import StepData, StepDetail
from domain.goal import GoalCriterion
from domain.mutation_receipts import (
    BoundedDisplayText,
    MutationSubject,
    UpdateMutationBody,
    WorkspaceMutationReceipt,
)


def _settings(**overrides: object) -> Any:
    return get_settings().model_copy(update=overrides)


def _stub_model(
    model_fn: Callable[[list[ModelMessage], AgentInfo], ModelResponse],
) -> FunctionModel:
    """Build the stand-in model ``app.goal_judge._vertex_model`` is patched to return."""
    return FunctionModel(model_fn)


def _tool_response(output_tools: object, **args: object) -> ModelResponse:
    name = output_tools[0].name if output_tools else "final_result"  # type: ignore[index]
    return ModelResponse(parts=[ToolCallPart(tool_name=name, args=args)])


def _update_receipt(field_key: str, outcome: str = "success") -> WorkspaceMutationReceipt:
    from domain.mutation_receipts import MutationChange, MutationValue

    return WorkspaceMutationReceipt(
        family="school",
        action="update",
        outcome=outcome,  # type: ignore[arg-type]
        body=UpdateMutationBody(
            subject=MutationSubject(title=BoundedDisplayText(text="Old Union")),
            changes=(
                MutationChange(
                    field_key=field_key,
                    operation="set",
                    after=MutationValue(kind="date", date="2026-11-01"),
                ),
            ),
        ),
    )


def _step(
    step_id: str, *, mutation: WorkspaceMutationReceipt | None = None, summary: str | None = None
) -> StepData:
    detail = StepDetail(mutation=mutation, summary=summary) if (mutation or summary) else None
    return StepData(
        step_id=step_id,
        status="end",
        kind="workspace",
        label="Update school",
        tier=None,
        detail=detail,
    )


class TestSelectEvidence:
    def test_bound_keeps_newest_first_within_budget(self) -> None:
        receipts = [_step("s1"), _step("s2"), _step("s3")]
        one_receipt_chars = len(goal_judge._receipt_text(receipts[0]))
        selected, dropped = select_evidence(
            receipts, always_keep_step_ids=(), max_chars=one_receipt_chars * 2
        )
        assert [r.step_id for r in selected] == ["s3", "s2"]
        assert dropped == 1

    def test_never_starves_a_criterion_of_previously_cited_evidence(self) -> None:
        """§3.3: evidence a prior verdict cited must survive even when the
        size bound would otherwise have aged it out as the bundle grows."""
        receipts = [_step("old-cited")] + [_step(f"filler-{i}") for i in range(20)]
        tiny_budget = len(goal_judge._receipt_text(receipts[0]))  # room for exactly one receipt
        selected, dropped = select_evidence(
            receipts, always_keep_step_ids={"old-cited"}, max_chars=tiny_budget
        )
        assert "old-cited" in {r.step_id for r in selected}
        assert dropped == len(receipts) - 1

    def test_empty_receipts_selects_nothing(self) -> None:
        selected, dropped = select_evidence([], always_keep_step_ids=(), max_chars=1000)
        assert selected == []
        assert dropped == 0


class TestUnknownStepIds:
    def test_flags_unknown_outcome_receipts(self) -> None:
        # "unknown" outcome requires an UnresolvedMutationBody per the receipt
        # contract; build that directly rather than reusing _update_receipt's
        # UpdateMutationBody (which forbids outcome="unknown").
        from domain.mutation_receipts import UnresolvedMutationBody

        unknown_receipt = WorkspaceMutationReceipt(
            family="school",
            action="update",
            outcome="unknown",
            body=UnresolvedMutationBody(family="school", verification="school_list"),
        )
        receipts = [
            _step("s1", mutation=_update_receipt("deadline")),
            _step("s2", mutation=unknown_receipt),
            _step("s3"),
        ]
        assert unknown_step_ids(receipts) == frozenset({"s2"})


class TestDeriveCriteria:
    async def test_happy_path_returns_criteria_and_note(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            return _tool_response(
                info.output_tools,
                criteria=[
                    {"id": "c1", "text": "Every school has a deadline."},
                    {"id": "c2", "text": "Every school has an application status."},
                ],
                not_checked_note="Application portals were not checked.",
            )

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        criteria, note = await goal_judge.derive_criteria(
            "get my school list in order", settings=_settings(), usage=RunUsage()
        )
        assert len(criteria) == 2
        assert criteria[0] == GoalCriterion(id="c1", text="Every school has a deadline.")
        assert criteria[1] == GoalCriterion(
            id="c2", text="Every school has an application status."
        )
        assert note == "Application portals were not checked."

    async def test_blank_note_after_strip_falls_back_to_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A whitespace-only note passes pydantic's ``min_length=1`` but must
        never render as a blank caveat (§3.2) — the code-owned default fills
        the gap instead."""

        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            return _tool_response(
                info.output_tools,
                criteria=[
                    {"id": "c1", "text": "Every school has a deadline."},
                    {"id": "c2", "text": "Every school has an application status."},
                ],
                not_checked_note=" ",
            )

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        _, note = await goal_judge.derive_criteria("goal", settings=_settings(), usage=RunUsage())
        assert note == goal_judge.DEFAULT_NOT_CHECKED_NOTE

    async def test_persistent_failure_raises_goal_criteria_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            raise RuntimeError("simulated transport failure")

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        with pytest.raises(GoalCriteriaError):
            await goal_judge.derive_criteria(
                "goal", settings=_settings(goal_judge_retries=0), usage=RunUsage()
            )


class TestJudgeGoal:
    async def test_judge_failure_after_retries_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            raise RuntimeError("simulated transport failure")

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        result = await judge_goal(
            statement="goal",
            criteria=(GoalCriterion(id="c1", text="x"),),
            receipts=[],
            final_text="",
            prior_cited_step_ids=(),
            settings=_settings(goal_judge_retries=0),
            usage=RunUsage(),
        )
        assert result is None

    async def test_unknown_outcome_citation_forces_met_false_despite_judge_claim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """End-to-end proof that the C9/C10 correction happens in code: the
        stubbed judge claims met=True citing only an 'unknown'-outcome
        receipt, and the returned verdict must still be met=False."""
        from domain.mutation_receipts import UnresolvedMutationBody

        unknown_receipt = WorkspaceMutationReceipt(
            family="school",
            action="update",
            outcome="unknown",
            body=UnresolvedMutationBody(family="school", verification="school_list"),
        )
        receipts = [_step("s1", mutation=unknown_receipt)]

        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            return _tool_response(
                info.output_tools,
                criteria=[
                    {
                        "criterion_id": "c1",
                        "met": True,
                        "reason": "looks done",
                        "evidence_step_ids": ["s1"],
                    }
                ],
                critique="all good",
            )

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        result = await judge_goal(
            statement="goal",
            criteria=(GoalCriterion(id="c1", text="x"),),
            receipts=receipts,
            final_text="Done!",
            prior_cited_step_ids=(),
            settings=_settings(),
            usage=RunUsage(),
        )
        assert result is not None
        verdict, checked_by_id = result
        assert verdict.criteria[0].met is False
        assert verdict.met is False
        assert checked_by_id["c1"] is True  # it WAS checked -- just proves nothing

    async def test_omitted_criterion_is_not_checked_and_not_met(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            return _tool_response(info.output_tools, criteria=[], critique="ran out of time")

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        result = await judge_goal(
            statement="goal",
            criteria=(GoalCriterion(id="c1", text="x"),),
            receipts=[],
            final_text="",
            prior_cited_step_ids=(),
            settings=_settings(),
            usage=RunUsage(),
        )
        assert result is not None
        verdict, checked_by_id = result
        # `verdict.criteria[0].met is None` is the honest "never assessed"
        # signal (C9) -- distinct from `False` ("assessed and not
        # satisfied"). `checked_by_id["c1"] is False` is the companion
        # "never attempted" signal that reaches the wire as
        # `GoalCriterionView.checked`. `app/goal_loop.py`'s wire builder
        # (`criterion_views`) and the frontend's `CriterionMark` both key
        # off `checked` first, so this `met=None` is never presented to a
        # student as "the judge checked this and it failed"
        # (plans/goal-mode-plan.md C9; frontend/.../GoalHeader.tsx).
        assert verdict.criteria[0].met is None
        assert checked_by_id["c1"] is False
        assert verdict.met is False

    async def test_genuinely_met_criterion_with_valid_citation_is_met(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        receipts = [_step("s1", mutation=_update_receipt("deadline"))]

        def model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
            return _tool_response(
                info.output_tools,
                criteria=[
                    {
                        "criterion_id": "c1",
                        "met": True,
                        "reason": "deadline set",
                        "evidence_step_ids": ["s1"],
                    }
                ],
                critique="done",
            )

        monkeypatch.setattr(
            goal_judge, "_vertex_model", lambda settings, model_setting: _stub_model(model_fn)
        )
        result = await judge_goal(
            statement="goal",
            criteria=(GoalCriterion(id="c1", text="x"),),
            receipts=receipts,
            final_text="Set the deadline.",
            prior_cited_step_ids=(),
            settings=_settings(),
            usage=RunUsage(),
        )
        assert result is not None
        verdict, checked_by_id = result
        assert verdict.criteria[0].met is True
        assert verdict.met is True
        assert checked_by_id["c1"] is True
