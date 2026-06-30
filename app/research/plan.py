"""The research_plan node — scope resolution + user confirmation gate.

Responsibilities:
1. Extract user text from messages.
2. Heuristically parse school names (capped at deep_research_max_schools).
3. Set started_at in caps.
4. Emit "Planning research" step.
5. Interrupt with a confirmation ClarifySpec showing the plan.
6. On resume: branch="run" (affirmative) or "cancel" (declined).
7. Cancel path returns all terminal keys so run_turn emits sources/usage/done.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.types import interrupt
from pydantic_ai import Agent

from app.records import Emission, append_or_replace, build_turn_record
from app.research.llm import build_research_model
from app.research.models import ResearchCaps
from app.research.steps import research_step
from app.research.usage import record_model_usage
from app.sources import SourceRegistry
from app.turn_persistence import partial_messages, resolve_offset
from config.settings import get_settings, load_yaml_asset
from counselle_db.models import ResolveMatch
from counselle_db.service import resolve_school
from domain.events import UsageData
from domain.specs import (
    ClarifyOption,
    ClarifySpec,
    ResearchPlanSpec,
    ResearchPlanTask,
    SourceConfig,
)

# Proper-noun-ish spans. Candidates are verified against the DB before use, so
# capitalized filler like "Keep" never becomes a school in the confirmation UI.
_SCHOOL_SPAN_RE = re.compile(
    r"\b[A-Z][A-Za-z&'.-]{2,}(?:\s+(?:of|and|at|&|[A-Z][A-Za-z&'.-]{2,}))*"
)
_SCHOOL_CONNECTOR_SPLIT_RE = re.compile(r"\s+(?:and|or|vs\.?|versus)\s+", re.IGNORECASE)
_NON_SCHOOL_CANDIDATES = frozenset(
    {
        "Compare",
        "Comparison",
        "Deep",
        "Give",
        "Keep",
        "Please",
        "Research",
    }
)
_PLANNER_TIMEOUT_S = 12
_MAX_PLAN_TASKS = 6
_MIN_SCOPE_SIGNALS = 2

_PLANNER_SYSTEM = (
    "You plan bounded college-admissions research runs.\n"
    "Return one JSON object only, with keys: summary, schools, topics, tasks, "
    "source_policy, limitations, max_runtime_seconds.\n"
    "Rules:\n"
    "- Use only the resolved school names provided by the prompt.\n"
    "- Use only enabled sources. DB/Counselle data is always enabled.\n"
    "- Do not claim facts have already been found.\n"
    "- Make tasks specific to the student's question, not generic pipeline phases.\n"
    "- Reddit is qualitative sentiment only, never policy, dates, or numbers.\n"
    "- Include exact search queries for external tasks; "
    "DB-only tasks can use an empty queries list.\n"
    "- Keep 3-6 tasks, each with label, reason, sources, queries.\n"
)

_BROAD_RESEARCH_TERMS = frozenset(
    {
        "college",
        "colleges",
        "school",
        "schools",
        "universities",
        "university",
        "options",
        "list",
        "matches",
    }
)
_SCOPE_SIGNAL_TERMS = {
    "aid": ("aid", "financial", "scholarship", "cost", "budget", "afford"),
    "major": (
        "major",
        "program",
        "computer science",
        " cs ",
        "engineering",
        "business",
        "premed",
        "pre-med",
        "biology",
        "economics",
    ),
    "applicant": ("international", "domestic", "transfer", "first-year", "freshman"),
    "region": (
        "midwest",
        "northeast",
        "south",
        "west coast",
        "california",
        "new york",
        "texas",
        "urban",
        "rural",
        "suburban",
    ),
    "policy": ("test", "sat", "act", "deadline", "policy", "optional", "requirement"),
    "selectivity": ("safety", "target", "reach", "selective", "acceptance", "admit"),
}


def _extract_user_text(messages: list[dict[str, Any]]) -> str:
    """Pull the last user prompt text from serialized messages."""
    for msg in reversed(messages):
        if msg.get("kind") != "request":
            continue
        for part in msg.get("parts") or []:
            if part.get("part_kind") == "user-prompt":
                return str(part.get("content") or "")
    return ""


def _candidate_school_mentions(text: str) -> list[str]:
    """Likely school mentions, including configured abbreviations."""
    candidates: list[str] = []
    seen: set[str] = set()

    abbreviations: dict[str, str] = load_yaml_asset("abbreviations")
    abbreviation_keys = {alias.lower() for alias in abbreviations}
    for alias in sorted(abbreviations, key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", text):
            seen.add(alias.lower())
            candidates.append(alias)

    for match in _SCHOOL_SPAN_RE.finditer(text):
        name = match.group().strip()
        for candidate in [name, *_SCHOOL_CONNECTOR_SPLIT_RE.split(name)]:
            candidate = candidate.strip()
            key = candidate.lower()
            if (
                candidate
                and candidate not in _NON_SCHOOL_CANDIDATES
                and key not in seen
                and not _unconfigured_acronym(candidate, abbreviation_keys)
            ):
                seen.add(key)
                candidates.append(candidate)
    return candidates


def _unconfigured_acronym(candidate: str, abbreviation_keys: set[str]) -> bool:
    """Reject test/policy acronyms while preserving configured school aliases."""
    compact = re.sub(r"[^A-Za-z]", "", candidate)
    return (
        bool(compact)
        and compact.isupper()
        and len(compact) <= 4
        and candidate.lower() not in abbreviation_keys
    )


async def _parse_schools(text: str, max_schools: int, deps: Any) -> list[str]:
    """Resolve likely school mentions against the database before showing them."""
    found: list[str] = []
    seen: set[str] = set()
    for candidate in _candidate_school_mentions(text):
        result = await resolve_school(deps.catalog, candidate)
        if not isinstance(result, ResolveMatch):
            continue
        name = result.school.name
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(name)
        if len(found) >= max_schools:
            break
    return found


def _format_plan_summary(
    schools: list[str],
    source_config: SourceConfig,
    max_wall_clock_s: int,
) -> str:
    """Human-readable plan summary for the confirmation clarify."""
    external_sources: list[str] = []
    if source_config.edu:
        external_sources.append("official school sites")
    if source_config.web:
        external_sources.append("the web")
    if source_config.reddit:
        external_sources.append("Reddit sentiment")
    if external_sources:
        source_text = "Counselle data plus " + ", ".join(external_sources)
    else:
        source_text = "Counselle data only"

    if schools:
        school_list = ", ".join(schools) if len(schools) <= 3 else f"{', '.join(schools[:3])}, ..."
        return (
            f"I'll run deep research for {school_list}. "
            f"Sources enabled: {source_text}. "
            "I'll verify the evidence and write a cited report. "
            f"This can take up to {max_wall_clock_s} seconds."
        )
    return (
        "I'll run deep research based on your question. "
        f"Sources enabled: {source_text}. "
        "I'll verify the evidence and write a cited report. "
        f"This can take up to {max_wall_clock_s} seconds."
    )


def _scope_signal_count(text: str) -> int:
    """Count materially useful constraints for a school-less research request."""
    normalized = f" {text.lower()} "
    return sum(
        1
        for terms in _SCOPE_SIGNAL_TERMS.values()
        if any(term in normalized for term in terms)
    )


def _needs_scope_clarification(user_text: str, schools: list[str]) -> bool:
    """True when research would be too broad to run honestly without more scope."""
    if schools:
        return False
    normalized = user_text.lower()
    has_broad_target = any(term in normalized for term in _BROAD_RESEARCH_TERMS)
    if not has_broad_target:
        return False
    return _scope_signal_count(user_text) < _MIN_SCOPE_SIGNALS


def _scope_clarify_spec(max_schools: int) -> ClarifySpec:
    return ClarifySpec(
        question=(
            "Deep research needs a narrower scope before I run it. Type up to "
            f"{max_schools} schools, or give constraints like major, applicant type, "
            "aid need, region, and current policy question."
        ),
        header="Research scope",
        multi_select=False,
        options=[
            ClarifyOption(
                label="Answer normally",
                hint="Skip deep research and give a quick answer.",
            ),
            ClarifyOption(
                label="Cancel",
                hint="Do not run deep research.",
            ),
        ],
    )


def _augment_user_text_with_scope(user_text: str, scope_answer: str) -> str:
    answer = scope_answer.strip()
    if not answer:
        return user_text
    return f"{user_text}\n\nScope details from student: {answer}"


def _declines_scope_research(answer: str) -> bool:
    normalized = answer.strip().lower()
    return normalized in {"answer normally", "cancel", "no", "skip", "stop"}


def _is_affirmative(answer: str) -> bool:
    """True when the resume answer signals the student wants to proceed."""
    lower = answer.lower().strip()
    cancel_signals = {"cancel", "no", "skip", "never mind", "nevermind", "stop"}
    return not any(s in lower for s in cancel_signals)


def _enabled_sources(source_config: SourceConfig) -> set[str]:
    sources = {"db"}
    if source_config.edu:
        sources.add("official")
    if source_config.web:
        sources.add("web")
    if source_config.reddit:
        sources.add("reddit")
    return sources


def _source_policy(source_config: SourceConfig) -> list[str]:
    policy = ["Counselle database for normalized school facts first."]
    if source_config.edu:
        policy.append("Official school sources for current policies and deadlines.")
    if source_config.web:
        policy.append("Open web only as supporting context when better sources are missing.")
    if source_config.reddit:
        policy.append("Reddit only for qualitative student sentiment, never factual policy claims.")
    return policy


def _fallback_topics(user_text: str, schools: list[str]) -> list[str]:
    """Cheap fallback only when model planning is unavailable."""
    lowered = user_text.lower()
    topics: list[str] = []
    for label, needles in [
        ("Admissions competitiveness", ("admission", "acceptance", "chances")),
        ("Financial aid and affordability", ("aid", "financial", "cost", "scholarship")),
        ("Testing policy", ("test", "sat", "act", "optional")),
        ("Program fit", ("program", "major", "computer science", "cs")),
        ("Student sentiment", ("reddit", "student", "sentiment", "campus")),
    ]:
        if any(needle in lowered for needle in needles):
            topics.append(label)
    if not topics:
        topics.append("Question-specific evidence")
    if len(schools) > 1 and "School comparison" not in topics:
        topics.insert(0, "School comparison")
    return topics[:6]


def _fallback_plan(
    user_text: str,
    schools: list[str],
    source_config: SourceConfig,
    max_wall_clock_s: int,
) -> ResearchPlanSpec:
    """Honest deterministic plan when the model planner is unavailable."""
    school_text = ", ".join(schools) if schools else "the schools or topic in your question"
    topics = _fallback_topics(user_text, schools)
    enabled = _enabled_sources(source_config)
    tasks = [
        ResearchPlanTask(
            label=f"Check Counselle data for {school_text}",
            reason="Use normalized institutional data before external sources.",
            sources=["db"],
            queries=[],
        )
    ]
    if "official" in enabled:
        tasks.append(
            ResearchPlanTask(
                label="Check official admissions and aid pages",
                reason="Current policies should come from school-owned sources when possible.",
                sources=["official"],
                queries=[f"{school} admissions financial aid test policy" for school in schools]
                or [user_text],
            )
        )
    if "web" in enabled:
        tasks.append(
            ResearchPlanTask(
                label="Search supporting web context",
                reason=(
                    "Use recent public context only where official or DB evidence is incomplete."
                ),
                sources=["web"],
                queries=[user_text],
            )
        )
    if "reddit" in enabled:
        tasks.append(
            ResearchPlanTask(
                label="Check student sentiment separately",
                reason="Community sources can surface lived experience, not verified policy facts.",
                sources=["reddit"],
                queries=[user_text],
            )
        )
    return ResearchPlanSpec(
        summary=f"Research {school_text} for: {', '.join(topics)}.",
        planner="fallback",
        planner_note=(
            "The model planner was unavailable, so this is a bounded source-gated "
            "fallback plan."
        ),
        schools=schools,
        topics=topics,
        tasks=tasks[:_MAX_PLAN_TASKS],
        source_policy=_source_policy(source_config),
        limitations=[
            "The run is bounded; unresolved or unsupported claims will be labeled as such."
        ],
        max_runtime_seconds=max_wall_clock_s,
    )


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            candidate = part.strip()
            if candidate.startswith("json"):
                candidate = candidate[4:].strip()
            if candidate.startswith("{") and candidate.endswith("}"):
                text = candidate
                break
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _sanitize_plan(
    data: dict[str, Any],
    *,
    user_text: str,
    schools: list[str],
    source_config: SourceConfig,
    max_wall_clock_s: int,
) -> ResearchPlanSpec:
    enabled = _enabled_sources(source_config)
    base = ResearchPlanSpec.model_validate(data)
    tasks: list[ResearchPlanTask] = []
    for task in base.tasks[:_MAX_PLAN_TASKS]:
        sources = [source for source in task.sources if source in enabled]
        if not sources:
            sources = ["db"]
        tasks.append(
            ResearchPlanTask(
                label=task.label.strip(),
                reason=task.reason.strip(),
                sources=sources,
                queries=[q.strip() for q in task.queries if q.strip()][:4],
            )
        )
    if not tasks:
        return _fallback_plan(user_text, schools, source_config, max_wall_clock_s)
    return ResearchPlanSpec(
        summary=base.summary.strip(),
        planner="model",
        planner_note=None,
        schools=schools,
        topics=[topic.strip() for topic in base.topics if topic.strip()][:6]
        or _fallback_topics(user_text, schools),
        tasks=tasks,
        source_policy=_source_policy(source_config),
        limitations=[item.strip() for item in base.limitations if item.strip()][:4],
        max_runtime_seconds=max_wall_clock_s,
    )


async def _model_plan(
    *,
    user_text: str,
    schools: list[str],
    source_config: SourceConfig,
    max_wall_clock_s: int,
    today: str | None,
    settings: Any,
    research: dict[str, Any],
) -> ResearchPlanSpec | None:
    try:
        model_setting = settings.effective_model_research_fast
        agent: Agent[None, ResearchPlanSpec] = Agent(
            build_research_model(model_setting, settings),
            output_type=ResearchPlanSpec,
            system_prompt=_PLANNER_SYSTEM,
        )
        enabled = sorted(_enabled_sources(source_config))
        prompt = (
            f"Today: {today or 'unknown'}\n"
            f"Student question: {user_text}\n"
            f"Resolved schools: {schools}\n"
            f"Enabled sources: {enabled}\n"
            f"Max runtime seconds: {max_wall_clock_s}\n"
        )
        result = await asyncio.wait_for(agent.run(prompt), timeout=_PLANNER_TIMEOUT_S)
        record_model_usage(research, result.usage, model_name=model_setting, settings=settings)
        data = result.output.model_dump(mode="json")
        return _sanitize_plan(
            data,
            user_text=user_text,
            schools=schools,
            source_config=source_config,
            max_wall_clock_s=max_wall_clock_s,
        )
    except Exception:
        return None


async def _build_research_plan(
    *,
    user_text: str,
    schools: list[str],
    source_config: SourceConfig,
    max_wall_clock_s: int,
    today: str | None,
    settings: Any,
    research: dict[str, Any],
) -> ResearchPlanSpec:
    model_plan = await _model_plan(
        user_text=user_text,
        schools=schools,
        source_config=source_config,
        max_wall_clock_s=max_wall_clock_s,
        today=today,
        settings=settings,
        research=research,
    )
    if model_plan is not None:
        return model_plan
    return _fallback_plan(user_text, schools, source_config, max_wall_clock_s)


async def research_plan_node(state: Any, deps: Any) -> dict[str, Any]:
    """Resolve scope, confirm with the student, then branch run or cancel."""
    settings = get_settings()
    writer = get_stream_writer()

    research = dict(state.get("research") or {})
    emissions: list[Emission] = list(research.get("emissions") or [])

    messages = list(state.get("messages") or [])
    user_text = _extract_user_text(messages)

    # Initialize caps with start time.
    caps = ResearchCaps(started_at=datetime.now(UTC).isoformat())
    research["caps"] = caps.model_dump(mode="json")

    research_step(writer, emissions, "planning", "running", "Planning research")

    source_config = SourceConfig.model_validate(state.get("source_config") or {})
    schools = await _parse_schools(user_text, settings.deep_research_max_schools, deps)

    if _needs_scope_clarification(user_text, schools):
        scope_answer = str(
            interrupt(_scope_clarify_spec(settings.deep_research_max_schools).model_dump(mode="json"))
        )
        if _declines_scope_research(scope_answer):
            return _cancel_path(state, writer, emissions, research, messages, user_text)
        user_text = _augment_user_text_with_scope(user_text, scope_answer)
        schools = await _parse_schools(user_text, settings.deep_research_max_schools, deps)

    today = (state.get("temporal") or {}).get("today")
    research_plan = await _build_research_plan(
        user_text=user_text,
        schools=schools,
        source_config=source_config,
        max_wall_clock_s=settings.deep_research_max_wall_clock_s,
        today=today,
        settings=settings,
        research=research,
    )
    plan = {
        "schools": schools,
        "source_config": source_config.model_dump(mode="json"),
        "user_text": user_text,
        "research_plan": research_plan.model_dump(mode="json"),
    }
    plan_summary = _format_plan_summary(
        schools,
        source_config,
        settings.deep_research_max_wall_clock_s,
    )

    answer = interrupt(
        ClarifySpec(
            question=plan_summary,
            header="Deep research",
            multi_select=False,
            options=[
                ClarifyOption(label="Run deep research", hint="Start the full research pipeline"),
                ClarifyOption(label="Cancel", hint="Get a quick answer instead"),
            ],
            research_plan=research_plan,
        ).model_dump(mode="json")
    )

    research_step(writer, emissions, "planning", "complete", "Planning research")

    affirmative = _is_affirmative(str(answer))

    if not affirmative:
        return _cancel_path(state, writer, emissions, research, messages, user_text)

    research["plan"] = plan
    research["branch"] = "run"
    research["emissions"] = emissions
    return {"research": research}


def _cancel_path(
    state: dict[str, Any],
    writer: Any,
    emissions: list[Emission],
    research: dict[str, Any],
    messages: list[dict[str, Any]],
    user_text: str,
) -> dict[str, Any]:
    """Cancel branch — must return ALL terminal keys so run_turn emits cleanly."""
    cancel_text = (
        "Okay — I won't run deep research. Here's a quick take based on what I know:\n\n"
        "Feel free to ask me a specific question and I'll answer from our database "
        "and available sources."
    )
    writer({"type": "delta", "text": cancel_text})
    emissions.append(("delta", cancel_text))

    ids = state.get("turn_ids") or {}
    prior_records = list(state.get("turn_records") or [])
    offset = resolve_offset(ids.get("messages_offset"), messages)

    updated_msgs, _ = partial_messages(messages, emissions)

    usage_dict = UsageData(
        input_tokens=0,
        output_tokens=0,
        tool_calls=0,
    ).model_dump(mode="json")

    records = append_or_replace(
        prior_records,
        build_turn_record(
            emissions=emissions,
            ids=ids,
            status="complete",
            sources=[],
            user_text=user_text,
            usage=usage_dict,
            ts=datetime.now(UTC).isoformat(),
            messages_offset=offset,
        ),
    )

    registry = SourceRegistry([])

    return {
        "messages": updated_msgs,
        "source_registry": registry.dump(),
        "usage": usage_dict,
        "turn_records": records,
        "pending_clarify": None,
        "viz_emitted": [],
        "research": {**research, "branch": "cancel", "emissions": emissions},
    }
