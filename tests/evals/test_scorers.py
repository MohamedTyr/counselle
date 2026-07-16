from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from domain.events import Event
from evals.runner import (
    EvalContext,
    EvalSchool,
    JudgeOutput,
    TurnCapture,
    _comparison_stats,
    _safe_event_summary,
    build_judge_case,
    capture_turn,
    materialize_questions,
    score_clarify,
    score_composition,
    score_deterministic,
    score_judge,
    score_question,
    score_routing,
)


def make_capture(**overrides: Any) -> TurnCapture:
    values: dict[str, Any] = {
        "events": [],
        "prose": "",
        "tool_calls": [],
        "tool_returns": [],
        "sources": [],
        "vizzes": [],
        "clarifies": [],
        "done_status": "complete",
        "errored": False,
        "errors": [],
        "usage": None,
    }
    values.update(overrides)
    return TurnCapture(**values)


def test_capture_turn_collects_v2_events_and_structural_messages() -> None:
    events = [
        Event(type="delta", data={"text": "Answer [1]."}),
        Event(type="viz", data={"v": 2, "type": "stat_block", "columns": []}),
        Event(type="sources", data={"sources": [{"index": 1, "label": "CDS"}]}),
        Event(type="usage", data={"input_tokens": 3, "output_tokens": 2}),
        Event(type="done", data={"status": "complete"}),
    ]
    messages = [
        {
            "parts": [
                {"part_kind": "tool-call", "tool_name": "get_domain", "args": {"unitid": 1}},
                {
                    "part_kind": "tool-return",
                    "tool_name": "get_domain",
                    "content": {"status": "ok"},
                },
            ]
        }
    ]
    capture = capture_turn(events, messages)
    assert capture.prose == "Answer [1]."
    assert capture.tool_calls == [{"tool_name": "get_domain", "args": {"unitid": 1}}]
    assert capture.vizzes[0]["v"] == 2
    assert capture.usage == {"input_tokens": 3, "output_tokens": 2}


def test_safe_summary_excludes_payload_values_and_excerpts() -> None:
    capture = make_capture(
        tool_calls=[{"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": "admissions"}}],
        tool_returns=[
            {
                "tool_name": "get_domain",
                "content": {
                    "status": "ok",
                    "secret_value": "do-not-log",
                    "excerpt": "also-secret",
                    "caveats": [{"kind": "stale_packet"}],
                },
            }
        ],
    )
    summary = _safe_event_summary(capture)
    assert "get_domain" in summary
    assert "stale_packet" in summary
    assert "do-not-log" not in summary
    assert "also-secret" not in summary


def test_routing_checks_order_and_dynamic_domain() -> None:
    capture = make_capture(
        tool_calls=[
            {"tool_name": "resolve_school", "args": {"query": "A"}},
            {"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": "dynamic"}},
        ]
    )
    checks = score_routing(
        {
            "tools": ["resolve_school", "get_domain"],
            "order": ["resolve_school", "get_domain"],
            "domain_role": "common",
            "domain_id": "dynamic",
        },
        capture,
    )
    assert all(item["passed"] for item in checks.values())


def test_composition_reads_v2_columns_and_inert_unavailable_cells() -> None:
    capture = make_capture(
        sources=[{"index": 1}],
        vizzes=[
            {
                "v": 2,
                "type": "comparison_table",
                "columns": [{"unitid": 1, "name": "DB"}, {"unitid": None, "name": "Web"}],
                "rows": [
                    {
                        "label": "Rate",
                        "cells": [
                            {"available": True, "citation": {"source": "cds", "tier": "official"}},
                            {"available": False, "citation": None},
                        ],
                    }
                ],
            }
        ],
    )
    checks = score_composition(
        {"viz_type": "comparison_table", "require_null_unitid": True, "require_unavailable": True},
        capture,
    )
    assert all(item["passed"] for item in checks.values())
    assert "cell_provenance_tier" in checks


def test_composition_flags_available_cell_missing_a_visible_tier() -> None:
    capture = make_capture(
        vizzes=[
            {
                "v": 2,
                "type": "stat_block",
                "columns": [{"unitid": 1, "name": "DB"}],
                "rows": [
                    {"label": "Rate", "cells": [{"available": True, "citation": {"source": "cds"}}]}
                ],
            }
        ],
    )
    checks = score_composition({}, capture)
    assert checks["cell_provenance_tier"]["passed"] is False


class FakeJudge:
    def __init__(self, verdicts: list[dict[str, str]]) -> None:
        self.verdicts = verdicts

    async def run(self, _case: str) -> Any:
        return SimpleNamespace(output=JudgeOutput.model_validate({"verdicts": self.verdicts}))


@pytest.mark.asyncio
async def test_judge_requires_exact_ordered_verdict_accounting() -> None:
    criteria = ["first", "second"]
    judge = FakeJudge(
        [
            {"criterion": "first", "verdict": "yes", "evidence": "a"},
            {"criterion": "second", "verdict": "no", "evidence": "b"},
        ]
    )
    checks = await score_judge("question", criteria, make_capture(), judge)
    assert list(checks) == ["criterion_1", "criterion_2"]
    assert checks["criterion_1"]["passed"] is True
    assert checks["criterion_2"]["passed"] is False


