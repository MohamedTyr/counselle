from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

import pytest

import evals.runner as runner
from domain.events import Event
from domain.response_mode import ResponseMode
from evals.runner import (
    EvalContext,
    EvalSchool,
    JudgeOutput,
    TurnCapture,
    _comparison_stats,
    _report_stem,
    _require_metric_ref,
    _safe_event_summary,
    build_judge_case,
    build_report,
    capture_turn,
    load_questions,
    materialize_questions,
    parse_args,
    run_question,
    score_clarify,
    score_composition,
    score_deterministic,
    score_judge,
    score_narration,
    score_question,
    score_routing,
    score_workspace,
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


def make_query_capture(prose: str, *payloads: dict[str, Any]) -> TurnCapture:
    return make_capture(
        prose=prose,
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": f"SELECT {index}"}}
            for index, _payload in enumerate(payloads, 1)
        ],
        tool_returns=[
            {"tool_name": "query_database", "content": payload} for payload in payloads
        ],
    )


def make_context() -> EvalContext:
    school = EvalSchool(
        unitid=1,
        name="Example University",
        domains=("admissions",),
        year=2026,
        currentness="current",
        partials=0,
    )
    return EvalContext(
        manifest_version="test",
        domains=("admissions",),
        covered=1,
        total=1,
        stale_partial=school,
        profile_only=school,
        common_a=school,
        common_b=school,
        comparison_peer=school,
        common_domain="admissions",
        common_metric_ref="admissions.applicants_total",
        stat_metric_refs=("admissions.applicants_total",) * 4,
        aid_metric_ref="financial_aid.need_met",
        selectivity_applicants_ref="admissions.applicants_total",
        selectivity_admitted_ref="admissions.admitted_total",
        need_blind_ref=None,
        not_in_template_available=False,
    )


_SELECTED_DOCUMENT_SQL = """WITH selected AS (
  SELECT DISTINCT ON (school_id) school_id, document_id
  FROM cds_library.active_cds_documents
  ORDER BY school_id, academic_year DESC, document_id DESC
), candidates AS (
  SELECT d.school_id
  FROM cds_library.active_cds_domain_packets d
  INNER JOIN selected s ON s.school_id=d.school_id AND s.document_id=d.document_id
)
SELECT school_id FROM candidates"""


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


def test_parse_args_defaults_to_quick_and_supports_compare() -> None:
    default = parse_args([])
    assert default.response_mode == "quick"
    assert default.compare_response_modes is False

    compare = parse_args(["--compare-response-modes", "--response-mode", "think"])
    assert compare.response_mode == "think"
    assert compare.compare_response_modes is True


def test_report_records_response_mode_and_uses_mode_suffix() -> None:
    report = build_report(
        [
            {
                "id": "q1",
                "type": "routing",
                "skipped": False,
                "passed": True,
                "checks": {},
                "comparison": False,
                "response_mode": "think",
            }
        ],
        ResponseMode.THINK,
        "google-vertex:gemini-3.1-pro-preview",
        make_context(),
    )
    assert report["response_mode"] == "think"
    assert report["model"] == "google-vertex:gemini-3.1-pro-preview"
    dated = {**report, "generated_at": "2026-07-22T00:00:00+00:00"}
    assert _report_stem(dated) == "report-2026-07-22"
    assert _report_stem(dated, suffix_mode=True) == "report-2026-07-22-think"


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


class SequenceJudge:
    def __init__(self, outputs: list[list[dict[str, str]]]) -> None:
        self.outputs = outputs
        self.cases: list[str] = []

    async def run(self, case: str) -> Any:
        self.cases.append(case)
        verdicts = self.outputs[len(self.cases) - 1]
        return SimpleNamespace(output=JudgeOutput.model_validate({"verdicts": verdicts}))


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
async def test_judge_retries_bad_cardinality_once_and_revalidates() -> None:
    judge = SequenceJudge(
        [
            [{"criterion": "one", "verdict": "yes", "evidence": "a"}],
            [
                {"criterion": "one", "verdict": "yes", "evidence": "a"},
                {"criterion": "two", "verdict": "yes", "evidence": "b"},
            ],
        ]
    )
    checks = await score_judge("q", ["one", "two"], make_capture(), judge)
    assert all(check["passed"] for check in checks.values())
    assert len(judge.cases) == 2
    assert "Return exactly 2 verdicts" in judge.cases[1]


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


