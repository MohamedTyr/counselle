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
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google_cloud import GoogleCloudProvider

from app.research.models import VerifiedClaim
from app.research.steps import research_step
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

    db_items = db_evidence[:20]
    if db_items:
        lines.append("\nDB (authoritative):")
        for item in db_items:
            if isinstance(item, dict):
                marker = item.get("marker", "")
                field = item.get("field_key") or item.get("label") or ""
                value = item.get("display") or item.get("value") or ""
                if field or value:
                    lines.append(f"  {marker} {field}: {value}")

    web_items = web_evidence[:20]
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


async def research_verify_node(state: Any, deps: Any) -> dict[str, Any]:
    """Cross-check evidence and produce a list of verified claims."""
    settings = get_settings()
    writer = get_stream_writer()
    research = dict(state.get("research") or {})
    emissions = list(research.get("emissions") or [])

    db_evidence = list(research.get("db_evidence") or [])
    web_evidence = list(research.get("web_evidence") or [])
    max_claims = settings.deep_research_max_verified_claims

    research_step(writer, emissions, "verify", "running", "Verifying evidence")

    verification: list[VerifiedClaim] = []
    try:
        evidence_text = _build_evidence_text(db_evidence, web_evidence, max_claims)
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""

        verifier_model_str = settings.effective_model_research_verifier
        bare_model = verifier_model_str.split(":", 1)[-1]

        if not settings.vertex_api_key:
            raise RuntimeError("COUNSELLE_VERTEX_API_KEY not set")

        agent: Agent[None, str] = Agent(
            GoogleModel(
                bare_model,
                provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
            ),
            system_prompt=_VERIFY_SYSTEM,
        )

        prompt = f"Question: {user_text}\n\n{evidence_text}\n\nReturn JSON array only."
        result = await agent.run(prompt)
        raw_output = str(result.output)
        # Strip markdown fences if present.
        if "```" in raw_output:
            raw_output = raw_output.split("```")[1]
            if raw_output.startswith("json"):
                raw_output = raw_output[4:]
        verification = _parse_verified_claims(raw_output, max_claims)
    except Exception:
        logger.warning("verification step failed — continuing without verification", exc_info=True)

    research_step(writer, emissions, "verify", "complete", "Verifying evidence")

    research["verification"] = [c.model_dump(mode="json") for c in verification]
    research["emissions"] = emissions
    return {"research": research}
