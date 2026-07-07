from __future__ import annotations

from argparse import Namespace
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from domain.events import Event
from evals import runner
from evals.runner import (
    CriterionVerdict,
    JudgeOutput,
    TurnCapture,
    _event_summary,
    _extract_returns_blob,
    _extract_tool_calls,
    _fields_seen,
    _thread_messages,
    build_judge_agent,
    build_judge_case,
    build_report,
    capture_turn,
    load_questions,
    parse_args,
    render_markdown,
    run_question,
    run_question_safely,
    score_clarify,
    score_fact,
    score_field_selection,
    score_honesty,
    score_narration_quality,
    score_question,
    score_viz,
    select_questions,
    value_in_prose,
    write_reports,
)


def make_capture(
    *,
    events: list[Event] | None = None,
    prose: str = "",
    tool_calls: list[dict[str, Any]] | None = None,
    args_blob: str = "",
    returns_blob: str = "",
    sources: list[dict[str, Any]] | None = None,
    vizzes: list[dict[str, Any]] | None = None,
    clarifies: list[dict[str, Any]] | None = None,
    done_status: str | None = None,
    errored: bool = False,
) -> TurnCapture:
    return TurnCapture(
        events=events or [],
        prose=prose,
        tool_calls=tool_calls or [],
        args_blob=args_blob,
        returns_blob=returns_blob,
        sources=sources or [],
        vizzes=vizzes or [],
        clarifies=clarifies or [],
        done_status=done_status,
        errored=errored,
        usage=None,
    )


def narration(text: str) -> Event:
    return Event(type="narration", data={"text": text})


def step(step_id: str, status: str) -> Event:
    return Event(
        type="step",
        data={"step_id": step_id, "status": status, "kind": "db_tool", "label": "Read data"},
    )


def delta(text: str = "Final answer.") -> Event:
    return Event(type="delta", data={"text": text})


@pytest.mark.parametrize(
    ("value", "prose", "expected"),
    [
        ("5%", "the rate is 5%", True),
        ("16,000", "tuition is 16000 dollars", True),
        ("16000", "tuition is 16,000", True),
        ("Public", "it is public", True),
        ("Public", "this is public-facing guidance", False),
        ("aid", "said differently", False),
        ("aid", "financial aid data", True),
        ("5", "graduation rate is 35", False),
        ("5", "it is 50 percent", False),
        ("5", "the value 3.5 here", False),
        ("5", "the rate is 5.7%", False),
        ("5", "exactly 5 schools", True),
        ("-$2,610", "net price is negative $2,610", True),
        ("-2610", "the value is 9999", False),
        ("42", "no numbers here", False),
        ("7.4%", "admit rate 7.4% overall", True),
    ],
)
def test_value_in_prose_cases(value: str, prose: str, expected: bool) -> None:
    assert value_in_prose(value, prose) is expected


def test_fields_seen_checks_args_and_returns_in_order() -> None:
    capture = make_capture(args_blob='["b"]', returns_blob='{"a": true}')
    assert _fields_seen(["a", "b", "c"], capture) == ["a", "b"]


def test_extract_tool_calls_and_returns_blob_are_structural() -> None:
    raw_messages: list[dict[str, Any]] = [
        {
            "parts": [
                {"part_kind": "text", "content": "ignored"},
                {"part_kind": "tool-call", "tool_name": "get_values", "args": {"field": "x"}},
                {"part_kind": "tool-return", "content": {"field": "x", "value": 1}},
            ]
        },
        {"parts": None},
    ]
    assert _extract_tool_calls(raw_messages) == [
        {"tool_name": "get_values", "args": {"field": "x"}}
    ]
    assert '"field": "x"' in _extract_returns_blob(raw_messages)


