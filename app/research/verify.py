"""The research_verify node — cross-check evidence with a PydanticAI agent.

Uses a cheap verifier model to produce a list[VerifiedClaim]. Each claim is
classified as: verified, conflict, unsupported, or sentiment_only.

Honesty rules enforced in the prompt:
- Reddit evidence → sentiment_only only (never numbers/dates/policy facts)
- Web cannot override DB/official without an explicit conflict status
- DB is authoritative for normalized history; official pages for current policy
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langgraph.config import get_stream_writer
from pydantic_ai import Agent

from app.research.caps import soft_timeout_hit
from app.research.llm import build_research_model
from app.research.models import VerifiedClaim
from app.research.steps import research_step
from app.research.usage import record_model_usage
from config.settings import get_settings

logger = logging.getLogger(__name__)

_VERIFY_SYSTEM = (
    "You are a fact-checking assistant for a college admissions counselor.\n\n"
    "Your job is to review a list of evidence items about schools and verify claims.\n\n"
    "Rules (STRICT):\n"
    "1. Reddit/community evidence → status 'sentiment_only' only. "
    "Never extract numbers, dates, or policy facts from Reddit.\n"
    "2. DB (database) evidence is authoritative for historical statistics. "
    "Never mark DB facts as 'conflict' unless a more recent official source contradicts it.\n"
    "3. Official .edu pages are authoritative for current-cycle policy (deadlines, requirements).\n"
    "4. Web/unofficial sources may support but CANNOT override DB or official sources "
    "unless you mark 'conflict'.\n"
    "5. Only mark 'verified' when multiple independent sources agree.\n"
    "6. Mark 'unsupported' for claims in only one source with no corroboration.\n\n"
    'Return a JSON array: [{"claim": str, "status": str, '
    '"support_markers": [str], "note": str|null}]'
)


def _build_evidence_text(
    db_evidence: list[Any],
    web_evidence: list[Any],
    max_claims: int,
) -> str:
    """Summarize evidence into a compact text for the verifier."""
    lines: list[str] = ["EVIDENCE:"]

    db_items = db_evidence[: _evidence_context_limit(max_claims, floor=30, multiplier=2)]
    if db_items:
        lines.append("\nDB (authoritative):")
        for item in db_items:
            if isinstance(item, dict):
                marker = item.get("marker", "")
                field = item.get("field_key") or item.get("label") or ""
                value = item.get("display") or item.get("value") or ""
                if field or value:
                    lines.append(f"  {marker} {field}: {value}")

    web_items = web_evidence[: _evidence_context_limit(max_claims, floor=60, multiplier=4)]
    if web_items:
        lines.append("\nWeb/Official/Reddit:")
        for item in web_items:
            if isinstance(item, dict):
                marker = item.get("marker", "")
                title = item.get("title", "")
                snippet = item.get("snippet", "")[:200]
                source = (item.get("citation") or {}).get("source", "web")
                lines.append(f"  {marker} [{source}] {title}: {snippet}")

    lines.append(f"\nExtract up to {max_claims} key claims and verify them.")
    return "\n".join(lines)


def _evidence_context_limit(max_claims: int, *, floor: int, multiplier: int) -> int:
    """Bound verifier context while avoiding first-school-only evidence slices."""
    return min(100, max(floor, max_claims * multiplier))


def _parse_verified_claims(raw: str, max_claims: int) -> list[VerifiedClaim]:
    """Parse verifier output into VerifiedClaim list. Lenient — never raises."""
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            claims = []
            for item in data[:max_claims]:
                try:
                    claims.append(VerifiedClaim.model_validate(item))
                except Exception:
                    continue
            return claims
    except Exception:
        pass
    return []


def _fallback_evidence_notes(
    db_evidence: list[Any],
    web_evidence: list[Any],
    max_claims: int,
) -> list[VerifiedClaim]:
    """Create conservative evidence notes when the verifier returns nothing.

    These are deliberately not "verified" claims. They keep the report grounded
    in registered sources while preserving the confidence boundary: a single
    official/web item is `unsupported`, and Reddit remains `sentiment_only`.
    """
    notes: list[VerifiedClaim] = []
    for item in [*db_evidence, *web_evidence]:
        if len(notes) >= max_claims:
            break
        if not isinstance(item, dict):
            continue
        marker = item.get("marker")
        if not isinstance(marker, str) or not marker.startswith("["):
            continue

        citation = item.get("citation") or {}
        source = citation.get("source") if isinstance(citation, dict) else None
        tier = citation.get("tier") if isinstance(citation, dict) else None
        title = str(item.get("title") or item.get("label") or "Source evidence").strip()
        snippet = _clean_note_text(item.get("snippet") or item.get("display") or item.get("value"))
        if not snippet:
            continue

        if source == "reddit" or tier == "community":
            notes.append(
                VerifiedClaim(
                    claim=f"Student/community sentiment source: {snippet}",
                    status="sentiment_only",
                    support_markers=[marker],
                    note=(
                        "Community source; use only as qualitative sentiment, "
                        "not policy or numbers."
                    ),
                )
            )
        else:
            notes.append(
                VerifiedClaim(
                    claim=f"{title}: {snippet}",
                    status="unsupported",
                    support_markers=[marker],
                    note=(
                        "Single-source evidence; cite as limited evidence, "
                        "not as independently verified."
                    ),
                )
            )
    return notes


def _clean_note_text(value: Any) -> str:
    """Compact a snippet/value for inclusion in verifier fallback notes."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text[:240]


async def research_verify_node(state: Any, deps: Any) -> dict[str, Any]:
    """Cross-check evidence and produce a list of verified claims."""
    settings = get_settings()
    writer = get_stream_writer()
    research = dict(state.get("research") or {})
    emissions = list(research.get("emissions") or [])

    db_evidence = list(research.get("db_evidence") or [])
    web_evidence = list(research.get("web_evidence") or [])
    max_claims = settings.deep_research_max_verified_claims

    research_step(writer, emissions, "verify", "running", "Cross-checking claims")

    verification: list[VerifiedClaim] = []
    if soft_timeout_hit(research, settings):
        research_step(writer, emissions, "verify", "complete", "Cross-checking claims")
        research["verification"] = []
        research["emissions"] = emissions
        return {"research": research}

    try:
        evidence_text = _build_evidence_text(db_evidence, web_evidence, max_claims)
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""

        verifier_model_str = settings.effective_model_research_verifier

        agent: Agent[None, str] = Agent(
            build_research_model(verifier_model_str, settings),
            system_prompt=_VERIFY_SYSTEM,
        )

        prompt = f"Question: {user_text}\n\n{evidence_text}\n\nReturn JSON array only."
        result = await agent.run(prompt)
        record_model_usage(
            research,
            result.usage,
            model_name=verifier_model_str,
            settings=settings,
        )
        raw_output = str(result.output)
        # Strip markdown fences if present.
        if "```" in raw_output:
            raw_output = raw_output.split("```")[1]
            if raw_output.startswith("json"):
                raw_output = raw_output[4:]
        verification = _parse_verified_claims(raw_output, max_claims)
        if not verification:
            verification = _fallback_evidence_notes(db_evidence, web_evidence, max_claims)
    except Exception:
        logger.warning("verification step failed — continuing without verification", exc_info=True)
        verification = _fallback_evidence_notes(db_evidence, web_evidence, max_claims)

    research_step(writer, emissions, "verify", "complete", "Cross-checking claims")

    research["verification"] = [c.model_dump(mode="json") for c in verification]
    research["emissions"] = emissions
    return {"research": research}
