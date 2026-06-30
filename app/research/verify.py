"""The research_verify node — cross-check evidence with a PydanticAI agent.

Uses a cheap verifier model to produce a list[VerifiedClaim]. Each claim is
classified as: verified, conflict, unsupported, or sentiment_only.

Honesty rules enforced in the prompt:
- Reddit evidence → sentiment_only only (never numbers/dates/policy facts)
- Web cannot override DB/official without an explicit conflict status
- DB is authoritative for normalized history; official pages for current policy
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from langgraph.config import get_stream_writer
from pydantic_ai import Agent

from app.research.caps import remaining_time_seconds, soft_timeout_hit
from app.research.llm import build_research_model
from app.research.models import VerifiedClaim
from app.research.steps import ResearchStepStatus, research_step
from app.research.usage import record_model_usage
from config.settings import get_settings

logger = logging.getLogger(__name__)

_VERIFY_SYSTEM = (
    "You are a fact-checking assistant for a college admissions counselor.\n\n"
    "Your job is to review a list of evidence items about schools and verify claims.\n\n"
    "Rules (STRICT):\n"
    "1. Reddit evidence → status 'sentiment_only' only. "
    "Never extract numbers, dates, or policy facts from Reddit.\n"
    "2. DB (database) evidence is authoritative for historical statistics. "
    "Never mark DB facts as 'conflict' unless a more recent official source contradicts it.\n"
    "3. Official .edu pages are authoritative for current-cycle policy (deadlines, requirements).\n"
    "4. Web/unofficial sources may support but CANNOT override DB or official sources "
    "unless you mark 'conflict'.\n"
    "5. Only mark 'verified' when multiple independent sources agree.\n"
    "6. Mark 'unsupported' for claims in only one source with no corroboration.\n\n"
    "7. Every returned claim must include at least one support_marker copied "
    "exactly from the evidence. Omit claims that have no marker.\n\n"
    'Return a JSON array: [{"claim": str, "status": str, '
    '"support_markers": [str], "note": str|null}]'
)

_MARKER_RE = re.compile(r"^\[\d+\]$")


def _build_evidence_text(
    db_evidence: list[Any],
    web_evidence: list[Any],
    max_claims: int,
    schools: list[str] | None = None,
) -> str:
    """Summarize evidence into a compact text for the verifier."""
    lines: list[str] = ["EVIDENCE:"]

    db_items = _balanced_evidence_items(
        db_evidence,
        _evidence_context_limit(max_claims, floor=30, multiplier=2),
        schools,
    )
    if db_items:
        lines.append("\nDB (authoritative):")
        for item in db_items:
            marker = item.get("marker", "")
            field = item.get("field_key") or item.get("label") or ""
            value = item.get("display") or item.get("value") or ""
            if field or value:
                lines.append(f"  {_evidence_prefix(item, marker, schools)} {field}: {value}")

    web_items = _balanced_evidence_items(
        web_evidence,
        _evidence_context_limit(max_claims, floor=60, multiplier=4),
        schools,
    )
    if web_items:
        lines.append("\nWeb/Official/Reddit:")
        for item in web_items:
            marker = item.get("marker", "")
            title = item.get("title", "")
            snippet = _clean_note_text(item.get("snippet"))[:220]
            lines.append(f"  {_evidence_prefix(item, marker, schools)} {title}: {snippet}")

    lines.append(f"\nExtract up to {max_claims} key claims and verify them.")
    return "\n".join(lines)


def _evidence_context_limit(max_claims: int, *, floor: int, multiplier: int) -> int:
    """Bound verifier context while avoiding first-school-only evidence slices."""
    return min(100, max(floor, max_claims * multiplier))


def _parse_verified_claims(
    raw: str,
    max_claims: int,
    allowed_markers: set[str],
) -> list[VerifiedClaim]:
    """Parse verifier output into VerifiedClaim list. Lenient — never raises."""
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            claims: list[VerifiedClaim] = []
            for item in data:
                if len(claims) >= max_claims:
                    break
                if not isinstance(item, dict):
                    continue
                markers = _valid_support_markers(item.get("support_markers"), allowed_markers)
                if not markers:
                    continue
                try:
                    item = {**item, "support_markers": markers}
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
    schools: list[str] | None = None,
) -> list[VerifiedClaim]:
    """Create conservative evidence notes when the verifier returns nothing.

    These are deliberately not "verified" claims. They keep the report grounded
    in registered sources while preserving the confidence boundary: a single
    official/web item is `unsupported`, and Reddit remains `sentiment_only`.
    """
    notes: list[VerifiedClaim] = []
    for item in _balanced_evidence_items([*db_evidence, *web_evidence], max_claims, schools):
        if len(notes) >= max_claims:
            break
        marker = item.get("marker")
        if not _valid_marker(marker):
            continue
        marker_str = str(marker)

        citation = item.get("citation") or {}
        source = citation.get("source") if isinstance(citation, dict) else None
        title = str(item.get("title") or item.get("label") or "Source evidence").strip()
        snippet = _clean_note_text(item.get("snippet") or item.get("display") or item.get("value"))
        if not snippet:
            continue

        if source == "reddit":
            notes.append(
                VerifiedClaim(
                    claim=f"Student sentiment source: {snippet}",
                    status="sentiment_only",
                    support_markers=[marker_str],
                    note=(
                        "Reddit source; use only as qualitative sentiment, "
                        "not policy or numbers."
                    ),
                )
            )
        else:
            notes.append(
                VerifiedClaim(
                    claim=f"{title}: {snippet}",
                    status="unsupported",
                    support_markers=[marker_str],
                    note=(
                        "Single-source evidence; cite as limited evidence, "
                        "not as independently verified."
                    ),
                )
            )
    return notes


def _supplement_with_unused_evidence_notes(
    verification: list[VerifiedClaim],
    db_evidence: list[Any],
    web_evidence: list[Any],
    max_claims: int,
    schools: list[str],
) -> list[VerifiedClaim]:
    """Keep uncovered retrieved evidence available to synthesis as limited notes."""
    if len(verification) >= max_claims:
        return verification

    used_markers = {
        marker
        for claim in verification
        for marker in claim.support_markers
    }
    supplemented = list(verification)
    for note in _fallback_evidence_notes(db_evidence, web_evidence, max_claims, schools):
        if len(supplemented) >= max_claims:
            break
        note_markers = set(note.support_markers)
        if not note_markers or note_markers & used_markers:
            continue
        supplemented.append(note)
        used_markers.update(note_markers)
    return supplemented


def _evidence_markers(*groups: list[Any]) -> set[str]:
    """Registered markers that the verifier is allowed to cite."""
    markers: set[str] = set()
    for group in groups:
        for item in group:
            if isinstance(item, dict) and _valid_marker(item.get("marker")):
                markers.add(str(item["marker"]))
    return markers


def _valid_support_markers(value: Any, allowed_markers: set[str]) -> list[str]:
    """Return support markers that are present in the source registry."""
    if not isinstance(value, list):
        return []
    markers: list[str] = []
    for marker in value:
        if (
            isinstance(marker, str)
            and marker in allowed_markers
            and marker not in markers
        ):
            markers.append(marker)
    return markers


def _valid_marker(value: Any) -> bool:
    return isinstance(value, str) and bool(_MARKER_RE.fullmatch(value))


def _balanced_evidence_items(
    items: list[Any],
    limit: int,
    schools: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Round-robin evidence by source/school/topic after marker de-duplication."""
    if limit <= 0:
        return []

    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    order: list[tuple[str, str, str]] = []
    for item in _best_items_by_marker(items):
        key = _evidence_coverage_key(item, schools or [])
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(item)

    balanced: list[dict[str, Any]] = []
    while len(balanced) < limit:
        added = False
        for key in order:
            bucket = grouped[key]
            if not bucket:
                continue
            balanced.append(bucket.pop(0))
            added = True
            if len(balanced) >= limit:
                break
        if not added:
            break
    return balanced