def test_capture_turn_collects_events_and_registry_payloads() -> None:
    events = [
        Event(type="delta", data={"text": "Hello "}),
        Event(type="delta", data={"text": "world"}),
        Event(type="viz", data={"type": "comparison_table", "schools": []}),
        Event(type="clarify", data={"question": "Which campus?"}),
        Event(type="sources", data={"sources": [{"index": 1, "label": "IPEDS"}]}),
        Event(type="usage", data={"input_tokens": 1, "output_tokens": 2}),
        Event(type="done", data={"status": "awaiting_input"}),
        Event(type="error", data={"message": "boom"}),
    ]
    capture = capture_turn(
        events,
        [
            {
                "parts": [
                    {"part_kind": "tool-call", "tool_name": "compare_schools", "args": {"a": 1}},
                    {"part_kind": "tool-return", "content": {"b": 2}},
                ]
            }
        ],
    )
    assert capture.prose == "Hello world"
    assert capture.done_status == "awaiting_input"
    assert capture.errored is True
    assert capture.sources == [{"index": 1, "label": "IPEDS"}]
    assert capture.vizzes == [{"type": "comparison_table", "schools": []}]
    assert capture.usage == {"input_tokens": 1, "output_tokens": 2}


def test_event_summary_and_judge_case_include_evidence() -> None:
    capture = make_capture(
        prose="Answer.",
        sources=[
            {
                "index": 1,
                "label": "IPEDS",
                "citation": {"source": "ipeds", "tier": "official", "vintage": "IPEDS 2024"},
            }
        ],
        vizzes=[{"type": "comparison_table", "schools": [{"name": "Duke"}]}],
        clarifies=[{"question": "Which campus?"}],
        done_status="awaiting_input",
        errored=False,
    )
    summary = _event_summary(capture)
    assert "clarify question asked" in summary
    assert "visualization rendered" in summary
    assert "cited source [1]" in summary
    case = build_judge_case("Question?", ["criterion"], capture)
    assert "## Student question" in case
    assert "Answer." in case


def test_score_fact_happy_path() -> None:
    capture = make_capture(
        prose="The acceptance rate is 7%.",
        tool_calls=[{"tool_name": "get_values"}],
        args_blob='["admissions.acceptance_rate"]',
    )
    checks = score_fact(
        {
            "tools": ["get_values"],
            "fields": ["admissions.acceptance_rate"],
            "values": ["7%"],
        },
        capture,
    )
    assert {name: check["passed"] for name, check in checks.items()} == {
        "db_tool_called": True,
        "field_used": True,
        "value_in_prose": True,
    }


def test_score_fact_rejects_missing_tool_field_and_value() -> None:
    capture = make_capture(
        prose="No relevant value.",
        tool_calls=[{"tool_name": "search_fields"}],
        args_blob='["other.field"]',
    )
    checks = score_fact(
        {"fields": ["admissions.acceptance_rate"], "values": ["7%"]}, capture
    )
    assert checks["db_tool_called"]["passed"] is False
    assert checks["field_used"]["passed"] is False
    assert checks["value_in_prose"]["passed"] is False
    assert "admissions.acceptance_rate" in checks["field_used"]["detail"]


def test_score_fact_default_value_bearing_tools_include_compare() -> None:
    capture = make_capture(tool_calls=[{"tool_name": "compare_schools"}])
    assert score_fact({}, capture)["db_tool_called"]["passed"] is True


def test_score_field_selection_trap_checks_args_only() -> None:
    checks = score_field_selection(
        {"field_in": ["right"], "field_not": ["trap"]},
        make_capture(args_blob='["right"]', returns_blob='["trap"]'),
    )
    assert checks["right_field"]["passed"] is True
    assert checks["trap_field_avoided"]["passed"] is True


def test_score_field_selection_trap_requested_fails() -> None:
    checks = score_field_selection(
        {"field_in": ["right"], "field_not": ["trap"]},
        make_capture(args_blob='["right", "trap"]'),
    )
    assert checks["trap_field_avoided"]["passed"] is False


def test_score_field_selection_omits_trap_check_without_field_not() -> None:
    checks = score_field_selection({"field_in": ["right"]}, make_capture(args_blob='["right"]'))
    assert "trap_field_avoided" not in checks


def test_score_clarify_must_clarify_requires_awaiting_input() -> None:
    passing = score_clarify(
        {"must_clarify": True},
        make_capture(clarifies=[{"question": "Which campus?"}], done_status="awaiting_input"),
    )
    failing = score_clarify(
        {"must_clarify": True},
        make_capture(clarifies=[{"question": "Which campus?"}], done_status="complete"),
    )
    assert passing["clarify_fired"]["passed"] is True
    assert failing["clarify_fired"]["passed"] is False


