"""The research_gather_db node — pull authoritative DB data for the research plan.

Fetches dossiers for each school in the plan via the service layer.
On DB failure, marks caps.db_unavailable and continues — partial data
is honest; a hard fail is not.
"""

from __future__ import annotations

import logging
from typing import Any, cast

from langgraph.config import get_stream_writer
from pydantic import BaseModel, ValidationError

from app.research.models import EvidenceItem
from app.research.steps import research_step
from app.sources import SourceRegistry
from counselle_db.service import get_dossier
from domain.events import StepDetail, StepSource

logger = logging.getLogger(__name__)


async def _fetch_school_data(school_name: str, deps: Any) -> list[Any]:
    """Fetch dossier envelopes for one school by name search.

    Uses the catalog to resolve a school by name, then fetches the dossier.
    Returns empty list if the school cannot be resolved.
    """
    catalog = deps.catalog
    try:
        from counselle_db.service import resolve_school

        result = await resolve_school(catalog, school_name)
        # resolve_school returns ResolveMatch | ResolveCandidates | ResolveNotFound
        from counselle_db.models import ResolveMatch

        if not isinstance(result, ResolveMatch):
            return []
        dossier = await get_dossier(catalog, result.school.unitid)
        # Collect all envelopes from all sections.
        envelopes: list[Any] = []
        if hasattr(dossier, "sections"):
            for section in dossier.sections:
                if hasattr(section, "values"):
                    envelopes.extend(_plain_envelope(value) for value in section.values)
        return envelopes
    except Exception:
        logger.debug("failed to fetch school data for %r", school_name, exc_info=True)
        return []


async def research_gather_db_node(state: Any, deps: Any) -> dict[str, Any]:
    """Fetch authoritative database evidence for all schools in the plan."""
    writer = get_stream_writer()
    research = dict(state.get("research") or {})
    emissions = list(research.get("emissions") or [])

    registry = SourceRegistry(state.get("source_registry") or [])

    plan = research.get("plan") or {}
    schools = plan.get("schools") or []

    research_step(
        writer,
        emissions,
        "db_check",
        "running",
        "Checking school data",
        kind="db_tool",
        tier="official",
    )

    db_evidence: list[dict[str, Any]] = []
    try:
        for school_name in schools:
            envelopes = await _fetch_school_data(school_name, deps)
            if envelopes:
                annotated = registry.annotate_envelopes(envelopes)
                db_evidence.extend(_evidence_items_from_envelopes(annotated, school_name))
        research_step(
            writer,
            emissions,
            "db_check",
            "complete",
            "Checking school data",
            detail=StepDetail(row_count=len(db_evidence), schools=[str(s) for s in schools]),
            sources=[StepSource(label=str(s)) for s in schools],
            kind="db_tool",
            tier="official",
        )
    except Exception:
        logger.warning("DB gather failed — continuing with partial data", exc_info=True)
        caps = dict(research.get("caps") or {})
        caps["db_unavailable"] = True
        research["caps"] = caps
        research_step(
            writer,
            emissions,
            "db_check",
            "error",
            "Checking school data",
            detail="Database unavailable",
            kind="db_tool",
            tier="official",
        )

    research["db_evidence"] = db_evidence
    research["emissions"] = emissions
    return {
        "source_registry": registry.dump(),
        "research": research,
    }


def _evidence_items_from_envelopes(payload: Any, school: str | None) -> list[dict[str, Any]]:
    """Flatten annotated citation envelopes into msgpack-safe EvidenceItem dicts."""
    items: list[dict[str, Any]] = []
    for envelope in _walk_dicts(payload):
        citation = envelope.get("citation")
        if not _citation_shaped(citation):
            continue
        citation = cast(dict[str, Any], citation)
        marker = envelope.get("marker")
        if not isinstance(marker, str):
            continue
        field_key = _str_or_none(envelope.get("field") or envelope.get("field_key"))
        display = _str_or_none(envelope.get("display") or envelope.get("value"))
        try:
            item = EvidenceItem(
                marker=marker,
                source=citation["source"],
                tier=citation["tier"],
                school=school,
                topic=_db_topic(field_key, envelope.get("label"), display),
                title=_str_or_none(envelope.get("label")) or field_key,
                snippet=display,
                url=_str_or_none(citation.get("url")),
                field_key=field_key,
                display=display,
                vintage=str(citation["vintage"]),
                retrieved_at=None,
                provenance={
                    "kind": "db_envelope",
                    "citation": citation,
                    "available": envelope.get("available"),
                    "raw": envelope.get("raw"),
                    "unit": envelope.get("unit"),
                    "raw_table": citation.get("raw_table"),
                    "caveat": citation.get("caveat"),
                },
            )
        except ValidationError:
            logger.debug("skipping malformed DB evidence envelope", exc_info=True)
            continue
        items.append(item.model_dump(mode="json"))
    return items


def _plain_envelope(value: Any) -> Any:
    """State/source-registry boundary: Pydantic envelopes become plain dicts."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    return value


def _walk_dicts(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        found = [value]
        for child in value.values():
            found.extend(_walk_dicts(child))
        return found
    if isinstance(value, list):
        nested: list[dict[str, Any]] = []
        for child in value:
            nested.extend(_walk_dicts(child))
        return nested
    return []


def _citation_shaped(value: Any) -> bool:
    return isinstance(value, dict) and {"source", "tier", "vintage"} <= value.keys()


def _db_topic(field_key: str | None, label: Any, display: str | None) -> str:
    text = " ".join(str(part or "").lower() for part in (field_key, label, display))
    if any(token in text for token in ("financial", "aid", "cost", "tuition", "scholarship")):
        return "aid"
    if any(token in text for token in ("sat", "act", "test", "testing", "optional")):
        return "testing"
    if any(token in text for token in ("admission", "admit", "acceptance", "application")):
        return "admissions"
    if any(token in text for token in ("program", "major", "computer science", "cip")):
        return "program"
    return "general"


def _str_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None