@pytest.mark.asyncio
async def test_judge_accepts_close_paraphrase() -> None:
    checks = await score_judge(
        "q",
        ["Clearly says first-party CDS metric coverage is unavailable for this school."],
        make_capture(),
        FakeJudge(
            [
                {
                    "criterion": (
                        "Says this school has no available first party CDS metric coverage"
                    ),
                    "verdict": "yes",
                    "evidence": "said so",
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


def test_query_database_requires_db_recipes_first_when_requested() -> None:
    expects = {"load_skill_before_sql": True}
    ordered = make_capture(
        tool_calls=[
            {"tool_name": "load_skill", "args": {"name": "db-recipes"}},
            {"tool_name": "query_database", "args": {}},
        ]
    )
    reversed_calls = make_capture(tool_calls=list(reversed(ordered.tool_calls)))
    assert score_deterministic(expects, ordered)["load_skill_before_sql"]["passed"] is True
    assert (
        score_deterministic(expects, reversed_calls)["load_skill_before_sql"]["passed"] is False
    )


def test_candidate_ranking_requires_selected_document_sql_and_typed_refetch() -> None:
    expects = {
        "selected_document_sql": True,
        "typed_refetch": True,
        "typed_refetch_domain_id": "admissions",
        "typed_refetch_refs": ["admissions.applicants", "admissions.admitted"],
    }
    capture = make_capture(
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": _SELECTED_DOCUMENT_SQL}},
            {"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": "admissions"}},
        ],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {"status": "ok", "columns": ["school_id"], "rows": [[1]]},
            },
            {
                "tool_name": "get_domain",
                "content": {
                    "status": "ok",
                    "domain_id": "admissions",
                    "school": {"unitid": 1},
                    "rows": [
                        {"field": "admissions.applicants", "available": True, "display": "10"},
                        {"field": "admissions.admitted", "available": True, "display": "2"},
                    ],
                },
            },
        ],
    )
    checks = score_deterministic(expects, capture)
    assert checks["selected_document_sql"]["passed"] is True
    assert checks["typed_refetch"]["passed"] is True