def test_score_clarify_no_clarify_path() -> None:
    passing = score_clarify({"must_clarify": False}, make_capture(done_status="complete"))
    failing = score_clarify(
        {"must_clarify": False},
        make_capture(clarifies=[{"question": "Which campus?"}], done_status="complete"),
    )
    assert passing["no_clarify"]["passed"] is True
    assert failing["no_clarify"]["passed"] is False


def test_score_viz_accepts_matching_type_and_superset_unitids() -> None:
    capture = make_capture(
        vizzes=[
            {
                "type": "comparison_table",
                "schools": [
                    {"unitid": 100, "name": "A"},
                    {"unitid": 200, "name": "B"},
                    {"unitid": 300, "name": "C"},
                ],
            }
        ]
    )
    checks = score_viz({"viz_type": "comparison_table", "unitids": [100, 200]}, capture)
    assert checks["viz_rendered"]["passed"] is True


@pytest.mark.parametrize(
    "vizzes",
    [
        [{"type": "comparison_table", "schools": [{"unitid": 100, "name": "A"}]}],
        [{"type": "stat_block", "schools": [{"unitid": 100, "name": "A"}]}],
        [],
    ],
)
def test_score_viz_rejects_missing_school_wrong_type_or_no_viz(
    vizzes: list[dict[str, Any]],
) -> None:
    checks = score_viz(
        {"viz_type": "comparison_table", "unitids": [100, 200]}, make_capture(vizzes=vizzes)
    )
    assert checks["viz_rendered"]["passed"] is False


def test_score_narration_quality_passes_clean_tool_rounds() -> None:
    capture = make_capture(
        events=[
            narration("I'll look up the admissions data."),
            step("s1", "start"),
            step("s1", "end"),
            narration("I'll cross-check the source before answering."),
            step("s2", "start"),
            step("s2", "end"),
            delta("The acceptance rate is 5.7% [1]."),
        ]
    )
    checks = score_narration_quality({"values": ["5.7%"]}, capture)
    assert {name: check["passed"] for name, check in checks.items()} == {
        "tool_activity_completed": True,
        "tool_rounds_closed": True,
        "narration_present_for_tool_rounds": True,
        "concise_narration": True,
        "narration_has_no_citation_markers": True,
        "narration_has_no_tool_values": True,
        "no_answer_during_tool_work": True,
        "reacts_to_failures": True,
    }


def test_score_narration_quality_fails_missing_round_narration_and_early_delta() -> None:
    capture = make_capture(
        events=[
            narration("I'll start with the database."),
            step("s1", "start"),
            step("s1", "end"),
            delta("Here is a premature answer."),
            step("s2", "start"),
            step("s2", "end"),
        ]
    )
    checks = score_narration_quality({}, capture)
    assert checks["narration_present_for_tool_rounds"]["passed"] is False
    assert "2" in checks["narration_present_for_tool_rounds"]["detail"]
    assert checks["no_answer_during_tool_work"]["passed"] is False


def test_score_narration_quality_fails_long_cited_and_value_leaking_narration() -> None:
    capture = make_capture(
        events=[
            narration(
                "The answer is 5.7% [1]. It is selective. This is more final answer prose."
            ),
            step("s1", "start"),
            step("s1", "end"),
            delta(),
        ]
    )
    checks = score_narration_quality(
        {"values": ["5.7%"], "narration_forbidden_phrases": ["selective"]}, capture
    )
    assert checks["concise_narration"]["passed"] is False
    assert checks["narration_has_no_citation_markers"]["passed"] is False
    assert checks["narration_has_no_tool_values"]["passed"] is False
    assert "5.7%" in checks["narration_has_no_tool_values"]["detail"]
    assert "selective" in checks["narration_has_no_tool_values"]["detail"]


def test_score_narration_quality_fails_zero_step_trace_by_default() -> None:
    checks = score_narration_quality({}, make_capture(events=[delta()]))
    assert checks["tool_activity_completed"]["passed"] is False


def test_score_narration_quality_allows_zero_step_trace_when_tool_work_not_required() -> None:
    checks = score_narration_quality(
        {"requires_tool_work": False},
        make_capture(events=[delta("A direct general answer.")]),
    )
    assert checks["tool_activity_completed"]["passed"] is True