@pytest.mark.asyncio
async def test_judge_rejects_missing_extra_or_reordered_verdicts() -> None:
    with pytest.raises(ValueError, match="verdicts"):
        await score_judge("q", ["one"], make_capture(), FakeJudge([]))
    with pytest.raises(ValueError, match="mismatch"):
        await score_judge(
            "q",
            ["one"],
            make_capture(),
            FakeJudge([{"criterion": "different", "verdict": "yes", "evidence": "x"}]),
        )


@pytest.mark.asyncio
async def test_judge_accepts_semantically_identical_normalized_criterion() -> None:
    checks = await score_judge(
        "q",
        ["States covered-school numerator and total-school denominator."],
        make_capture(),
        FakeJudge(
            [
                {
                    "criterion": "states covered school numerator and total school denominator",
                    "verdict": "yes",
                    "evidence": "explicit denominator",
                }
            ]
        ),
    )
    assert checks["criterion_1"]["passed"] is True


def test_profile_identity_is_allowed_when_metric_uses_domain() -> None:
    checks = score_deterministic(
        {"no_profile_metric": True, "metric_required": True},
        make_capture(
            tool_calls=[
                {"tool_name": "get_school_profile", "args": {"unitid": 1}},
                {"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": "admissions"}},
            ]
        ),
    )
    assert checks["no_profile_as_metric"]["passed"] is True


def test_live_template_absence_requires_typed_row_evidence() -> None:
    expects = {
        "template_absence_live": True,
        "domain_id": "admissions",
        "metric_ref": "admissions.optional_row",
    }
    fabricated = score_deterministic(expects, make_capture(prose="It was absent."))
    evidenced = score_deterministic(
        expects,
        make_capture(
            tool_calls=[
                {"tool_name": "get_domain", "args": {"domain_id": "admissions", "unitid": 1}}
            ],
            tool_returns=[
                {
                    "tool_name": "get_domain",
                    "content": {
                        "rows": [
                            {
                                "ref": "admissions.optional_row",
                                "availability_status": "not_in_template_version",
                            }
                        ]
                    },
                }
            ],
        ),
    )
    assert fabricated["template_absence_live_evidence"]["passed"] is False
    assert evidenced["template_absence_live_evidence"]["passed"] is True


def test_v1_clarification_accepts_direct_prose_question() -> None:
    checks = score_clarify(
        {"must_clarify": True},
        make_capture(prose="Which Washington University or campus do you mean?"),
    )
    assert checks["clarify_judgment"]["passed"] is True


@pytest.mark.asyncio
async def test_every_case_gets_no_old_tools_assertion() -> None:
    question = {"type": "routing", "question": "q", "expects": {"tools": []}}
    checks = await score_question(
        question,
        make_capture(tool_calls=[{"tool_name": "get_values", "args": {}}]),
        None,
    )
    assert checks["no_old_tools"]["passed"] is False


def test_judge_case_contains_safe_summary_and_answer() -> None:
    case = build_judge_case("Question?", ["criterion"], make_capture(prose="Answer."))
    assert "## Student question" in case
    assert "Answer." in case
    assert "## Safe event summary" in case


def test_eval_context_materializes_live_roles_without_mutating_template() -> None:
    school = EvalSchool(1, "Live School", ("dynamic",), 2025, "current", 0)
    profile = EvalSchool(2, "Profile School", (), None, None, 0)
    context = EvalContext(
        "5.0.1",
        ("dynamic",),
        1,
        2,
        school,
        profile,
        school,
        school,
        "dynamic",
        "dynamic.metric",
        ("dynamic.metric", "dynamic.two", "dynamic.three", "dynamic.four"),
        False,
    )
    template: list[dict[str, Any]] = [
        {
            "id": "x",
            "type": "routing",
            "question": "Compare {common_a} over {covered} of {total}",
            "expects": {"domain_role": "common"},
            "live_not_in_template": True,
        }
    ]
    rendered = materialize_questions(template, context)
    assert rendered[0]["question"] == "Compare Live School over 1 of 2"
    assert rendered[0]["expects"]["domain_id"] == "dynamic"
    assert "skip_reason" in rendered[0]
    assert "domain_id" not in template[0]["expects"]


def test_comparison_stats_report_median_p95_and_max() -> None:
    results = [
        {
            "comparison": True,
            "skipped": False,
            "duration_s": duration,
            "usage": {"input_tokens": duration * 10, "output_tokens": duration},
            "tool_calls": [{}] * int(duration),
        }
        for duration in (1.0, 2.0, 10.0)
    ]
    stats = _comparison_stats(results)
    assert stats["duration_s"] == {"median": 2.0, "p95": 10.0, "max": 10.0}
    assert stats["tool_calls"]["max"] == 10.0
