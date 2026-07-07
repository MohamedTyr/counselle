"""The eval runner — replays evals/questions.yaml through ``run_turn`` (Phase 7 Slice A).

Each question gets a fresh session (``app.sessions.create_session``) and one
real turn against the live runtime (real Gemini + DB; Tavily only for
questions tagged ``web: true``; Reddit always off). The runner captures the
full event stream, the tool calls (from the thread's serialized messages),
and the source registry, then scores:

- **mechanically** where possible — tool-called, field-key, viz-type/school,
  clarify-event, and display-value assertions;
- **via a cheap-model judge** (``settings.model_cheap``, prompt in
  ``evals/judge.md``) for the honesty prose criteria.

Output: ``evals/report-<date>.json`` + ``evals/report-<date>.md`` and the
markdown summary on stdout. There is NO pass threshold (PRD story 58) — the
report is the deliverable; failures get eyeballed by the orchestrator.

Run::

    uv run python -m evals.runner                 # the full set (slow, costs money)
    uv run python -m evals.runner --only fact-duke-acceptance
    uv run python -m evals.runner --type honesty

Eval sessions are deliberately left in the DB (they are cheap and useful for
post-mortems).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import structlog
import yaml
from pydantic import BaseModel

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
QUESTIONS_PATH = EVALS_DIR / "questions.yaml"
JUDGE_PROMPT_PATH = EVALS_DIR / "judge.md"

QUESTION_TYPES = (
    "fact",
    "field-selection",
    "clarify-judgment",
    "honesty",
    "comparison-viz",
    "narration-quality",
)

#: Default set of tools that can carry a fact's value (plan: get_values/get_dossier;
#: compare/benchmark/SQL are legitimate value-bearing paths too).
VALUE_BEARING_TOOLS = frozenset(
    {"get_values", "get_dossier", "compare_schools", "national_benchmark", "query_database"}
)
#: Hard per-question wall clock — a hung turn must not stall the whole run.
QUESTION_TIMEOUT_S = 600


# ---------------------------------------------------------------------------
# The judge (cheap model; prompt in evals/judge.md)
# ---------------------------------------------------------------------------


class CriterionVerdict(BaseModel):
    """One yes/no verdict with verbatim evidence (the judge.md contract)."""

    criterion: str
    verdict: Literal["yes", "no"]
    evidence: str


class JudgeOutput(BaseModel):
    """The judge's full structured answer: one verdict per criterion, in order."""

    verdicts: list[CriterionVerdict]


def build_judge_agent(settings: Any) -> Any:
    """The cheap-model judge agent (same Vertex Express auth path as the counselor)."""
    from pydantic_ai import Agent
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    if not settings.vertex_api_key:
        raise RuntimeError("COUNSELLE_VERTEX_API_KEY is not set — the judge cannot authenticate")
    model = GoogleModel(
        model_name_from_setting(settings.model_cheap),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )
    return Agent(
        model,
        instructions=JUDGE_PROMPT_PATH.read_text(encoding="utf-8"),
        output_type=JudgeOutput,
    )


# ---------------------------------------------------------------------------
# Turn capture — events + tool calls + registry, structurally accessed
# ---------------------------------------------------------------------------


@dataclass
class TurnCapture:
    """Everything one eval turn produced, ready for the scorers."""

    events: list[Event]
    prose: str
    tool_calls: list[dict[str, Any]]
    args_blob: str  # all tool-call args, JSON-dumped (field-key needle search)
    returns_blob: str  # all tool-return contents, JSON-dumped
    sources: list[dict[str, Any]]
    vizzes: list[dict[str, Any]]
    clarifies: list[dict[str, Any]]
    done_status: str | None
    errored: bool
    usage: dict[str, Any] | None


@dataclass(frozen=True)
class ToolRound:
    """A visible group of step events that starts when the first step opens."""

    start: int
    end: int | None
    closed: bool