def _best_items_by_marker(items: list[Any]) -> list[dict[str, Any]]:
    """Choose the richest snippet for each registered citation marker."""
    best_by_marker: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        marker = item.get("marker")
        if not _valid_marker(marker):
            continue
        marker_key = str(marker)
        if marker_key not in best_by_marker:
            best_by_marker[marker_key] = item
            order.append(marker_key)
            continue
        if _evidence_score(item) > _evidence_score(best_by_marker[marker_key]):
            best_by_marker[marker_key] = item
    return [best_by_marker[marker] for marker in order]


def _evidence_score(item: dict[str, Any]) -> int:
    """Prefer evidence with fuller text and preserved research context."""
    evidence_text = item.get("snippet") or item.get("display") or item.get("value")
    text_score = len(_clean_note_text(evidence_text))
    context_score = int(bool(item.get("_research_school"))) + int(bool(item.get("_research_topic")))
    return text_score + (context_score * 25)


def _evidence_coverage_key(
    item: dict[str, Any],
    schools: list[str],
) -> tuple[str, str, str]:
    citation = item.get("citation") or {}
    source = citation.get("source") if isinstance(citation, dict) else None
    return (
        str(source or "db").lower(),
        _school_bucket(item, schools),
        _topic_bucket(item),
    )


def _evidence_prefix(item: dict[str, Any], marker: Any, schools: list[str] | None) -> str:
    citation = item.get("citation") or {}
    source = citation.get("source") if isinstance(citation, dict) else "db"
    tier = citation.get("tier") if isinstance(citation, dict) else None
    source_label = str(source or "db")
    if tier:
        source_label = f"{source_label}/{tier}"
    return (
        f"{marker} [{source_label}; "
        f"school={_school_bucket(item, schools or [])}; topic={_topic_bucket(item)}]"
    )