@pytest.mark.parametrize(
    ("domain_id", "rows"),
    [
        ("admissions", []),
        (
            "cost",
            [
                {"field": "admissions.applicants", "available": True, "display": "10"},
                {"field": "admissions.admitted", "available": True, "display": "2"},
            ],
        ),
        (
            "admissions",
            [{"field": "admissions.applicants", "available": True, "display": "10"}],
        ),
        (
            "admissions",
            [
                {"field": "admissions.applicants", "available": True, "display": "10"},
                {"field": "admissions.admitted", "available": False, "display": "not available"},
            ],
        ),
    ],
)
def test_typed_refetch_rejects_empty_unrelated_or_incomplete_domain_values(
    domain_id: str, rows: list[dict[str, Any]]
) -> None:
    capture = make_capture(
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": _SELECTED_DOCUMENT_SQL}},
            {"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": domain_id}},
        ],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {"status": "ok", "columns": ["school_id"], "rows": [[1]]},
            },
            {
                "tool_name": "get_domain",
                "content": {
                    "status": "ok",
                    "domain_id": domain_id,
                    "school": {"unitid": 1},
                    "rows": rows,
                },
            },
        ],
    )

    check = score_deterministic(
        {
            "typed_refetch": True,
            "typed_refetch_domain_id": "admissions",
            "typed_refetch_refs": ["admissions.applicants", "admissions.admitted"],
        },
        capture,
    )["typed_refetch"]

    assert check["passed"] is False


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT document_id FROM cds_library.active_cds_documents",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           JOIN selected s ON s.school_id=d.school_id""",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             WHERE academic_year < 2024
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           JOIN selected s ON s.school_id=d.school_id AND s.document_id=d.document_id""",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           LEFT JOIN selected s
             ON s.school_id=d.school_id AND s.document_id=d.document_id""",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id,
                    (SELECT count(*) FROM cds_library.active_cds_documents) AS decoy
             FROM cds_library.active_cds_domain_packets
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           JOIN selected s
             ON s.school_id=d.school_id AND s.document_id=d.document_id""",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) 1 AS school_id, 2 AS document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           JOIN selected s
             ON s.school_id=d.school_id AND s.document_id=d.document_id""",
        """WITH selected AS (
             SELECT DISTINCT ON (school_id) school_id, document_id
             FROM cds_library.active_cds_documents
             ORDER BY school_id, academic_year DESC, document_id DESC
           )
           SELECT d.school_id FROM cds_library.active_cds_domain_packets d
           JOIN selected s
             ON s.school_id=d.school_id OR s.document_id=d.document_id""",
    ],
)
def test_selected_document_sql_rejects_nonselecting_or_inexact_join(sql: str) -> None:
    capture = make_capture(
        tool_calls=[{"tool_name": "query_database", "args": {"sql": sql}}],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {"status": "ok", "columns": ["school_id"], "rows": [[1]]},
            }
        ],
    )
    assert (
        score_deterministic({"selected_document_sql": True}, capture)[
            "selected_document_sql"
        ]["passed"]
        is False
    )


def test_typed_refetch_requires_success_for_every_candidate() -> None:
    capture = make_capture(
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": _SELECTED_DOCUMENT_SQL}},
            {"tool_name": "get_domain", "args": {"unitid": 1, "domain_id": "admissions"}},
            {"tool_name": "get_domain", "args": {"unitid": 2, "domain_id": "admissions"}},
        ],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {"status": "ok", "columns": ["school_id"], "rows": [[1], [2]]},
            },
            {
                "tool_name": "get_domain",
                "content": {
                    "status": "ok",
                    "domain_id": "admissions",
                    "school": {"unitid": 1},
                    "rows": [
                        {"field": "admissions.applicants", "available": True, "display": "10"},
                        {"field": "admissions.admitted", "available": True, "display": "2"},
                    ],
                },
            },
            {"tool_name": "get_domain", "content": {"status": "tool_error"}},
        ],
    )
    assert score_deterministic(
        {
            "typed_refetch": True,
            "typed_refetch_domain_id": "admissions",
            "typed_refetch_refs": ["admissions.applicants", "admissions.admitted"],
        },
        capture,
    )["typed_refetch"]["passed"] is False


def test_selected_document_sql_requires_latest_successful_query() -> None:
    broad_sql = "SELECT school_id FROM cds_library.active_cds_domain_packets"
    capture = make_capture(
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": _SELECTED_DOCUMENT_SQL}},
            {"tool_name": "query_database", "args": {"sql": broad_sql}},
        ],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {"status": "tool_error", "root_cause": "safe"},
            },
            {
                "tool_name": "query_database",
                "content": {"status": "ok", "columns": [], "rows": []},
            },
        ],
    )
    check = score_deterministic({"selected_document_sql": True}, capture)[
        "selected_document_sql"
    ]
    assert check["passed"] is False