def test_score_narration_quality_fails_unclosed_step_and_open_step_delta() -> None:
    checks = score_narration_quality(
        {},
        make_capture(
            events=[
                narration("I'll check the database."),
                step("s1", "start"),
                delta("This answer came too early."),
            ]
        ),
    )
    assert checks["tool_rounds_closed"]["passed"] is False
    assert checks["no_answer_during_tool_work"]["passed"] is False


def test_score_narration_quality_reaction_required_passes_after_closed_tool_round() -> None:
    checks = score_narration_quality(
        {"reaction_required": True},
        make_capture(
            events=[
                narration("I'll check the CDS data."),
                step("s1", "start"),
                step("s1", "end"),
                narration("That source is thin, so I'll answer with that limitation."),
                delta(),
            ]
        ),
    )
    assert checks["reacts_after_tool_result"]["passed"] is True
    assert checks["reacts_to_failures"]["passed"] is True


def test_score_narration_quality_reaction_required_fails_when_missing() -> None:
    checks = score_narration_quality(
        {"reaction_required": True},
        make_capture(
            events=[
                narration("I'll check the CDS data."),
                step("s1", "start"),
                step("s1", "end"),
                delta(),
            ]
        ),
    )
    assert checks["reacts_after_tool_result"]["passed"] is False
    assert "none" in checks["reacts_after_tool_result"]["detail"]


def test_score_narration_quality_reaction_required_fails_after_next_step_start() -> None:
    checks = score_narration_quality(
        {"reaction_required": True},
        make_capture(
            events=[
                narration("I'll check the CDS data."),
                step("s1", "start"),
                step("s1", "end"),
                step("s2", "start"),
                narration("That source is thin, so I'll try another route."),
                step("s2", "end"),
                delta(),
            ]
        ),
    )
    assert checks["reacts_after_tool_result"]["passed"] is False


def test_score_narration_quality_reaction_required_does_not_require_error_event() -> None:
    checks = score_narration_quality(
        {"post_result_reaction_required": True},
        make_capture(
            events=[
                narration("I'll check the CDS data."),
                step("s1", "start"),
                step("s1", "end"),
                narration("The result is unavailable, so I'll say that directly."),
                delta(),
            ]
        ),
    )
    assert checks["reacts_after_tool_result"]["passed"] is True
    assert checks["reacts_to_failures"]["passed"] is True


def test_score_narration_quality_requires_failure_reaction_when_configured() -> None:
    passing = make_capture(
        events=[
            narration("I'll try the school-site search."),
            step("s1", "start"),
            step("s1", "error"),
            narration("That search failed, so I'll fall back to the database."),
            step("s2", "start"),
            step("s2", "end"),
            delta(),
        ]
    )
    failing = make_capture(
        events=[
            narration("I'll try the school-site search."),
            step("s1", "start"),
            step("s1", "error"),
            delta(),
        ]
    )
    late_reaction = make_capture(
        events=[
            narration("I'll try the school-site search."),
            step("s1", "start"),
            step("s1", "error"),
            step("s2", "start"),
            narration("That search failed, so I'll use the database now."),
            step("s2", "end"),
            delta(),
        ]
    )
    assert (
        score_narration_quality({"failure_reaction_required": True}, passing)[
            "reacts_to_failures"
        ]["passed"]
        is True
    )
    assert (
        score_narration_quality({"failure_reaction_required": True}, failing)[
            "reacts_to_failures"
        ]["passed"]
        is False
    )
    assert (
        score_narration_quality({"failure_reaction_required": True}, late_reaction)[
            "reacts_to_failures"
        ]["passed"]
        is False
    )


def test_score_narration_quality_failure_reaction_is_neutral_without_failure() -> None:
    checks = score_narration_quality(
        {"failure_reaction_required": True},
        make_capture(
            events=[narration("I'll look this up."), step("s1", "start"), step("s1", "end")]
        ),
    )
    assert checks["reacts_to_failures"]["passed"] is True
    assert "not applicable" in checks["reacts_to_failures"]["detail"]


