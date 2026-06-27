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

import re
from datetime import UTC, datetime
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app.records import Emission, append_or_replace, build_turn_record
from app.research.models import ResearchCaps
from app.research.steps import research_step
from app.sources import SourceRegistry
from app.turn_persistence import partial_messages, resolve_offset
from config.settings import get_settings
from domain.events import UsageData
from domain.specs import ClarifyOption, ClarifySpec, SourceConfig

# Pattern to detect sentence-initial caps vs proper-noun caps.
_WORD_RE = re.compile(r"[A-Z][a-zA-Z&\-.']{2,}")


def _extract_user_text(messages: list[dict[str, Any]]) -> str:
    """Pull the last user prompt text from serialized messages."""
    for msg in reversed(messages):
        if msg.get("kind") != "request":
            continue
        for part in msg.get("parts") or []:
            if part.get("part_kind") == "user-prompt":
                return str(part.get("content") or "")
    return ""


def _parse_schools(text: str, max_schools: int) -> list[str]:
    """Heuristic: extract likely school names from user text.

    Returns up to max_schools distinct capitalized noun phrases found in
    positions that are not sentence-initial (positions > 0 in their sentence).
    This is intentionally conservative — the synthesis prompt will work with
    whatever is returned, and the plan summary shows the student what was found.
    """
    found: list[str] = []
    seen: set[str] = set()
    for match in _WORD_RE.finditer(text):
        name = match.group()
        if name not in seen:
            seen.add(name)
            found.append(name)
        if len(found) >= max_schools:
            break
    return found


def _format_plan_summary(schools: list[str], user_text: str) -> str:
    """Human-readable plan summary for the confirmation clarify."""
    if schools:
        school_list = ", ".join(schools) if len(schools) <= 3 else f"{', '.join(schools[:3])}, ..."
        return (
            f"I'll run a deep research pipeline on: {school_list}. "
            "This will search our database, official school sites, and the web, "
            "then verify and synthesize a cited report. This takes up to 90 seconds."
        )
    return (
        "I'll run a deep research pipeline based on your question. "
        "This will search our database, official school sites, and the web, "
        "then verify and synthesize a cited report. This takes up to 90 seconds."
    )


def _is_affirmative(answer: str) -> bool:
    """True when the resume answer signals the student wants to proceed."""
    lower = answer.lower().strip()
    cancel_signals = {"cancel", "no", "skip", "never mind", "nevermind", "stop"}
    return not any(s in lower for s in cancel_signals)


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

    schools = _parse_schools(user_text, settings.deep_research_max_schools)
    source_config = SourceConfig.model_validate(state.get("source_config") or {})
    plan = {
        "schools": schools,
        "source_config": source_config.model_dump(mode="json"),
        "user_text": user_text,
    }
    plan_summary = _format_plan_summary(schools, user_text)

    answer = interrupt(
        ClarifySpec(
            question=plan_summary,
            header="Deep research",
            multi_select=False,
            options=[
                ClarifyOption(label="Run deep research", hint="Start the full research pipeline"),
                ClarifyOption(label="Cancel", hint="Get a quick answer instead"),
            ],
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