def test_denominator_requires_query_evidence_and_exact_prose_pair() -> None:
    expects = {"denominator": True, "denominator_total": 2746}
    payload = {
        "columns": ["name", "covered", "total"],
        "rows": [["School", 2, 2746]],
    }
    evidenced = make_query_capture("The ranking covers 2 out of 2,746 profiled schools.", payload)
    fabricated = make_capture(prose="The ranking covers 2 out of 2,746 profiled schools.")
    wrong = make_query_capture("The ranking covers 3 out of 2,746 profiled schools.", payload)
    assert score_deterministic(expects, evidenced)["denominator"]["passed"] is True
    assert score_deterministic(expects, fabricated)["denominator"]["passed"] is False
    assert score_deterministic(expects, wrong)["denominator"]["passed"] is False
    reverse = make_query_capture(
        "Of the 2,746 profiled schools, 2 have a verified value.", payload
    )
    assert score_deterministic(expects, reverse)["denominator"]["passed"] is True
    reverse_unrelated = make_query_capture(
        "Out of 2,746 profiled schools, we pulled examples for 12 counselor notes, "
        "and 2 have this metric.",
        payload,
    )
    assert score_deterministic(expects, reverse_unrelated)["denominator"]["passed"] is False
    reverse_examples = make_query_capture(
        "Out of 2,746 profiled institutions, there are 3 examples with verified "
        "numeric data for the metric.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, reverse_examples)["denominator"]["passed"] is False
    reverse_bare_count = make_query_capture(
        "Out of 2,746 profiled institutions, there are 3.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, reverse_bare_count)["denominator"]["passed"] is False
    reverse_qualified_school_noun = make_query_capture(
        "Out of 2,746 profiled institutions, there are 3 covered schools with "
        "verified numeric data for the metric.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert (
        score_deterministic(expects, reverse_qualified_school_noun)["denominator"]["passed"]
        is True
    )
    noun_between = make_query_capture("Two schools out of 2,746 have the exact metric.", payload)
    assert score_deterministic(expects, noun_between)["denominator"]["passed"] is True
    markdown_emphasis = make_query_capture(
        "Our database contains **3** covered schools with verified values for this exact "
        "metric out of **2,746** total profiled institutions.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, markdown_emphasis)["denominator"]["passed"] is True
    live_routing_phrase = make_query_capture(
        "A total of 3 schools are covered with verified, reported numeric data for the "
        "metric, out of 2,746 profiled institutions.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, live_routing_phrase)["denominator"]["passed"] is True
    unrelated_out_of = make_query_capture(
        "We found 3 schools with this metric, and pulled examples out of 2,746 total "
        "profiled institutions.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, unrelated_out_of)["denominator"]["passed"] is False
    split_reporting_phrase = make_query_capture(
        "There are 3 schools with verified numeric data. I pulled examples out of "
        "2,746 profiled institutions.",
        {"columns": ["covered", "total"], "rows": [[3, 2746]]},
    )
    assert score_deterministic(expects, split_reporting_phrase)["denominator"]["passed"] is False
    aliases_and_word = make_query_capture(
        "Of the 2,746 profiled schools, two have a verified value.",
        {"columns": ["covered_schools", "total_schools"], "rows": [[2, 2746]]},
    )
    assert score_deterministic(expects, aliases_and_word)["denominator"]["passed"] is True

    wrapped_success = make_capture(
        prose="Harvard ranks first among the 1 out of 2746 schools with data.",
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {
                    "status": "overflow",
                    "result_for_agent": {"handle": "tool-result-1"},
                },
            },
            {
                "tool_name": "read_tool_result",
                "content": {"columns": ["covered", "total"], "rows": [[1, 2746]]},
            },
        ],
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": "SELECT 1"}},
            {"tool_name": "read_tool_result", "args": {"handle": "tool-result-1"}},
        ],
    )
    assert score_deterministic(expects, wrapped_success)["denominator"]["passed"] is True
    wrapped_mismatch = make_capture(
        prose="Harvard ranks first among the 1 out of 2,746 schools with data.",
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {
                    "status": "overflow",
                    "result_for_agent": {"handle": "tool-result-2"},
                },
            },
            {
                "tool_name": "read_tool_result",
                "content": {"columns": ["covered", "total"], "rows": [[2, 2746]]},
            },
        ],
        tool_calls=[
            {"tool_name": "query_database", "args": {"sql": "SELECT 1"}},
            {"tool_name": "read_tool_result", "args": {"handle": "tool-result-2"}},
        ],
    )
    assert score_deterministic(expects, wrapped_mismatch)["denominator"]["passed"] is False

    metric_total_columns = make_query_capture(
        "Out of 2,746 schools, only 1 has both metrics.",
        {
            "columns": ["admitted_total", "applicants_total", "covered", "total"],
            "rows": [[2003, 47893, 1, 2746]],
        },
    )
    assert score_deterministic(expects, metric_total_columns)["denominator"]["passed"] is True

    derived_total = make_query_capture(
        "Out of 2,746 profiled schools, only one has both required values.",
        {"columns": ["count"], "rows": [[1]]},
    )
    assert score_deterministic(expects, derived_total)["denominator"]["passed"] is False
    aliased_count = make_query_capture(
        "Out of 2,746 schools, 1 is eligible for this ranking.",
        {
            "columns": ["eligible_school_count", "profile_total"],
            "rows": [[1, 2746]],
        },
    )
    assert score_deterministic(expects, aliased_count)["denominator"]["passed"] is True

    corrected = make_query_capture(
        "Of 2,746 schools, 1 has both required values.",
        {"columns": ["covered", "total"], "rows": [[4, 2746]]},
        {"columns": ["covered", "total"], "rows": [[1, 2746]]},
    )
    assert score_deterministic(expects, corrected)["denominator"]["passed"] is True

    circular = make_query_capture(
        "The ranking covers 999 out of 2,746 profiled schools.",
        {"status": "ok", "columns": ["name"], "rows": [["School"]]},
    )
    assert score_deterministic(expects, circular)["denominator"]["passed"] is False

    unread_overflow = make_capture(
        prose="The ranking covers 1 out of 2,746 profiled schools.",
        tool_calls=[{"tool_name": "query_database", "args": {"sql": "SELECT 1"}}],
        tool_returns=[
            {
                "tool_name": "query_database",
                "content": {
                    "status": "overflow",
                    "result_for_agent": {"handle": "tool-result-1"},
                },
            }
        ],
    )
    assert score_deterministic(expects, unread_overflow)["denominator"]["passed"] is False

    zero_expects = {
        "denominator": True,
        "denominator_total": 2746,
        "denominator_covered": 0,
    }
    unsupported = make_capture(prose="0 out of 2,746 schools can be evaluated.")
    evidenced_zero = make_query_capture(
        "0 out of 2,746 schools can be evaluated.",
        {
            "columns": ["metric_ref_present", "total"],
            "rows": [[False, 2746]],
        },
    )
    assert score_deterministic(zero_expects, unsupported)["denominator"]["passed"] is False
    assert score_deterministic(zero_expects, evidenced_zero)["denominator"]["passed"] is True
    evidenced_zero_markdown = make_query_capture(
        "The covered count of schools that can be evaluated is **0** out of **2,746**.",
        {"columns": ["metric_ref_present", "total"], "rows": [[False, 2746]]},
    )
    assert (
        score_deterministic(zero_expects, evidenced_zero_markdown)["denominator"]["passed"]
        is True
    )

    evidenced_zero_reverse = make_query_capture(
        "Out of 2,746 schools, 0 can be evaluated.",
        {"columns": ["covered", "total"], "rows": [[0, 2746]]},
    )
    assert (
        score_deterministic(zero_expects, evidenced_zero_reverse)["denominator"]["passed"]
        is True
    )
    mismatched_zero = make_query_capture(
        "Out of 2,746 schools, 0 can be evaluated.",
        {"columns": ["covered", "total"], "rows": [[1, 2746]]},
    )
    assert score_deterministic(zero_expects, mismatched_zero)["denominator"]["passed"] is False
    mismatched_total = make_query_capture(
        "0 out of 2,746 schools can be evaluated.",
        {"columns": ["covered", "total"], "rows": [[0, 999]]},
    )
    assert score_deterministic(zero_expects, mismatched_total)["denominator"]["passed"] is False