def test_score_narration_quality_failure_required_fails_without_failure() -> None:
    checks = score_narration_quality(
        {"failure_reaction_required": True, "failure_required": True},
        make_capture(
            events=[narration("I'll look this up."), step("s1", "start"), step("s1", "end")]
        ),
    )
    assert checks["reacts_to_failures"]["passed"] is False
    assert "failure_required" in checks["reacts_to_failures"]["detail"]


def test_score_narration_quality_forbidden_text_matching_is_boundary_aware() -> None:
    clean = score_narration_quality(
        {
            "narration_forbidden_values": ["Public"],
            "narration_forbidden_phrases": ["aid"],
        },
        make_capture(
            events=[
                narration("I'll review public-facing context; said differently, I'll verify."),
                step("s1", "start"),
                step("s1", "end"),
            ]
        ),
    )
    dirty = score_narration_quality(
        {
            "narration_forbidden_values": ["Public"],
            "narration_forbidden_phrases": ["aid"],
        },
        make_capture(
            events=[
                narration("I'll check whether this is a public school with aid data."),
                step("s1", "start"),
                step("s1", "end"),
            ]
        ),
    )

    assert clean["narration_has_no_tool_values"]["passed"] is True
    assert dirty["narration_has_no_tool_values"]["passed"] is False


class FakeJudge:
    async def run(self, _message: str) -> SimpleNamespace:
        return SimpleNamespace(
            output=JudgeOutput(
                verdicts=[
                    CriterionVerdict(criterion="one", verdict="yes", evidence="met"),
                    CriterionVerdict(criterion="two", verdict="no", evidence="missed"),
                ]
            )
        )


async def test_score_honesty_maps_judge_verdicts_and_missing_verdicts() -> None:
    checks = await score_honesty(
        "Question?",
        {"criteria": ["one", "two", "three"]},
        make_capture(prose="Answer."),
        FakeJudge(),
    )
    assert checks["criterion_1"]["passed"] is True
    assert checks["criterion_2"]["passed"] is False
    assert checks["criterion_3"]["passed"] is False
    assert "no verdict" in checks["criterion_3"]["detail"]


async def test_score_honesty_requires_judge_agent() -> None:
    with pytest.raises(RuntimeError, match="judge"):
        await score_honesty("Question?", {"criteria": ["one"]}, make_capture(), None)


@pytest.mark.parametrize(
    ("question", "capture", "expected_check"),
    [
        (
            {
                "id": "f",
                "type": "fact",
                "question": "Q",
                "expects": {"fields": ["x"], "values": ["1"]},
            },
            make_capture(prose="1", tool_calls=[{"tool_name": "get_values"}], args_blob='["x"]'),
            "db_tool_called",
        ),
        (
            {
                "id": "fs",
                "type": "field-selection",
                "question": "Q",
                "expects": {"field_in": ["x"]},
            },
            make_capture(args_blob='["x"]'),
            "right_field",
        ),
        (
            {
                "id": "c",
                "type": "clarify-judgment",
                "question": "Q",
                "expects": {"must_clarify": False},
            },
            make_capture(done_status="complete"),
            "no_clarify",
        ),
        (
            {
                "id": "v",
                "type": "comparison-viz",
                "question": "Q",
                "expects": {"viz_type": "comparison_table", "unitids": [1]},
            },
            make_capture(vizzes=[{"type": "comparison_table", "schools": [{"unitid": 1}]}]),
            "viz_rendered",
        ),
        (
            {
                "id": "n",
                "type": "narration-quality",
                "question": "Q",
                "expects": {},
            },
            make_capture(
                events=[narration("I'll look this up."), step("s1", "start"), step("s1", "end")]
            ),
            "narration_present_for_tool_rounds",
        ),
    ],
)
async def test_score_question_dispatches_mechanical_types(
    question: dict[str, Any], capture: TurnCapture, expected_check: str
) -> None:
    checks = await score_question(question, capture, judge_agent=None)
    assert checks[expected_check]["passed"] is True
    assert checks["no_error_event"]["passed"] is True


async def test_score_question_rejects_unknown_type() -> None:
    with pytest.raises(ValueError, match="unknown question type"):
        await score_question(
            {"type": "other", "expects": {}, "question": "Q"}, make_capture(), None
        )


