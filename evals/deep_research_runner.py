"""Deep-research eval runner.

This runner is separate from ``evals.runner`` because deep research is a
multi-turn flow: an initial request can park on a scope clarify, then parks on
the backend-generated research plan, then resumes with "Run deep research".

Run:

    uv run python -m evals.deep_research_runner
    uv run python -m evals.deep_research_runner --only mit-stanford-cs-aid-testing

Requires ``COUNSELLE_DEEP_RESEARCH_ENABLED=true`` for live acceptance runs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
import yaml

from app.agent_node import model_name_from_setting
from app.deps import Runtime, build_runtime
from app.run_turn import run_turn
from app.sessions import create_session
from config.logging import setup_logging
from config.settings import get_settings
from domain.events import Event
from domain.specs import SourceConfig

logger = structlog.get_logger(__name__)

EVALS_DIR = Path(__file__).parent
QUESTIONS_PATH = EVALS_DIR / "deep_research_questions.yaml"
QUESTION_TIMEOUT_S = 900
RUN_LABEL = "Run deep research"


@dataclass
class DeepCapture:
    events: list[Event]
    prose: str
    sources: list[dict[str, Any]]
    clarifies: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    done_status: str | None
    errored: bool
    usage: dict[str, Any] | None
    research: dict[str, Any]


def _check(passed: bool, detail: str) -> dict[str, Any]:
    return {"passed": passed, "detail": detail}


def capture_events(events: list[Event], research: dict[str, Any] | None = None) -> DeepCapture:
    sources_events = [event for event in events if event.type == "sources"]
    usage_events = [event for event in events if event.type == "usage"]
    done_events = [event for event in events if event.type == "done"]
    return DeepCapture(
        events=events,
        prose="".join(event.data["text"] for event in events if event.type == "delta"),
        sources=list(sources_events[-1].data["sources"]) if sources_events else [],
        clarifies=[event.data for event in events if event.type == "clarify"],
        steps=[event.data for event in events if event.type == "step"],
        done_status=str(done_events[-1].data["status"]) if done_events else None,
        errored=any(event.type == "error" for event in events),
        usage=dict(usage_events[-1].data) if usage_events else None,
        research=research or {},
    )


def _last_clarify(events: list[Event]) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.type == "clarify":
            return event.data
    return None


def _done_status(events: list[Event]) -> str | None:
    for event in reversed(events):
        if event.type == "done":
            return str(event.data.get("status"))
    return None


async def _collect_turn(
    runtime: Runtime,
    session_id: str,
    text: str,
    source_config: SourceConfig,
    *,
    deep_research: bool = False,
) -> list[Event]:
    events: list[Event] = []
    async with asyncio.timeout(QUESTION_TIMEOUT_S):
        async for event in run_turn(
            session_id,
            text,
            source_config,
            deps=runtime.deps,
            graph=runtime.graph,
            deep_research=deep_research,
        ):
            events.append(event)
    return events


async def _research_state(runtime: Runtime, session_id: str) -> dict[str, Any]:
    snapshot = await runtime.graph.aget_state({"configurable": {"thread_id": session_id}})
    if not snapshot:
        return {}
    research = snapshot.values.get("research") or {}
    return dict(research) if isinstance(research, dict) else {}


def _source_config(question: dict[str, Any]) -> SourceConfig:
    raw = question.get("source_config") or {"web": True, "edu": True, "reddit": False}
    return SourceConfig(
        web=bool(raw.get("web")),
        edu=bool(raw.get("edu")),
        reddit=bool(raw.get("reddit")),
        reddit_subreddits=raw.get("reddit_subreddits"),
    )


def _skip_reason(question: dict[str, Any]) -> str | None:
    required = question.get("skip_unless_env") or {}
    for key, expected in required.items():
        actual = os.environ.get(str(key))
        if actual != str(expected):
            return f"requires {key}={expected}; actual={actual!r}"
    return None


async def run_deep_question(runtime: Runtime, question: dict[str, Any]) -> dict[str, Any]:
    skip_reason = _skip_reason(question)
    if skip_reason is not None:
        return {
            "id": question["id"],
            "question": question["question"],
            "skipped": True,
            "passed": True,
            "checks": {"skipped": _check(True, skip_reason)},
        }

    source_config = _source_config(question)
    session_id = await create_session(
        runtime.app_pool,
        source_config.model_dump(mode="json"),
        title=f"deep-eval:{question['id']}",
    )

    started = time.monotonic()
    all_events = await _collect_turn(
        runtime,
        session_id,
        question["question"],
        source_config,
        deep_research=True,
    )

    resumes = 0
    while _done_status(all_events) == "awaiting_input" and resumes < 3:
        clarify = _last_clarify(all_events)
        answer = _answer_for_clarify(question, clarify)
        all_events.extend(await _collect_turn(runtime, session_id, answer, source_config))
        resumes += 1

    research = await _research_state(runtime, session_id)
    capture = capture_events(all_events, research)
    checks = score_deep_question(question, capture)
    return {
        "id": question["id"],
        "question": question["question"],
        "session_id": session_id,
        "skipped": False,
        "passed": all(check["passed"] for check in checks.values()),
        "checks": checks,
        "prose": capture.prose,
        "sources": capture.sources,
        "clarifies": capture.clarifies,
        "steps": capture.steps,
        "caps": capture.research.get("caps") or {},
        "usage": capture.usage,
        "done_status": capture.done_status,
        "duration_s": round(time.monotonic() - started, 1),
        "events": [event.model_dump() for event in capture.events],
    }


def _answer_for_clarify(question: dict[str, Any], clarify: dict[str, Any] | None) -> str:
    if not clarify:
        return RUN_LABEL
    if clarify.get("header") == "Research scope":
        return str(question.get("scope_answer") or question["question"])
    if clarify.get("research_plan") is not None or clarify.get("header") == "Deep research":
        options = clarify.get("options") or []
        for option in options:
            label = option.get("label") if isinstance(option, dict) else None
            if isinstance(label, str) and "run" in label.lower():
                return label
        return RUN_LABEL
    return str(question.get("clarify_answer") or RUN_LABEL)


def score_deep_question(question: dict[str, Any], capture: DeepCapture) -> dict[str, Any]:
    expects = question.get("expects") or {}
    checks = {
        "done_complete": _check(capture.done_status == "complete", f"done={capture.done_status}"),
        "no_error_event": _check(not capture.errored, f"error event={capture.errored}"),
    }

    if expects.get("scope_clarify") is not None:
        fired = any(c.get("header") == "Research scope" for c in capture.clarifies)
        checks["scope_clarify"] = _check(
            fired is bool(expects["scope_clarify"]),
            f"scope clarify fired={fired}",
        )

    if expects.get("plan_clarify", True):
        plan_seen = any(c.get("research_plan") is not None for c in capture.clarifies)
        checks["plan_clarify"] = _check(plan_seen, f"plan clarify seen={plan_seen}")

    _score_sections(expects, capture, checks)
    _score_sources(expects, capture, checks)
    _score_steps(expects, capture, checks)
    _score_caps(expects, capture, checks)

    min_citations = int(expects.get("min_citations") or 0)
    if min_citations:
        cited = sorted(set(re.findall(r"\[\d+\]", capture.prose)))
        checks["min_citations"] = _check(
            len(cited) >= min_citations,
            f"expected >= {min_citations}; got {cited}",
        )

    for needle in expects.get("text_contains") or []:
        checks[f"text_contains:{needle}"] = _check(
            str(needle).lower() in capture.prose.lower(),
            f"looked for {needle!r}",
        )
    return checks


def _score_sections(
    expects: dict[str, Any],
    capture: DeepCapture,
    checks: dict[str, Any],
) -> None:
    for section in expects.get("sections") or []:
        pattern = re.compile(rf"^##\s+{re.escape(str(section))}\b", re.IGNORECASE | re.MULTILINE)
        checks[f"section:{section}"] = _check(
            bool(pattern.search(capture.prose)),
            f"looked for section {section!r}",
        )


def _score_sources(
    expects: dict[str, Any],
    capture: DeepCapture,
    checks: dict[str, Any],
) -> None:
    source_names = {
        (source.get("citation") or {}).get("source")
        for source in capture.sources
        if isinstance(source, dict)
    }
    for source in expects.get("sources_present") or []:
        checks[f"source_present:{source}"] = _check(
            source in source_names,
            f"sources={sorted(str(s) for s in source_names if s)}",
        )
    for source in expects.get("sources_absent") or []:
        checks[f"source_absent:{source}"] = _check(
            source not in source_names,
            f"sources={sorted(str(s) for s in source_names if s)}",
        )


def _score_steps(
    expects: dict[str, Any],
    capture: DeepCapture,
    checks: dict[str, Any],
) -> None:
    step_kinds = {str(step.get("kind")) for step in capture.steps}
    step_ids = {str(step.get("step_id")) for step in capture.steps}
    for kind in expects.get("step_kinds_present") or []:
        checks[f"step_kind_present:{kind}"] = _check(kind in step_kinds, f"kinds={step_kinds}")
    for kind in expects.get("step_kinds_absent") or []:
        checks[f"step_kind_absent:{kind}"] = _check(kind not in step_kinds, f"kinds={step_kinds}")
    for step_id in expects.get("step_ids_present") or []:
        checks[f"step_id_present:{step_id}"] = _check(step_id in step_ids, f"ids={step_ids}")


def _score_caps(
    expects: dict[str, Any],
    capture: DeepCapture,
    checks: dict[str, Any],
) -> None:
    caps = capture.research.get("caps") or {}
    if not isinstance(caps, dict):
        caps = {}
    for key in expects.get("caps_keys_present") or []:
        checks[f"cap_present:{key}"] = _check(key in caps, f"caps={caps}")
    for key in expects.get("caps_keys_absent") or []:
        checks[f"cap_absent:{key}"] = _check(key not in caps, f"caps={caps}")
    for key, expected in (expects.get("caps_contains") or {}).items():
        checks[f"cap_equals:{key}"] = _check(caps.get(key) == expected, f"caps={caps}")


def load_questions() -> list[dict[str, Any]]:
    with QUESTIONS_PATH.open(encoding="utf-8") as handle:
        questions = yaml.safe_load(handle)
    if not isinstance(questions, list):
        raise ValueError("deep_research_questions.yaml must contain a list")
    ids = [question.get("id") for question in questions if isinstance(question, dict)]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate question ids in deep_research_questions.yaml")
    return [dict(question) for question in questions]


def select_questions(
    questions: list[dict[str, Any]],
    only: list[str] | None,
) -> list[dict[str, Any]]:
    if not only:
        return questions
    wanted = {part.strip() for item in only for part in item.split(",") if part.strip()}
    known = {question["id"] for question in questions}
    missing = wanted - known
    if missing:
        raise SystemExit(f"unknown question id(s): {sorted(missing)}")
    return [question for question in questions if question["id"] in wanted]


def build_report(results: list[dict[str, Any]], model: str) -> dict[str, Any]:
    active = [result for result in results if not result.get("skipped")]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "model": model,
        "total": len(active),
        "skipped": sum(1 for result in results if result.get("skipped")),
        "passed": sum(1 for result in active if result["passed"]),
        "results": results,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Deep research eval report - {report['generated_at'][:10]}",
        "",
        f"Model: `{report['model']}`",
        f"Questions: {report['total']} active, {report['skipped']} skipped",
        f"Passed: {report['passed']}/{report['total']}",
        "",
        "| ID | Result | Failed checks |",
        "|---|---|---|",
    ]
    for result in report["results"]:
        status = "SKIP" if result.get("skipped") else ("PASS" if result["passed"] else "FAIL")
        failed = [
            name for name, check in result["checks"].items() if not check.get("passed")
        ]
        lines.append(f"| {result['id']} | {status} | {', '.join(failed) or '-'} |")
    lines.append("")
    return "\n".join(lines)


def write_reports(report: dict[str, Any]) -> None:
    stamp = report["generated_at"][:10]
    json_path = EVALS_DIR / f"deep-research-report-{stamp}.json"
    md_path = EVALS_DIR / f"deep-research-report-{stamp}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(md_path.read_text(encoding="utf-8"))


async def amain(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args(argv)

    settings = get_settings()
    setup_logging(settings.log_level)
    questions = select_questions(load_questions(), args.only)
    runtime = await build_runtime(settings)
    try:
        results = []
        for question in questions:
            results.append(await run_deep_question(runtime, question))
        report = build_report(results, model_name_from_setting(settings.model_counselor))
        if args.no_write:
            print(render_markdown(report))
        else:
            write_reports(report)
    finally:
        await runtime.aclose()


def main() -> None:
    asyncio.run(amain())


if __name__ == "__main__":
    main()