def test_marker_requirement_accepts_verified_visualization_cell_marker() -> None:
    capture = make_capture(
        vizzes=[
            {
                "type": "comparison_table",
                "rows": [{"cells": [{"available": True, "marker": "[1]"}]}],
            }
        ]
    )
    assert score_deterministic({"markers": True}, capture)["marker_presence"]["passed"] is True


def test_current_web_claim_requires_page_period_evidence_not_retrieval_date() -> None:
    expects = {
        "current_web_claim": {
            "value": "4,561",
            "periods": ["2025-2026", "2025–2026"],
            "domain": "mit.edu",
            "forbidden_values": ["4,472"],
        }
    }
    current = make_capture(
        prose="MIT reports 4,561 undergraduates for 2025–2026 [1].",
        tool_calls=[{"tool_name": "search_school_site", "args": {"query": "MIT enrollment"}}],
        tool_returns=[
            {
                "tool_name": "search_school_site",
                "content": {
                    "results": [
                        {
                            "citation": {
                                "source": "edu",
                                "tier": "official",
                                "url": "https://registrar.mit.edu/enrollment",
                                "source_currentness": "current",
                                "source_period": "2025-2026",
                                "source_period_basis": "page_content",
                                "source_period_evidence": "2025-2026 | Undergraduate 4,561",
                            }
                        }
                    ]
                },
            }
        ],
    )
    undated = make_capture(
        prose="MIT currently has 4,561 undergraduates [1].",
        tool_calls=current.tool_calls,
        tool_returns=[
            {
                "tool_name": "search_school_site",
                "content": {
                    "results": [
                        {
                            "citation": {
                                "source": "edu",
                                "tier": "official",
                                "url": "https://mit.edu/facts",
                                "source_currentness": "undated",
                                "source_period": None,
                                "source_period_basis": None,
                                "source_period_evidence": None,
                                "vintage": "Retrieved Jul 16, 2026",
                            }
                        }
                    ]
                },
            }
        ],
    )

    assert score_deterministic(expects, current)["current_web_source_period"]["passed"] is True
    assert score_deterministic(expects, undated)["current_web_source_period"]["passed"] is False


