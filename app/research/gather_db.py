"""The research_gather_db node — pull authoritative DB data for the research plan.

Fetches dossiers for each school in the plan via the service layer.
On DB failure, marks caps.db_unavailable and continues — partial data
is honest; a hard fail is not.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.config import get_stream_writer

from app.research.steps import research_step
from app.sources import SourceRegistry
from counselle_db.service import get_dossier

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
        # Collect all envelopes from all sections
        envelopes: list[Any] = []
        if hasattr(dossier, "sections"):
            for section in dossier.sections:
                if hasattr(section, "fields"):
                    envelopes.extend(section.fields)
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

    research_step(writer, emissions, "db_check", "running", "Checking school data")

    db_evidence: list[Any] = []
    try:
        for school_name in schools:
            envelopes = await _fetch_school_data(school_name, deps)
            if envelopes:
                annotated = registry.annotate_envelopes(envelopes)
                if isinstance(annotated, list):
                    db_evidence.extend(annotated)
                else:
                    db_evidence.append(annotated)
        research_step(writer, emissions, "db_check", "complete", "Checking school data")
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
        )

    research["db_evidence"] = db_evidence
    research["emissions"] = emissions
    return {
        "source_registry": registry.dump(),
        "research": research,
    }