async def test_score_question_dispatches_honesty() -> None:
    checks = await score_question(
        {
            "id": "h",
            "type": "honesty",
            "question": "Q",
            "expects": {"criteria": ["one"]},
        },
        make_capture(prose="Answer."),
        FakeJudge(),
    )
    assert checks["criterion_1"]["passed"] is True
    assert checks["no_error_event"]["passed"] is True


async def test_thread_messages_handles_empty_and_populated_snapshots() -> None:
    class Graph:
        def __init__(self, snapshot: object | None) -> None:
            self.snapshot = snapshot

        async def aget_state(self, _config: dict[str, object]) -> object | None:
            return self.snapshot

    runtime: Any = SimpleNamespace(graph=Graph(None))
    assert await _thread_messages(runtime, "s1") == []
    snapshot = SimpleNamespace(values={"messages": [{"parts": []}]})
    runtime = SimpleNamespace(graph=Graph(snapshot))
    assert await _thread_messages(runtime, "s1") == [{"parts": []}]


async def test_run_question_assembles_result_from_faked_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create_session(
        _pool: object, source_config: dict[str, object], title: str
    ) -> str:
        assert source_config == {
            "web": True,
            "reddit": False,
            "reddit_subreddits": None,
            "edu": True,
        }
        assert title == "eval:q1"
        return "session-1"

    async def fake_run_turn(*_args: object, **_kwargs: object) -> AsyncIterator[Event]:
        yield Event(type="delta", data={"text": "Value is 1."})
        yield Event(type="done", data={"status": "complete"})

    async def fake_thread_messages(_runtime: object, session_id: str) -> list[dict[str, Any]]:
        assert session_id == "session-1"
        return [{"parts": [{"part_kind": "tool-call", "tool_name": "get_values", "args": ["x"]}]}]

    monkeypatch.setattr(runner, "create_session", fake_create_session)
    monkeypatch.setattr(runner, "run_turn", fake_run_turn)
    monkeypatch.setattr(runner, "_thread_messages", fake_thread_messages)
    runtime: Any = SimpleNamespace(app_pool=object(), deps=object(), graph=object())

    result = await run_question(
        runtime,
        None,
        {
            "id": "q1",
            "type": "fact",
            "question": "Q",
            "web": True,
            "expects": {"fields": ["x"], "values": ["1"]},
        },
    )

    assert result["session_id"] == "session-1"
    assert result["passed"] is True
    assert result["prose"] == "Value is 1."
    assert result["done_status"] == "complete"


async def test_run_question_safely_converts_crash_to_failed_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_run_question(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "run_question", fake_run_question)

    runtime: Any = SimpleNamespace()
    result = await run_question_safely(
        runtime,
        None,
        {"id": "q1", "type": "fact", "question": "Q", "web": True},
    )

    assert result["passed"] is False
    assert "RuntimeError: boom" in result["checks"]["runner"]["detail"]


def test_build_report_groups_per_type_and_omits_empty_types() -> None:
    results = [
        {"id": "f1", "type": "fact", "passed": True, "checks": {}},
        {"id": "f2", "type": "fact", "passed": True, "checks": {}},
        {"id": "f3", "type": "fact", "passed": False, "checks": {}},
        {"id": "h1", "type": "honesty", "passed": True, "checks": {}},
        {"id": "n1", "type": "narration-quality", "passed": False, "checks": {}},
    ]
    report = build_report(results, "model-x")
    assert report["total"] == 5
    assert report["passed"] == 3
    assert report["per_type"]["fact"] == {"passed": 2, "total": 3, "accuracy": 0.667}
    assert report["per_type"]["honesty"]["accuracy"] == 1.0
    assert report["per_type"]["narration-quality"]["accuracy"] == 0.0
    assert "comparison-viz" not in report["per_type"]
    assert report["model"] == "model-x"
    datetime.fromisoformat(report["generated_at"])


def test_build_report_empty_results() -> None:
    report = build_report([], "model-x")
    assert report["total"] == 0
    assert report["passed"] == 0
    assert report["per_type"] == {}


def test_render_markdown_includes_summary_and_failed_checks() -> None:
    report = build_report(
        [
            {"id": "pass-id", "type": "fact", "passed": True, "checks": {"a": {"passed": True}}},
            {
                "id": "fail-id",
                "type": "fact",
                "passed": False,
                "checks": {"bad_check": {"passed": False}},
            },
        ],
        "model-x",
    )
    markdown = render_markdown(report)
    assert f"# Eval report — {report['generated_at'][:10]}" in markdown
    assert "Model: `model-x`" in markdown
    assert "## Per-type accuracy" in markdown
    assert "| pass-id | fact | PASS | — |" in markdown
    assert "| fail-id | fact | FAIL | bad_check |" in markdown