def test_mixed_metric_vintages_must_be_copied_individually() -> None:
    expects = {
        "vintage_claims": {"values": ["6,814", "$69,900"]},
        "forbidden_prose": ["same period"],
    }
    enrollment_vintage = "CDS 2024-25; enrollment snapshot: October 15, 2024"
    tuition_vintage = "CDS 2024-25; cost reporting academic year: 2025-2026"
    tool_returns = [
        {
            "tool_name": "get_domain",
            "content": {
                "rows": [
                    {
                        "display": "6,814",
                        "vintage": enrollment_vintage,
                        "citation": {"vintage": "Common Data Set 2024-25"},
                    }
                ]
            },
        },
        {
            "tool_name": "get_domain",
            "content": {
                "rows": [
                    {
                        "display": "69900",
                        "vintage": tuition_vintage,
                        "citation": {"vintage": "Common Data Set 2024-25"},
                    }
                ]
            },
        },
    ]
    calls = [
        {"tool_name": "get_domain", "args": {"domain_id": "enrollment"}},
        {"tool_name": "get_domain", "args": {"domain_id": "cost"}},
    ]
    correct = make_capture(
        prose=(
            f"Enrollment was 6,814 ({enrollment_vintage}) [1]. "
            f"Tuition was $69,900 ({tuition_vintage}) [2]."
        ),
        tool_calls=calls,
        tool_returns=tool_returns,
    )
    merged = make_capture(
        prose="Enrollment was 6,814 [1], and tuition for the same period was $69,900 [2].",
        tool_calls=calls,
        tool_returns=tool_returns,
    )

    correct_checks = score_deterministic(expects, correct)
    assert correct_checks["metric_vintage_bindings"]["passed"] is True
    assert correct_checks["forbidden_prose"]["passed"] is True
    merged_checks = score_deterministic(expects, merged)
    assert merged_checks["metric_vintage_bindings"]["passed"] is False
    assert merged_checks["forbidden_prose"]["passed"] is False


