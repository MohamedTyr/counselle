"""The research_synthesize node — stream the final cited report.

HIGHEST-RISK FILE: this node MUST return all terminal keys or sources/usage/
transcript silently break. The return contract mirrors app/agent_node.py:463-470.

Terminal keys required:
  messages, source_registry, usage, turn_records, pending_clarify, viz_emitted
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from langgraph.config import get_stream_writer
from pydantic_ai import Agent

from app.records import Emission, append_or_replace, build_turn_record
from app.research.caps import remaining_time_seconds, soft_timeout_hit
from app.research.llm import build_research_model
from app.research.models import ResearchCaps, VerifiedClaim
from app.research.steps import research_step
from app.research.usage import aggregate_usage, record_model_usage
from app.sources import SourceRegistry
from app.turn_persistence import partial_messages, resolve_offset
from config.settings import get_settings

logger = logging.getLogger(__name__)

_SYNTHESIZE_SYSTEM = (
    "You are an expert college admissions counselor writing a cited research report.\n\n"
    "You will be given:\n"
    "1. A student's question\n"
    "2. Evidence notes from authoritative sources (DB, official pages, web)\n"
    "3. A list of available citation markers\n\n"
    "Write a clear, honest, well-organized report that:\n"
    "- Opens with a direct answer to the question, not a process recap\n"
    "- Starts with an evidence coverage sentence when requested schools/topics are missing\n"
    "- For comparisons, use short school/topic bullet sections. Do not use markdown tables.\n"
    "- Uses inline citation markers like [1], [2] for every sourced factual statement\n"
    "- Acknowledges data limitations and recency honestly\n"
    "- Separates verified facts from community sentiment\n"
    "- Never invents data — only cite what the evidence provides\n"
    "- Treat status UNSUPPORTED as limited single-source evidence, not proven fact\n"
    "- Treat status SENTIMENT_ONLY as qualitative community signal only; never repeat "
    "numbers, dates, or policy requirements from those notes\n"
    "- Do not include a memo/report date unless the prompt explicitly gives one\n"
    "- If evidence is unavailable for some schools or topics, say exactly which ones are missing\n"
    "- Do not end with a generic 'consult websites' cop-out; give targeted next checks instead\n"
    "- Ends with a brief recommendation based only on verified evidence\n\n"
    "Format: markdown with ## sections. Prefer these sections when applicable: "
    "Bottom line, Evidence coverage, Comparison, Unknowns, Next checks. "
    "Aim for 300-650 words."
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
    today: str | None = None,
) -> str:
    """Build the prompt for the synthesizer."""
    lines = [f"**Student question:** {user_text}\n"]
    if today:
        lines.append(f"**Today:** {today}")

    if verification:
        lines.append("**Evidence notes:**")
        for claim in verification:
            marker_str = " ".join(claim.support_markers)
            note_str = f" ({claim.note})" if claim.note else ""
            lines.append(f"- [{claim.status.upper()}] {claim.claim} {marker_str}{note_str}")
    else:
        lines.append("No evidence notes were available after retrieval and verification.")

    if db_unavailable:
        lines.append("\n*Note: The Counselle database was unavailable for this query.*")
    if external_unavailable:
        lines.append("\n*Note: External search was unavailable; web sources may be missing.*")
    if caps.soft_timeout_hit:
        lines.append("\n*Note: Research hit the soft time limit; some sources may be missing.*")
    if caps.verification_unavailable:
        lines.append(
            "\n*Note: Automated cross-checking did not complete "
            f"({caps.verification_unavailable}); treat the evidence notes as "
            "conservative source-grounded notes, not fully verified claims.*"
        )

    lines.append(
        "\nWrite the report now. Use the citation markers from the evidence notes. "
        "When a note is UNSUPPORTED, phrase it as limited single-source evidence. "
        "When verification was unavailable, state that limitation in the evidence "
        "coverage section. "
        "Do not say no evidence was provided if evidence notes are listed. "
        "If the requested comparison cannot be completed, still organize the answer "
        "around the requested schools/topics and mark missing items explicitly. "
        "Do not use markdown tables."
    )
    return "\n".join(lines)


def _build_partial_report(
    user_text: str,
    verification: list[VerifiedClaim],
    *,
    db_unavailable: bool,
    external_unavailable: bool,
    reason: str,
) -> str:
    """Deterministic clean fallback when synthesis cannot finish."""
    intro = _partial_intro(reason)
    lines = [
        "## Partial report",
        "",
        intro,
        "",
        "## Question",
        "",
        user_text or "Deep research request",
        "",
    ]

    if verification:
        lines.extend(["## What I could support", ""])
        for claim in verification[:12]:
            lines.append(f"- {_claim_summary(claim)}")
        lines.append("")
    else:
        lines.extend(
            [
                "## What I could support",
                "",
                "- No verified evidence notes were available before the write-up stopped.",
                "",
            ]
        )

    unknowns = _partial_unknowns(
        db_unavailable=db_unavailable,
        external_unavailable=external_unavailable,
        reason=reason,
    )
    lines.extend(["## Still incomplete", ""])
    lines.extend(f"- {item}" for item in unknowns)
    lines.extend(
        [
            "",
            "## Next check",
            "",
            _partial_next_check(reason),
        ]
    )
    return "\n".join(lines)


def _partial_intro(reason: str) -> str:
    lower = reason.lower()
    if "time" in lower or "budget" in lower:
        return (
            "I could not finish the full write-up before the time limit, but I did "
            "preserve the evidence checked so far. Treat this as partial, not a "
            "complete comparison."
        )
    return (
        "I could not finish the full write-up in this run, but I did preserve "
        "the evidence checked so far. Treat this as partial, not a complete "
        "comparison."
    )


def _partial_next_check(reason: str) -> str:
    lower = reason.lower()
    if "model" in lower or "quota" in lower or "httperror" in lower:
        return (
            "Retry after the model provider quota or availability issue clears, "
            "or ask for one narrower slice such as test policy only or financial aid only."
        )
    return (
        "Run the same research again with a larger time budget, or ask for one "
        "narrower slice such as test policy only or financial aid only."
    )


def _claim_summary(claim: VerifiedClaim) -> str:
    marker_text = " ".join(claim.support_markers)
    prefix = {
        "verified": "Verified",
        "conflict": "Conflict",
        "unsupported": "Limited evidence",
        "sentiment_only": "Student sentiment",
    }[claim.status]
    note = f" ({claim.note})" if claim.note else ""
    return f"{prefix}: {claim.claim} {marker_text}{note}".strip()


def _partial_unknowns(
    *,
    db_unavailable: bool,
    external_unavailable: bool,
    reason: str,
) -> list[str]:
    unknowns = [reason]
    if db_unavailable:
        unknowns.append("Counselle database evidence was unavailable for this run.")
    if external_unavailable:
        unknowns.append("External source retrieval was unavailable or incomplete.")
    if len(unknowns) == 1:
        unknowns.append("Some school/topic comparisons may still be missing.")
    return unknowns


def _aggregate_usage(research: dict[str, Any], settings: Any) -> dict[str, Any]:
    """Aggregate token usage across all research LLM calls (best-effort)."""
    return aggregate_usage(research)


async def research_synthesize_node(state: Any, deps: Any) -> dict[str, Any]:
    """Write the final research report and return the complete terminal state."""
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

    research_step(writer, emissions, "synthesize", "running", "Writing your report")

    report_text = ""
    try:
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""

        smart_model_str = settings.effective_model_research_smart

        prompt = _build_synthesis_prompt(
            user_text,
            verification,
            caps,
            db_unavailable=bool(caps_dict.get("db_unavailable")),
            external_unavailable=bool(caps_dict.get("external_unavailable")),
            today=(state.get("temporal") or {}).get("today"),
        )

        timeout_s = remaining_time_seconds(
            research,
            float(settings.deep_research_max_wall_clock_s),
            reserve_s=8,
            cap_s=35,
        )
        timed_out = soft_timeout_hit(research, settings)
        if timeout_s < 8 or timed_out:
            report_text = _build_partial_report(
                user_text,
                verification,
                db_unavailable=bool(caps_dict.get("db_unavailable")),
                external_unavailable=bool(caps_dict.get("external_unavailable")),
                reason="The research run used its time budget before the final write-up finished.",
            )
        else:
            synthesizer: Agent[None, str] = Agent(
                build_research_model(smart_model_str, settings),
                system_prompt=_SYNTHESIZE_SYSTEM,
            )
            result = await asyncio.wait_for(synthesizer.run(prompt), timeout=timeout_s)
            report_text = str(result.output)
            record_model_usage(
                research,
                result.usage,
                model_name=smart_model_str,
                settings=settings,
            )

        if timed_out:
            report_text += _LIMITATION_NOTE

        writer({"type": "delta", "text": report_text})
        emissions.append(("delta", report_text))

    except Exception as exc:
        logger.warning("synthesis failed — emitting partial report", exc_info=True)
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""
        report_text = _build_partial_report(
            user_text,
            verification,
            db_unavailable=bool(caps_dict.get("db_unavailable")),
            external_unavailable=bool(caps_dict.get("external_unavailable")),
            reason=f"The final write-up stopped before completion ({type(exc).__name__}).",
        )
        writer({"type": "delta", "text": report_text})
        emissions.append(("delta", report_text))

    research_step(writer, emissions, "synthesize", "complete", "Writing your report")

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
