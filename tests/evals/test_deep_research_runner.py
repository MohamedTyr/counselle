from __future__ import annotations

from evals import deep_research_runner as runner
from evals.deep_research_runner import DeepCapture


def _capture() -> DeepCapture:
    return DeepCapture(
        events=[],
        prose="\n".join(
            [
                "## Bottom line",
                "MIT and Stanford both need careful review [1].",
                "## Evidence coverage",
                "Verification was limited but sources were checked.",
                "## DB-backed facts",
                "Counselle data is included [1].",
                "## Current official findings",
                "Official pages are included [2].",
                "## Unknowns/conflicts",
                "Some items remain uncertain.",
                "## Next checks",
                "Recheck policy pages before applying.",
            ]
        ),
        sources=[
            {"citation": {"source": "cds"}},
            {"citation": {"source": "edu"}},
        ],
        clarifies=[
            {"header": "Research scope"},
            {"header": "Deep research", "research_plan": {"summary": "Plan"}},
        ],
        steps=[
            {"step_id": "research_db_check", "kind": "db_tool"},
            {"step_id": "research_official_search", "kind": "edu_search"},
            {"step_id": "research_gptr_research", "kind": "web_search"},
        ],
        done_status="complete",
        errored=False,
        usage=None,
        research={"caps": {"gptr_unavailable": "package_not_installed"}},
    )


def test_deep_research_question_fixture_has_required_scenarios() -> None:
    ids = {question["id"] for question in runner.load_questions()}

    assert {
        "mit-stanford-cs-aid-testing",
        "broad-schoolless-scope-gate",
        "reddit-disabled-isolation",
        "web-disabled-db-official-only",
        "verification-timeout-caveat",
        "gptr-enabled-supplement",
        "gptr-unavailable-fallback",
    } <= ids


def test_deep_research_scorer_checks_flow_sources_steps_and_caps() -> None:
    checks = runner.score_deep_question(
        {
            "expects": {
                "scope_clarify": True,
                "plan_clarify": True,
                "sections": ["Bottom line", "Evidence coverage", "Next checks"],
                "sources_present": ["cds", "edu"],
                "sources_absent": ["reddit"],
                "step_kinds_present": ["db_tool", "edu_search"],
                "step_ids_present": ["research_gptr_research"],
                "caps_keys_present": ["gptr_unavailable"],
                "min_citations": 1,
                "text_contains": ["verification"],
            }
        },
        _capture(),
    )

    assert all(check["passed"] for check in checks.values())


def test_deep_research_scope_and_plan_answers_are_selected() -> None:
    assert (
        runner._answer_for_clarify(
            {"question": "original", "scope_answer": "MIT and Stanford"},
            {"header": "Research scope"},
        )
        == "MIT and Stanford"
    )
    assert (
        runner._answer_for_clarify(
            {"question": "original"},
            {
                "header": "Deep research",
                "research_plan": {"summary": "Plan"},
                "options": [{"label": "Run deep research"}],
            },
        )
        == "Run deep research"
    )