def test_workspace_scorer_requires_successful_persisted_rows() -> None:
    expects = {"tool": "create_tasks", "batch_key": "tasks", "min_items": 2}
    failed = make_capture(
        tool_calls=[
            {
                "tool_name": "create_tasks",
                "args": {"tasks": [{"title": "One"}, {"title": "Two"}]},
            }
        ],
        tool_returns=[
            {"tool_name": "create_tasks", "content": {"status": "tool_error"}}
        ],
    )
    succeeded = make_capture(
        tool_calls=failed.tool_calls,
        tool_returns=[
            {
                "tool_name": "create_tasks",
                "content": {
                    "status": "ok",
                    "created": [{"id": "1", "title": "One"}, {"id": "2", "title": "Two"}],
                },
            }
        ],
    )
    assert score_workspace(expects, failed)["items_created"]["passed"] is False
    assert score_workspace(expects, succeeded)["items_created"]["passed"] is True
    message_error = make_capture(
        tool_calls=failed.tool_calls,
        tool_returns=[
            {"tool_name": "create_tasks", "content": {"error": "database unavailable"}}
        ],
    )
    assert score_workspace(expects, message_error)["items_created"]["passed"] is False


def test_required_eval_metric_never_falls_back_to_an_unrelated_ref() -> None:
    metrics = {"admissions.acceptance_rate": object()}
    with pytest.raises(RuntimeError, match="applicants_total"):
        _require_metric_ref(metrics, "admissions", "applicants_total")


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


def test_clarification_requires_v2_event_when_mandatory() -> None:
    prose_only = score_clarify(
        {"must_clarify": True},
        make_capture(prose="Which Washington University or campus do you mean?"),
    )
    assert prose_only["clarify_judgment"]["passed"] is False

    v1_event = score_clarify(
        {"must_clarify": True},
        make_capture(clarifies=[{"v": 1}], done_status="awaiting_input"),
    )
    assert v1_event["clarify_judgment"]["passed"] is False

    v2_complete = score_clarify(
        {"must_clarify": True},
        make_capture(clarifies=[{"v": 2}], done_status="complete"),
    )
    assert v2_complete["clarify_judgment"]["passed"] is False

    v2_parked = score_clarify(
        {"must_clarify": True},
        make_capture(clarifies=[{"v": 2}], done_status="awaiting_input"),
    )
    assert v2_parked["clarify_judgment"]["passed"] is True


def test_narration_requires_first_visible_work_event_and_no_final_boilerplate() -> None:
    narration = Event(type="narration", data={"text": "I will check the coverage block."})
    resolve_step = Event(
        type="step",
        data={"status": "start", "kind": "resolve_school", "label": "Resolving school"},
    )
    good = score_narration({}, make_capture(events=[narration, resolve_step], prose="Answer."))
    assert good["narration_present"]["passed"] is True
    assert good["narration_before_work"]["passed"] is True
    assert good["no_write_plan_for_narration"]["passed"] is True
    assert good["no_final_boilerplate"]["passed"] is True

    write_plan_step = Event(
        type="step",
        data={"status": "start", "kind": "write_plan", "label": "Updating the plan"},
    )
    write_plan_first = score_narration(
        {},
        make_capture(events=[write_plan_step, narration, resolve_step], prose="Answer."),
    )
    assert write_plan_first["narration_present"]["passed"] is True
    assert write_plan_first["narration_before_work"]["passed"] is False
    assert write_plan_first["no_write_plan_for_narration"]["passed"] is False

    write_plan_after_narration = score_narration(
        {},
        make_capture(events=[narration, write_plan_step, resolve_step], prose="Answer."),
    )
    assert write_plan_after_narration["narration_before_work"]["passed"] is True
    assert write_plan_after_narration["no_write_plan_for_narration"]["passed"] is False

    late_narration = score_narration(
        {},
        make_capture(events=[narration, resolve_step, narration], prose="Answer."),
    )
    assert late_narration["narration_present"]["passed"] is True
    assert late_narration["narration_before_work"]["passed"] is False

    final_boilerplate = score_narration(
        {},
        make_capture(
            events=[narration, resolve_step],
            prose="The coverage block is partial. Execution finished. Ready for next instructions.",
        ),
    )
    assert final_boilerplate["no_final_boilerplate"]["passed"] is False