def test_select_questions_filters_and_rejects_unknown_ids() -> None:
    questions = [
        {"id": "a", "type": "fact"},
        {"id": "b", "type": "honesty"},
        {"id": "c", "type": "fact"},
    ]
    assert [item["id"] for item in select_questions(questions, None, "fact")] == ["a", "c"]
    assert [item["id"] for item in select_questions(questions, ["a,c"], None)] == ["a", "c"]
    with pytest.raises(SystemExit, match="unknown question id"):
        select_questions(questions, ["missing"], None)


def test_load_questions_validates_shape_and_duplicates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    valid = tmp_path / "valid.yaml"
    valid.write_text(
        """
- id: a
  type: narration-quality
  question: Q
  expects: {}
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "QUESTIONS_PATH", valid)
    assert load_questions()[0]["id"] == "a"

    invalid = tmp_path / "invalid.yaml"
    invalid.write_text("- id: a\n  type: nope\n  question: Q\n  expects: {}\n", encoding="utf-8")
    monkeypatch.setattr(runner, "QUESTIONS_PATH", invalid)
    with pytest.raises(ValueError, match="unknown type"):
        load_questions()

    duplicate = tmp_path / "duplicate.yaml"
    duplicate.write_text(
        """
- id: a
  type: fact
  question: Q
  expects: {}
- id: a
  type: fact
  question: Q2
  expects: {}
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "QUESTIONS_PATH", duplicate)
    with pytest.raises(ValueError, match="duplicate"):
        load_questions()


def test_parse_args_supports_only_and_type_filters() -> None:
    args = parse_args(["--only", "a,b", "--type", "narration-quality"])
    assert args.only == ["a,b"]
    assert args.question_type == "narration-quality"


def test_write_reports_writes_json_and_markdown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report = build_report(
        [{"id": "pass-id", "type": "fact", "passed": True, "checks": {}}],
        "model-x",
    )
    monkeypatch.setattr("evals.runner.EVALS_DIR", tmp_path)

    write_reports(report)

    stamp = report["generated_at"][:10]
    assert (tmp_path / f"report-{stamp}.json").exists()
    assert (tmp_path / f"report-{stamp}.md").read_text(encoding="utf-8").startswith(
        "# Eval report"
    )


def test_build_judge_agent_rejects_missing_api_key() -> None:
    with pytest.raises(RuntimeError, match="COUNSELLE_VERTEX_API_KEY"):
        build_judge_agent(SimpleNamespace(vertex_api_key=None, model_cheap="gemini-2.5-flash"))


async def test_amain_runs_selected_questions_and_writes_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Runtime:
        app_pool = object()
        deps = object()
        graph = object()

        def __init__(self) -> None:
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

    runtime = Runtime()
    written: list[dict[str, Any]] = []

    async def fake_build_runtime(_settings: object) -> Runtime:
        return runtime

    async def fake_run_question_safely(
        _runtime: object, _judge_agent: object, question: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "id": question["id"],
            "type": question["type"],
            "question": question["question"],
            "passed": True,
            "checks": {},
            "duration_s": 0.1,
        }

    monkeypatch.setattr(
        runner,
        "get_settings",
        lambda: SimpleNamespace(log_level="INFO", model_counselor="model-x"),
    )
    monkeypatch.setattr(runner, "setup_logging", lambda _level: None)
    monkeypatch.setattr(
        runner,
        "load_questions",
        lambda: [{"id": "a", "type": "fact", "question": "Q", "expects": {}}],
    )
    monkeypatch.setattr(runner, "build_runtime", fake_build_runtime)
    monkeypatch.setattr(runner, "run_question_safely", fake_run_question_safely)
    monkeypatch.setattr(runner, "write_reports", lambda report: written.append(report))

    assert await runner.amain(Namespace(only=None, question_type=None)) == 0
    assert runtime.closed is True
    assert written[0]["passed"] == 1
