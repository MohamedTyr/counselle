"""The research_synthesize node — stream the final cited report.

HIGHEST-RISK FILE: this node MUST return all terminal keys or sources/usage/
transcript silently break. The return contract mirrors app/agent_node.py:463-470.

Terminal keys required:
  messages, source_registry, usage, turn_records, pending_clarify, viz_emitted
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from langgraph.config import get_stream_writer
from pydantic_ai import Agent
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google_cloud import GoogleCloudProvider

from app.records import Emission, append_or_replace, build_turn_record
from app.research.models import ResearchCaps, VerifiedClaim
from app.research.steps import research_step
from app.sources import SourceRegistry
from app.turn_persistence import partial_messages, resolve_offset
from config.settings import get_settings
from domain.events import UsageData

logger = logging.getLogger(__name__)

_SYNTHESIZE_SYSTEM = (
    "You are an expert college admissions counselor writing a cited research report.\n\n"
    "You will be given:\n"
    "1. A student's question\n"
    "2. Verified claims from authoritative sources (DB, official pages, web)\n"
    "3. A list of available citation markers\n\n"
    "Write a clear, honest, well-organized report that:\n"
    "- Opens with a direct answer to the question\n"
    "- Uses inline citation markers like [1], [2] where relevant\n"
    "- Acknowledges data limitations and recency honestly\n"
    "- Separates verified facts from community sentiment\n"
    "- Never invents data — only cite what the evidence provides\n"
    "- If DB data is unavailable for some schools, say so explicitly\n"
    "- Ends with a brief summary or recommendation based on the evidence\n\n"
    "Format: flowing prose with headers (##) for major sections. Aim for 300-600 words."
)

_LIMITATION_NOTE = (
    "\n\n---\n*Note: This research ran under time constraints and may be incomplete. "
    "Verify key facts on the schools' official websites.*"
)


def _build_synthesis_prompt(
    user_text: str,
    verification: list[VerifiedClaim],
    caps: ResearchCaps,
    db_unavailable: bool,
    external_unavailable: bool,
) -> str:
    """Build the prompt for the synthesizer."""
    lines = [f"**Student question:** {user_text}\n"]

    if verification:
        lines.append("**Verified claims:**")
        for claim in verification:
            marker_str = " ".join(claim.support_markers)
            note_str = f" ({claim.note})" if claim.note else ""
            lines.append(f"- [{claim.status.upper()}] {claim.claim} {marker_str}{note_str}")
    else:
        lines.append("No claims were verified (evidence may be sparse).")

    if db_unavailable:
        lines.append("\n*Note: The Counselle database was unavailable for this query.*")
    if external_unavailable:
        lines.append("\n*Note: External search was unavailable; web sources may be missing.*")
    if caps.soft_timeout_hit:
        lines.append("\n*Note: Research hit the soft time limit; some sources may be missing.*")

    lines.append("\nWrite the report now. Use the citation markers from the verified claims.")
    return "\n".join(lines)


def _aggregate_usage(research: dict[str, Any], settings: Any) -> dict[str, Any]:
    """Aggregate token usage across all research LLM calls (best-effort)."""
    caps = research.get("caps") or {}
    return UsageData(
        input_tokens=0,
        output_tokens=0,
        tool_calls=0,
        est_cost_usd=float(caps.get("est_cost_usd") or 0.0),
    ).model_dump(mode="json")


async def research_synthesize_node(state: Any, deps: Any) -> dict[str, Any]:
    """Stream the final research report and return the complete terminal state."""
    settings = get_settings()
    writer = get_stream_writer()

    research = dict(state.get("research") or {})
    # Carry all emissions from prior research nodes into this node.
    emissions: list[Emission] = list(research.get("emissions") or [])

    registry = SourceRegistry(state.get("source_registry") or [])
    verification = [
        VerifiedClaim.model_validate(c) for c in (research.get("verification") or [])
    ]
    caps_dict = research.get("caps") or {}
    caps = ResearchCaps.model_validate(caps_dict)

    research_step(writer, emissions, "synthesize", "running", "Writing report")

    report_text = ""
    try:
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""

        smart_model_str = settings.effective_model_research_smart
        bare_model = smart_model_str.split(":", 1)[-1]

        if not settings.vertex_api_key:
            raise RuntimeError("COUNSELLE_VERTEX_API_KEY not set")

        synthesizer: Agent[None, str] = Agent(
            GoogleModel(
                bare_model,
                provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
            ),
            system_prompt=_SYNTHESIZE_SYSTEM,
        )

        prompt = _build_synthesis_prompt(
            user_text,
            verification,
            caps,
            db_unavailable=bool(caps_dict.get("db_unavailable")),
            external_unavailable=bool(caps_dict.get("external_unavailable")),
        )

        async with synthesizer.run_stream(prompt) as stream_result:
            async for chunk in stream_result.stream_text(delta=True):
                writer({"type": "delta", "text": chunk})
                emissions.append(("delta", chunk))
                report_text += chunk

        if caps.soft_timeout_hit:
            writer({"type": "delta", "text": _LIMITATION_NOTE})
            emissions.append(("delta", _LIMITATION_NOTE))
            report_text += _LIMITATION_NOTE

    except Exception:
        logger.warning("synthesis failed — emitting fallback message", exc_info=True)
        fallback = (
            "I encountered an issue generating the research report. "
            "Please try your question again or ask me directly."
        )
        writer({"type": "delta", "text": fallback})
        emissions.append(("delta", fallback))
        report_text = fallback

    research_step(writer, emissions, "synthesize", "complete", "Writing report")

    # --- TERMINAL RETURN CONTRACT (mirror agent_node.py:463-470) ---
    ids = state.get("turn_ids") or {}
    prior_records = list(state.get("turn_records") or [])
    messages = list(state.get("messages") or [])
    offset = resolve_offset(ids.get("messages_offset"), messages)

    updated_msgs, _ = partial_messages(messages, emissions)
    usage_dict = _aggregate_usage(research, settings)

    records = append_or_replace(
        prior_records,
        build_turn_record(
            emissions=emissions,
            ids=ids,
            status="complete",
            sources=registry.dump(),
            user_text=_extract_user_text(messages),
            usage=usage_dict,
            ts=datetime.now(UTC).isoformat(),
            messages_offset=offset,
            synthesized_answer=False,
        ),
    )

    return {
        "messages": updated_msgs,
        "source_registry": registry.dump(),
        "usage": usage_dict,
        "turn_records": records,
        "pending_clarify": None,
        "viz_emitted": [],
        "research": {**research, "emissions": emissions},
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