def test_non_required_clarification_rejects_prose_or_widget_question() -> None:
    assert (
        score_clarify(
            {"must_clarify": False},
            make_capture(prose="Which school do you mean?"),
        )["clarify_judgment"]["passed"]
        is False
    )
    assert (
        score_clarify(
            {"must_clarify": False},
            make_capture(clarifies=[{"v": 2}], done_status="awaiting_input"),
        )["clarify_judgment"]["passed"]
        is False
    )
    assert (
        score_clarify(
            {"must_clarify": False},
            make_capture(prose="It is in New Haven."),
        )["clarify_judgment"]["passed"]
        is True
    )


@pytest.mark.asyncio
async def test_every_case_gets_no_old_tools_assertion() -> None:
    question = {"type": "routing", "question": "q", "expects": {"tools": []}}
    checks = await score_question(
        question,
        make_capture(tool_calls=[{"tool_name": "get_values", "args": {}}]),
        None,
    )
    assert checks["no_old_tools"]["passed"] is False


@pytest.mark.asyncio
async def test_response_mode_behavior_can_require_source_routing_tools() -> None:
    question = {
        "type": "response_mode_behavior",
        "question": "q",
        "expects": {"tools": ["resolve_school", "search_school_site"]},
    }
    checks = await score_question(
        question,
        make_capture(
            tool_calls=[
                {"tool_name": "resolve_school", "args": {}},
                {"tool_name": "search_school_site", "args": {}},
            ]
        ),
        None,
    )

    assert checks["tools_called"]["passed"] is True


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
        school,
        "dynamic",
        "dynamic.metric",
        ("dynamic.metric", "dynamic.two", "dynamic.three", "dynamic.four"),
        "dynamic.aid",
        "admissions.applicants",
        "admissions.admitted",
        None,
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

    selected = next(
        question
        for question in materialize_questions(load_questions(), context)
        if question["id"] == "denominator-most-selective"
    )
    assert selected["expects"]["typed_refetch_domain_id"] == "admissions"
    assert selected["expects"]["typed_refetch_refs"] == [
        "admissions.admitted",
        "admissions.applicants",
    ]

    mode_case = next(
        question
        for question in materialize_questions(load_questions(), context)
        if question["id"] == "response-mode-focused-direct"
    )
    assert mode_case["type"] == "response_mode_behavior"
    assert mode_case["skills"] == ["focused-answer"]
    assert "Live School" in mode_case["question"]


@pytest.mark.asyncio
async def test_response_mode_eval_forwards_selected_skills(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create_session(*_args: Any, **_kwargs: Any) -> str:
        return "eval-session"

    async def fake_run_turn(*_args: Any, **kwargs: Any) -> Any:
        captured["selected_skills"] = kwargs.get("selected_skills")
        captured["response_mode"] = kwargs.get("response_mode")
        yield Event(type="delta", data={"text": "Direct answer."})
        yield Event(type="done", data={"status": "complete"})

    class FakeGraph:
        async def aget_state(self, _config: dict[str, Any]) -> Any:
            return SimpleNamespace(values={"messages": []})

    monkeypatch.setattr(runner, "create_session", fake_create_session)
    monkeypatch.setattr(runner, "run_turn", fake_run_turn)

    result = await run_question(
        cast(Any, SimpleNamespace(app_pool=None, deps=object(), graph=FakeGraph())),
        None,
        {
            "id": "response-mode-focused-direct",
            "type": "response_mode_behavior",
            "question": "Answer directly.",
            "skills": ["focused-answer"],
            "expects": {},
        },
        ResponseMode.QUICK,
    )

    assert result["passed"] is True
    assert captured["selected_skills"] == ("focused-answer",)
    assert captured["response_mode"] is ResponseMode.QUICK


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