def _school_bucket(item: dict[str, Any], schools: list[str]) -> str:
    explicit = item.get("_research_school")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    text = _evidence_text(item)
    for school in schools:
        aliases = _school_aliases(school)
        if any(_contains_alias(text, alias) for alias in aliases):
            return school.strip().lower()
    return "general"


def _topic_bucket(item: dict[str, Any]) -> str:
    explicit = item.get("_research_topic")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    text = _evidence_text(item)
    if any(token in text for token in ("financial", "aid", "cost", "tuition", "scholarship")):
        return "aid"
    if any(token in text for token in ("sat", "act", "test", "testing", "optional")):
        return "testing"
    if any(token in text for token in ("computer science", "program", "major", "cs ")):
        return "program"
    if any(token in text for token in ("admission", "apply", "application", "deadline")):
        return "admissions"
    if "reddit" in text or "sentiment" in text:
        return "sentiment"
    return "general"


def _evidence_text(item: dict[str, Any]) -> str:
    return " ".join(
        str(item.get(key) or "")
        for key in ("title", "snippet", "url", "label", "display", "value", "field_key")
    ).lower()


def _school_aliases(school: str) -> set[str]:
    words = re.findall(r"[A-Za-z]+", school)
    aliases = {school.strip().lower()}
    meaningful = [
        word
        for word in words
        if word.lower() not in {"of", "the", "and", "university", "college"}
    ]
    if meaningful:
        aliases.add(" ".join(word.lower() for word in meaningful))
        aliases.add(meaningful[0].lower())
        acronym = "".join(word[0] for word in meaningful).lower()
        if len(acronym) > 1:
            aliases.add(acronym)
    return {alias for alias in aliases if alias}


def _contains_alias(text: str, alias: str) -> bool:
    if not alias:
        return False
    if len(alias) <= 4:
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", text))
    return alias in text


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
        caps = dict(research.get("caps") or {})
        caps["verification_unavailable"] = "soft_timeout"
        research["caps"] = caps
        research_step(writer, emissions, "verify", "error", "Cross-checking claims")
        research["verification"] = []
        research["emissions"] = emissions
        return {"research": research}

    try:
        plan = research.get("plan") or {}
        user_text = plan.get("user_text") or ""
        schools = [str(s).strip() for s in (plan.get("schools") or []) if str(s).strip()]
        evidence_text = _build_evidence_text(db_evidence, web_evidence, max_claims, schools)
        allowed_markers = _evidence_markers(db_evidence, web_evidence)

        verifier_model_str = settings.effective_model_research_verifier

        agent: Agent[None, str] = Agent(
            build_research_model(verifier_model_str, settings),
            system_prompt=_VERIFY_SYSTEM,
        )

        prompt = f"Question: {user_text}\n\n{evidence_text}\n\nReturn JSON array only."
        timeout_s = remaining_time_seconds(
            research,
            float(settings.deep_research_max_wall_clock_s),
            reserve_s=25,
            cap_s=20,
        )
        if timeout_s < 5:
            caps = dict(research.get("caps") or {})
            caps["verification_unavailable"] = "time_budget_exhausted"
            research["caps"] = caps
            verification = _fallback_evidence_notes(db_evidence, web_evidence, max_claims, schools)
        else:
            try:
                result = await asyncio.wait_for(agent.run(prompt), timeout=timeout_s)
            except TimeoutError:
                caps = dict(research.get("caps") or {})
                caps["verification_unavailable"] = "timeout"
                research["caps"] = caps
                verification = _fallback_evidence_notes(
                    db_evidence, web_evidence, max_claims, schools
                )
            else:
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
                verification = _parse_verified_claims(raw_output, max_claims, allowed_markers)
                if not verification:
                    caps = dict(research.get("caps") or {})
                    caps["verification_unavailable"] = "no_supported_claims"
                    research["caps"] = caps
                    verification = _fallback_evidence_notes(
                        db_evidence, web_evidence, max_claims, schools
                    )
                else:
                    verification = _supplement_with_unused_evidence_notes(
                        verification,
                        db_evidence,
                        web_evidence,
                        max_claims,
                        schools,
                    )
    except Exception:
        logger.warning("verification step failed — continuing without verification", exc_info=True)
        plan = research.get("plan") or {}
        schools = [str(s).strip() for s in (plan.get("schools") or []) if str(s).strip()]
        caps = dict(research.get("caps") or {})
        caps["verification_unavailable"] = "error"
        research["caps"] = caps
        verification = _fallback_evidence_notes(db_evidence, web_evidence, max_claims, schools)

    caps = dict(research.get("caps") or {})
    verify_status: ResearchStepStatus = (
        "error" if caps.get("verification_unavailable") else "complete"
    )
    research_step(writer, emissions, "verify", verify_status, "Cross-checking claims")

    research["verification"] = [c.model_dump(mode="json") for c in verification]
    research["emissions"] = emissions
    return {"research": research}