def _extract_tool_calls(raw_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """All tool-call parts from the thread's serialized ModelMessages."""
    calls: list[dict[str, Any]] = []
    for message in raw_messages:
        for part in message.get("parts") or []:
            if part.get("part_kind") == "tool-call":
                calls.append({"tool_name": part.get("tool_name"), "args": part.get("args")})
    return calls


def _extract_returns_blob(raw_messages: list[dict[str, Any]]) -> str:
    """All tool-return contents as one JSON blob (envelope field-key search)."""
    chunks: list[str] = []
    for message in raw_messages:
        for part in message.get("parts") or []:
            if part.get("part_kind") == "tool-return":
                chunks.append(json.dumps(part.get("content"), default=str))
    return "\n".join(chunks)


def capture_turn(events: list[Event], raw_messages: list[dict[str, Any]]) -> TurnCapture:
    """Assemble the capture from the event stream + the thread's messages."""
    sources_events = [event for event in events if event.type == "sources"]
    usage_events = [event for event in events if event.type == "usage"]
    done_events = [event for event in events if event.type == "done"]
    tool_calls = _extract_tool_calls(raw_messages)
    return TurnCapture(
        events=events,
        prose="".join(event.data["text"] for event in events if event.type == "delta"),
        tool_calls=tool_calls,
        args_blob=json.dumps([call["args"] for call in tool_calls], default=str),
        returns_blob=_extract_returns_blob(raw_messages),
        sources=list(sources_events[-1].data["sources"]) if sources_events else [],
        vizzes=[event.data for event in events if event.type == "viz"],
        clarifies=[event.data for event in events if event.type == "clarify"],
        done_status=str(done_events[-1].data["status"]) if done_events else None,
        errored=any(event.type == "error" for event in events),
        usage=dict(usage_events[-1].data) if usage_events else None,
    )


# ---------------------------------------------------------------------------
# Mechanical assertions
# ---------------------------------------------------------------------------


def _check(passed: bool, detail: str) -> dict[str, Any]:
    return {"passed": passed, "detail": detail}


def value_in_prose(value: str, prose: str) -> bool:
    """Display-value match with numeric and textual boundary guards."""
    norm_value = value.replace(",", "")
    norm_prose = prose.replace(",", "")
    if not re.search(r"\d", norm_value):
        return _text_contains_phrase(norm_prose, norm_value)
    pattern = re.compile(
        r"(?<![\d.])" + re.escape(norm_value) + r"(?!(?:\d|\.\d))",
        re.IGNORECASE,
    )
    if pattern.search(norm_prose):
        return True
    if norm_value.startswith("-"):  # "-$2,610" may be rendered "negative $2,610"
        unsigned = re.compile(
            r"(?<![\d.])" + re.escape(norm_value[1:]) + r"(?!(?:\d|\.\d))",
            re.IGNORECASE,
        )
        return bool(unsigned.search(norm_prose))
    return False


def _fields_seen(fields: list[str], capture: TurnCapture) -> list[str]:
    """Which of the given field keys appear in tool-call args or tool returns."""
    haystack = capture.args_blob + "\n" + capture.returns_blob
    return [field for field in fields if field in haystack]


def score_fact(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    """Fact: a value-bearing DB tool ran, a preferred field was used, display matches."""
    tools = set(expects.get("tools") or VALUE_BEARING_TOOLS)
    called = {call["tool_name"] for call in capture.tool_calls}
    fields = list(expects.get("fields") or [])
    seen = _fields_seen(fields, capture)
    values = [str(value) for value in expects.get("values") or []]
    matched = [value for value in values if value_in_prose(value, capture.prose)]
    return {
        "db_tool_called": _check(
            bool(called & tools), f"value-bearing tools called: {sorted(called & tools)}"
        ),
        "field_used": _check(bool(seen), f"expected one of {fields}; saw {seen}"),
        "value_in_prose": _check(
            bool(matched), f"expected one of {values} in prose; matched {matched}"
        ),
    }


def score_field_selection(
    expects: dict[str, Any], capture: TurnCapture
) -> dict[str, dict[str, Any]]:
    """Field-selection: the right field appears; the trap field is never requested."""
    field_in = list(expects.get("field_in") or [])
    field_not = list(expects.get("field_not") or [])
    seen = _fields_seen(field_in, capture)
    # Trap fields are checked against tool-call ARGS only — a dossier RETURN may
    # legitimately bundle a sibling field the agent never asked for.
    trapped = [field for field in field_not if field in capture.args_blob]
    checks = {
        "right_field": _check(bool(seen), f"expected one of {field_in}; saw {seen}"),
    }
    if field_not:
        checks["trap_field_avoided"] = _check(
            not trapped, f"forbidden fields requested: {trapped or 'none'}"
        )
    return checks


def score_clarify(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    """Clarify-judgment: did a clarify event fire (or not), as expected."""
    must = bool(expects.get("must_clarify"))
    fired = bool(capture.clarifies)
    detail = f"clarify events: {len(capture.clarifies)}; done={capture.done_status}"
    if must:
        return {"clarify_fired": _check(fired and capture.done_status == "awaiting_input", detail)}
    return {"no_clarify": _check(not fired and capture.done_status == "complete", detail)}


def score_viz(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    """Comparison/viz: the right viz type rendered with all the expected schools."""
    viz_type = expects.get("viz_type")
    wanted = set(expects.get("unitids") or [])
    rendered = [
        (viz["type"], {school["unitid"] for school in viz["schools"]}) for viz in capture.vizzes
    ]
    hit = any(kind == viz_type and wanted <= unitids for kind, unitids in rendered)
    return {
        "viz_rendered": _check(
            hit, f"expected {viz_type} with unitids ⊇ {sorted(wanted)}; got {rendered}"
        )
    }


def _narration_beats(capture: TurnCapture) -> list[tuple[int, str]]:
    """Ordered narration events with non-empty text."""
    return [
        (index, str(event.data.get("text") or "").strip())
        for index, event in enumerate(capture.events)
        if event.type == "narration" and str(event.data.get("text") or "").strip()
    ]


def _sentence_count(text: str) -> int:
    """Small deterministic sentence counter for narration-length gating."""
    stripped = text.strip()
    if not stripped:
        return 0
    endings = re.findall(r"[.!?]+(?:\s+|$)", stripped)
    return max(1, len(endings))


def _tool_rounds(capture: TurnCapture) -> list[ToolRound]:
    """Return event-index ranges for visible tool rounds, grouped by open steps."""
    rounds: list[ToolRound] = []
    active: set[str] = set()
    round_start: int | None = None
    for index, event in enumerate(capture.events):
        if event.type != "step":
            continue
        status = str(event.data.get("status") or "")
        step_id = str(event.data.get("step_id") or index)
        if status == "start":
            if not active:
                round_start = index
            active.add(step_id)
        elif status in {"end", "error"}:
            active.discard(step_id)
            if not active and round_start is not None:
                rounds.append(ToolRound(start=round_start, end=index, closed=True))
                round_start = None
    if round_start is not None:
        rounds.append(ToolRound(start=round_start, end=None, closed=False))
    return rounds


def _forbidden_narration_values(expects: dict[str, Any]) -> list[str]:
    """Configured answer/value strings that must not leak into work narration."""
    raw_values = [
        *(expects.get("values") or []),
        *(expects.get("narration_forbidden_values") or []),
        *(expects.get("forbidden_values") or []),
    ]
    values = [str(value).strip() for value in raw_values if str(value).strip()]
    return list(dict.fromkeys(values))


def _forbidden_narration_phrases(expects: dict[str, Any]) -> list[str]:
    raw_phrases = [
        *(expects.get("narration_forbidden_phrases") or []),
        *(expects.get("answer_forbidden_phrases") or []),
        *(expects.get("forbidden_phrases") or []),
    ]
    phrases = [str(phrase).strip() for phrase in raw_phrases if str(phrase).strip()]
    return list(dict.fromkeys(phrases))


def _text_contains_phrase(text: str, phrase: str) -> bool:
    if not phrase:
        return False
    pattern = re.compile(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", re.IGNORECASE)
    return bool(pattern.search(text))


def _narration_forbidden_hits(
    beats: list[tuple[int, str]], expects: dict[str, Any]
) -> list[str]:
    hits: list[str] = []
    for _index, text in beats:
        for value in _forbidden_narration_values(expects):
            if value_in_prose(value, text):
                hits.append(value)
        for phrase in _forbidden_narration_phrases(expects):
            if _text_contains_phrase(text, phrase):
                hits.append(phrase)
    return list(dict.fromkeys(hits))


def _delta_indexes(capture: TurnCapture) -> list[int]:
    return [index for index, event in enumerate(capture.events) if event.type == "delta"]


def _premature_delta_indexes(capture: TurnCapture, rounds: list[ToolRound]) -> list[int]:
    """Final-answer deltas emitted before all visible tool activity is closed."""
    active: set[str] = set()
    while_open: list[int] = []
    for index, event in enumerate(capture.events):
        if event.type == "step":
            status = str(event.data.get("status") or "")
            step_id = str(event.data.get("step_id") or index)
            if status == "start":
                active.add(step_id)
            elif status in {"end", "error"}:
                active.discard(step_id)
        elif event.type == "delta" and active:
            while_open.append(index)

    last_tool_index = max(
        (round_.end if round_.end is not None else len(capture.events) - 1 for round_ in rounds),
        default=None,
    )
    before_final_tool_done = [
        index
        for index in _delta_indexes(capture)
        if last_tool_index is not None and index < last_tool_index
    ]
    return list(dict.fromkeys([*while_open, *before_final_tool_done]))


def _failure_indexes(capture: TurnCapture) -> list[int]:
    failures: list[int] = []
    for index, event in enumerate(capture.events):
        if event.type == "error" or (
            event.type == "step" and event.data.get("status") == "error"
        ):
            failures.append(index)
    return failures


def _post_result_reaction_indexes(
    capture: TurnCapture, rounds: list[ToolRound], beats: list[tuple[int, str]]
) -> list[int]:
    """Closed tool rounds that have narration before the next visible move."""
    reacted_rounds: list[int] = []
    for round_number, round_ in enumerate(rounds, 1):
        if round_.end is None:
            continue
        next_move = [
            index
            for index, event in enumerate(capture.events)
            if index > round_.end
            and (
                event.type in {"delta", "done"}
                or (event.type == "step" and event.data.get("status") == "start")
            )
        ]
        limit = next_move[0] if next_move else len(capture.events)
        if any(round_.end < index < limit for index, _text in beats):
            reacted_rounds.append(round_number)
    return reacted_rounds


def score_narration_quality(
    expects: dict[str, Any], capture: TurnCapture
) -> dict[str, dict[str, Any]]:
    """Narration quality: deterministic checks over visible narration/step order."""
    beats = _narration_beats(capture)
    rounds = _tool_rounds(capture)
    requires_tool_work = bool(expects.get("requires_tool_work", True))
    closed_rounds = [round_ for round_ in rounds if round_.closed]
    unclosed_rounds = [
        round_number for round_number, round_ in enumerate(rounds, 1) if not round_.closed
    ]
    missing_rounds: list[int] = []
    previous_end = -1
    for round_number, round_ in enumerate(rounds, 1):
        has_prior_narration = any(previous_end < index < round_.start for index, _text in beats)
        if not has_prior_narration:
            missing_rounds.append(round_number)
        previous_end = round_.end if round_.end is not None else round_.start

    long_beats = [
        text for _index, text in beats if _sentence_count(text) > 2
    ]
    marker_hits = [
        text for _index, text in beats if re.search(r"\[\d+\]", text)
    ]
    forbidden_hits = _narration_forbidden_hits(beats, expects)

    early_deltas = _premature_delta_indexes(capture, rounds)

    failure_reaction_required = bool(expects.get("failure_reaction_required"))
    failure_required = bool(expects.get("failure_required"))
    failures = _failure_indexes(capture)
    failure_reaction_passed = True
    failure_detail = "not required"
    if failure_required and not failures:
        failure_reaction_passed = False
        failure_detail = "failure_required, but no failure/error event occurred"
    elif failure_reaction_required and not failures:
        failure_detail = "no failure/error event occurred; reaction not applicable"
    elif failure_reaction_required:
        missing_reactions: list[int] = []
        for failure_index in failures:
            next_output_or_step = [
                index
                for index, event in enumerate(capture.events)
                if index > failure_index
                and (
                    event.type in {"delta", "done"}
                    or (event.type == "step" and event.data.get("status") == "start")
                )
            ]
            limit = next_output_or_step[0] if next_output_or_step else len(capture.events)
            reacted = any(failure_index < index < limit for index, _text in beats)
            if not reacted:
                missing_reactions.append(failure_index)
        failure_reaction_passed = not missing_reactions
        failure_detail = (
            f"failure indexes: {failures}; "
            f"missing reactions before next step/output: {missing_reactions or 'none'}"
        )

    checks = {
        "tool_activity_completed": _check(
            (not requires_tool_work) or bool(closed_rounds),
            f"requires tool work: {requires_tool_work}; closed tool rounds: {len(closed_rounds)}",
        ),
        "tool_rounds_closed": _check(
            not unclosed_rounds, f"unclosed tool rounds: {unclosed_rounds or 'none'}"
        ),
        "narration_present_for_tool_rounds": _check(
            not missing_rounds,
            f"tool rounds: {len(rounds)}; missing prior narration for rounds: {missing_rounds}",
        ),
        "concise_narration": _check(
            not long_beats, f"beats over 2 sentences: {long_beats or 'none'}"
        ),
        "narration_has_no_citation_markers": _check(
            not marker_hits, f"beats with [n] markers: {marker_hits or 'none'}"
        ),
        "narration_has_no_tool_values": _check(
            not forbidden_hits, f"forbidden values/phrases in narration: {forbidden_hits or 'none'}"
        ),
        "no_answer_during_tool_work": _check(
            not early_deltas,
            f"delta indexes before final tool activity completed: {early_deltas or 'none'}",
        ),
        "reacts_to_failures": _check(failure_reaction_passed, failure_detail),
    }
    reaction_required = bool(
        expects.get("reaction_required") or expects.get("post_result_reaction_required")
    )
    if reaction_required:
        reacted_rounds = _post_result_reaction_indexes(capture, rounds, beats)
        checks["reacts_after_tool_result"] = _check(
            bool(reacted_rounds),
            f"reacted closed tool rounds before next move: {reacted_rounds or 'none'}",
        )
    return checks


# ---------------------------------------------------------------------------
# Judge-scored honesty
# ---------------------------------------------------------------------------


def _event_summary(capture: TurnCapture) -> str:
    """A compact structural summary the judge can reference as evidence."""
    lines = [f"done status: {capture.done_status}; error event: {capture.errored}"]
    for clarify in capture.clarifies:
        lines.append(f"clarify question asked: {clarify.get('question')!r}")
    for viz in capture.vizzes:
        schools = ", ".join(school["name"] for school in viz.get("schools", []))
        lines.append(f"visualization rendered: {viz.get('type')} for [{schools}]")
    for source in capture.sources:
        citation = source.get("citation") or {}
        lines.append(
            f"cited source [{source.get('index')}]: {source.get('label')!r} "
            f"({citation.get('source')}, {citation.get('tier')}, {citation.get('vintage')})"
        )
    return "\n".join(lines)


def build_judge_case(question_text: str, criteria: list[str], capture: TurnCapture) -> str:
    """The judge's user message: question + criteria + prose + event summary."""
    numbered = [f"{index}. {criterion}" for index, criterion in enumerate(criteria, 1)]
    return "\n".join(
        [
            "## Student question",
            question_text,
            "",
            "## Criteria",
            *numbered,
            "",
            "## Counselor's final prose answer",
            capture.prose or "(no prose was produced)",
            "",
            "## Event summary",
            _event_summary(capture),
        ]
    )


async def score_honesty(
    question_text: str, expects: dict[str, Any], capture: TurnCapture, judge_agent: Any
) -> dict[str, dict[str, Any]]:
    """Honesty: every criterion judged yes by the cheap-model judge."""
    criteria = [str(criterion) for criterion in expects.get("criteria") or []]
    if judge_agent is None:
        raise RuntimeError("honesty question scored without a judge agent")
    result = await judge_agent.run(build_judge_case(question_text, criteria, capture))
    verdicts: list[CriterionVerdict] = result.output.verdicts
    checks: dict[str, dict[str, Any]] = {}
    for index, criterion in enumerate(criteria):
        verdict = verdicts[index] if index < len(verdicts) else None
        passed = verdict is not None and verdict.verdict == "yes"
        evidence = verdict.evidence if verdict else "judge returned no verdict for this criterion"
        checks[f"criterion_{index + 1}"] = _check(passed, f"{criterion} -> {evidence}")
    return checks


# ---------------------------------------------------------------------------
# Running one question
# ---------------------------------------------------------------------------


async def score_question(
    question: dict[str, Any], capture: TurnCapture, judge_agent: Any
) -> dict[str, dict[str, Any]]:
    """Dispatch to the type's scorer; every type also requires a clean stream."""
    expects = question.get("expects") or {}
    question_type = question["type"]
    if question_type == "fact":
        checks = score_fact(expects, capture)
    elif question_type == "field-selection":
        checks = score_field_selection(expects, capture)
    elif question_type == "clarify-judgment":
        checks = score_clarify(expects, capture)
    elif question_type == "comparison-viz":
        checks = score_viz(expects, capture)
    elif question_type == "narration-quality":
        checks = score_narration_quality(expects, capture)
    elif question_type == "honesty":
        checks = await score_honesty(question["question"], expects, capture, judge_agent)
    else:
        raise ValueError(f"unknown question type: {question_type!r}")
    checks["no_error_event"] = _check(not capture.errored, f"error event: {capture.errored}")
    return checks


async def _thread_messages(runtime: Runtime, session_id: str) -> list[dict[str, Any]]:
    """The thread's serialized ModelMessages after the turn (tool-call source)."""
    snapshot = await runtime.graph.aget_state({"configurable": {"thread_id": session_id}})
    if not snapshot:
        return []
    return list(snapshot.values.get("messages") or [])


async def run_question(
    runtime: Runtime, judge_agent: Any, question: dict[str, Any]
) -> dict[str, Any]:
    """One fresh session, one live turn, one scored result."""
    web = bool(question.get("web"))
    source_config = SourceConfig(web=web, reddit=False, edu=web)
    session_id = await create_session(
        runtime.app_pool, source_config.model_dump(mode="json"), title=f"eval:{question['id']}"
    )
    started = time.monotonic()
    events: list[Event] = []
    async with asyncio.timeout(QUESTION_TIMEOUT_S):
        async for event in run_turn(
            session_id, question["question"], source_config, deps=runtime.deps, graph=runtime.graph
        ):
            events.append(event)
    capture = capture_turn(events, await _thread_messages(runtime, session_id))
    checks = await score_question(question, capture, judge_agent)
    return {
        "id": question["id"],
        "type": question["type"],
        "question": question["question"],
        "web": web,
        "session_id": session_id,
        "passed": all(check["passed"] for check in checks.values()),
        "checks": checks,
        "prose": capture.prose,
        "tool_calls": capture.tool_calls,
        "sources": capture.sources,
        "vizzes": capture.vizzes,
        "usage": capture.usage,
        "done_status": capture.done_status,
        "duration_s": round(time.monotonic() - started, 1),
        "events": [event.model_dump() for event in capture.events],
    }


async def run_question_safely(
    runtime: Runtime, judge_agent: Any, question: dict[str, Any]
) -> dict[str, Any]:
    """A crash in one question becomes a failed result, never a dead run."""
    try:
        return await run_question(runtime, judge_agent, question)
    except Exception as exc:
        logger.exception("eval question crashed", id=question["id"])
        return {
            "id": question["id"],
            "type": question["type"],
            "question": question["question"],
            "web": bool(question.get("web")),
            "passed": False,
            "checks": {"runner": _check(False, f"crashed: {type(exc).__name__}: {exc}")},
            "prose": "",
            "tool_calls": [],
            "sources": [],
            "vizzes": [],
            "usage": None,
            "done_status": None,
            "duration_s": None,
            "events": [],
        }


# ---------------------------------------------------------------------------
# Question selection
# ---------------------------------------------------------------------------


def load_questions() -> list[dict[str, Any]]:
    """Load and sanity-check evals/questions.yaml."""
    with QUESTIONS_PATH.open(encoding="utf-8") as handle:
        questions: list[dict[str, Any]] = yaml.safe_load(handle)
    for question in questions:
        for key in ("id", "question", "type", "expects"):
            if key not in question:
                raise ValueError(f"question {question.get('id')!r} is missing {key!r}")
        if question["type"] not in QUESTION_TYPES:
            raise ValueError(f"question {question['id']!r} has unknown type {question['type']!r}")
    ids = [question["id"] for question in questions]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate question ids in questions.yaml")
    return questions


def select_questions(
    questions: list[dict[str, Any]], only: list[str] | None, question_type: str | None
) -> list[dict[str, Any]]:
    """Apply --only / --type filters; unknown --only ids are an error."""
    selected = questions
    if question_type:
        selected = [question for question in selected if question["type"] == question_type]
    if only:
        wanted = {part.strip() for item in only for part in item.split(",") if part.strip()}
        known = {question["id"] for question in questions}
        missing = wanted - known
        if missing:
            raise SystemExit(f"unknown question id(s): {sorted(missing)}")
        selected = [question for question in selected if question["id"] in wanted]
    return selected


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def build_report(results: list[dict[str, Any]], model: str) -> dict[str, Any]:
    """The full report object: per-type accuracy + per-question results."""
    per_type: dict[str, dict[str, Any]] = {}
    for question_type in QUESTION_TYPES:
        scoped = [result for result in results if result["type"] == question_type]
        if not scoped:
            continue
        passed = sum(1 for result in scoped if result["passed"])
        per_type[question_type] = {
            "passed": passed,
            "total": len(scoped),
            "accuracy": round(passed / len(scoped), 3),
        }
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "model": model,
        "total": len(results),
        "passed": sum(1 for result in results if result["passed"]),
        "per_type": per_type,
        "results": results,
    }


def render_markdown(report: dict[str, Any]) -> str:
    """The human summary: per-type accuracy table + per-question rows."""
    lines = [
        f"# Eval report — {report['generated_at'][:10]}",
        "",
        f"Model: `{report['model']}` · questions: {report['total']} · "
        f"passed: {report['passed']}/{report['total']}",
        "",
        "## Per-type accuracy",
        "",
        "| Type | Passed | Total | Accuracy |",
        "|---|---|---|---|",
    ]
    for question_type, stats in report["per_type"].items():
        lines.append(
            f"| {question_type} | {stats['passed']} | {stats['total']} | {stats['accuracy']:.0%} |"
        )
    lines += [
        "",
        "## Per-question results",
        "",
        "| ID | Type | Result | Failed checks |",
        "|---|---|---|---|",
    ]
    for result in report["results"]:
        failed = [name for name, check in result["checks"].items() if not check["passed"]]
        status = "PASS" if result["passed"] else "FAIL"
        failed_cell = ", ".join(failed) or "—"
        lines.append(f"| {result['id']} | {result['type']} | {status} | {failed_cell} |")
    lines.append("")
    return "\n".join(lines)


def write_reports(report: dict[str, Any]) -> None:
    """Write report-<date>.json + .md into evals/ and print the summary."""
    stamp = report["generated_at"][:10]
    json_path = EVALS_DIR / f"report-{stamp}.json"
    md_path = EVALS_DIR / f"report-{stamp}.md"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    markdown = render_markdown(report)
    md_path.write_text(markdown, encoding="utf-8")
    print(markdown)
    print(f"Report written: {json_path} and {md_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="evals.runner", description="Replay the eval questions through run_turn and score."
    )
    parser.add_argument(
        "--only",
        action="append",
        metavar="ID",
        help="run only this question id (repeatable; comma-separable)",
    )
    parser.add_argument(
        "--type",
        dest="question_type",
        choices=QUESTION_TYPES,
        help="run only questions of this type",
    )
    return parser.parse_args(argv)


async def amain(args: argparse.Namespace) -> int:
    settings = get_settings()
    setup_logging(settings.log_level)
    questions = load_questions()
    selected = select_questions(questions, args.only, args.question_type)
    if not selected:
        raise SystemExit("no questions selected")
    logger.info("eval run starting", selected=len(selected), total=len(questions))
    needs_judge = any(question["type"] == "honesty" for question in selected)
    judge_agent = build_judge_agent(settings) if needs_judge else None
    runtime = await build_runtime(settings)
    results: list[dict[str, Any]] = []
    try:
        for question in selected:  # serial on purpose: one tool loop at a time
            logger.info("eval question", id=question["id"], type=question["type"])
            result = await run_question_safely(runtime, judge_agent, question)
            logger.info(
                "eval question done",
                id=result["id"],
                passed=result["passed"],
                duration_s=result["duration_s"],
            )
            results.append(result)
    finally:
        await runtime.aclose()
    write_reports(build_report(results, settings.model_counselor))
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(amain(parse_args())))


if __name__ == "__main__":
    main()
