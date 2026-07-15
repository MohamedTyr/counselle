"""The ``render_viz`` tool — the LLM picks the shape, this tool fetches cited values.

ADR 0014 / ARCHITECTURE §17 (Slice D). The provenance boundary lives here:
every cell is a :class:`CitationEnvelope` fetched **directly in-process** from
``counselle_db.service`` (eng-review D2 — never through the MCP child). The
built :class:`RenderSpec` is appended to the state-owned ``viz_emitted`` list
(streamed to the client as a ``viz`` event); the LLM receives a compact table
of display strings with citation markers so nearby prose can cite exactly what
the visualization shows.
"""

from typing import Any, Literal

import structlog

from app.sources import SourceRegistry
from app.viz_signature import render_spec_signature, viz_payload_signature
from counselle_db.catalog import Catalog
from counselle_db.models import ResolvedSchool, ServiceError
from counselle_db.service import get_domain, resolve_school
from domain.envelope import Citation, CitationEnvelope, EvidenceItem
from domain.specs import RenderSpec, SchoolRef, VizRow

logger = structlog.get_logger(__name__)

VizType = Literal["stat_block", "comparison_table"]


async def _school_ref(catalog: Catalog, unitid: int) -> SchoolRef:
    """Resolve a unitid to a named SchoolRef; unknown unitid → ServiceError."""
    result = await resolve_school(catalog, str(unitid))
    if not isinstance(result, ResolvedSchool):
        raise ServiceError(f"unitid {unitid} is not in our database")
    return SchoolRef(unitid=unitid, name=result.school.name)


async def _domains(catalog: Catalog, unitids: list[int]) -> dict[int, str | None]:
    """Map each unitid → its website host, in ONE batched query.

    Best-effort and never fatal: a school with no website (or a website we can't
    parse to a host) maps to ``None``, and any DB hiccup degrades the whole map to
    empty — a viz without logos still renders. Logos are decoration, never data.
    """
    if not unitids:
        return {}
    return {unitid: catalog.school_domain(unitid) for unitid in unitids}


async def _envelopes(catalog: Catalog, unitid: int, refs: list[str]) -> list[CitationEnvelope]:
    by_domain: dict[str, list[str]] = {}
    for ref in refs:
        if ref.count(".") != 1:
            raise ServiceError(f"invalid qualified metric ref: {ref}")
        by_domain.setdefault(ref.split(".", 1)[0], []).append(ref)
    found: dict[str, CitationEnvelope] = {}
    for domain_id, wanted in by_domain.items():
        result = await get_domain(catalog, unitid, domain_id)
        for row in result.rows:
            if row.ref in wanted:
                available = bool(row.available)
                citation = (
                    Citation(
                        source="cds",
                        tier="official",
                        vintage=row.vintage,
                        document_sha256=result.document_sha256,
                        source_kind=result.source_kind,
                        retrieved_at=result.retrieved_at,
                        academic_year=result.academic_year,
                        manifest_version=result.manifest_version,
                        school_unitid=result.school.unitid,
                    )
                    if available
                    else None
                )
                found[row.ref] = CitationEnvelope(
                    field=row.ref,
                    label=row.label,
                    display=row.display if available and row.display else "not available",
                    raw=(
                        row.value
                        if available and isinstance(row.value, (str, int, float, bool))
                        else None
                    ),
                    available=available,
                    citation=citation,
                    evidence=(EvidenceItem.model_validate(row.evidence) if available else None),
                )
    return [found[ref] for ref in refs if ref in found]


def _with_domains(schools: list[SchoolRef], domains: dict[int, str | None]) -> list[SchoolRef]:
    """Attach each school's website host (immutably) so the client can show a logo."""
    return [school.model_copy(update={"domain": domains.get(school.unitid)}) for school in schools]


async def _comparison_spec(
    catalog: Catalog, unitids: list[int], field_keys: list[str] | None, title: str | None
) -> RenderSpec:
    if not field_keys:
        raise ServiceError("comparison_table needs field_keys — pick the fields that matter here")
    schools = [await _school_ref(catalog, unitid) for unitid in unitids]
    schools = _with_domains(schools, await _domains(catalog, [s.unitid for s in schools]))
    matrices = [await _envelopes(catalog, unitid, field_keys) for unitid in unitids]
    rows = [
        VizRow(label=ref, cells=[cells[index] for cells in matrices if len(cells) > index])
        for index, ref in enumerate(field_keys)
    ]
    if not rows:
        raise ServiceError("no valid manifest refs were returned")
    return RenderSpec(
        type="comparison_table",
        title=title or " vs ".join(school.name for school in schools),
        schools=schools,
        rows=rows,
    )


async def _stat_block_spec(
    catalog: Catalog, unitids: list[int], field_keys: list[str] | None, title: str | None
) -> RenderSpec:
    if not field_keys:
        raise ServiceError("stat_block needs field_keys — pick the fields that matter here")
    unitid = unitids[0]  # a stat block is one school (ADR 0014)
    school = await _school_ref(catalog, unitid)
    school = _with_domains([school], await _domains(catalog, [unitid]))[0]
    envelopes = await _envelopes(catalog, unitid, field_keys)
    rows = [VizRow(label=env.label, cells=[env]) for env in envelopes]
    if not rows:
        raise ServiceError("no valid manifest refs were returned")
    return RenderSpec(
        type="stat_block",
        title=title or f"{school.name} — key facts",
        schools=[school],
        rows=rows,
    )


async def _build_spec(
    catalog: Catalog,
    type: VizType,
    unitids: list[int],
    field_keys: list[str] | None,
    title: str | None,
) -> RenderSpec:
    _validate_viz_request(type, unitids, field_keys)
    if type == "comparison_table":
        return await _comparison_spec(catalog, unitids, field_keys, title)
    if type == "stat_block":
        return await _stat_block_spec(catalog, unitids, field_keys, title)
    raise ServiceError(f"unknown viz type: {type!r}")


def _validate_viz_request(
    type: VizType | str, unitids: list[int], field_keys: list[str] | None
) -> None:
    if not unitids:
        raise ServiceError("render_viz needs at least one unitid")
    if type in {"comparison_table", "stat_block"} and not field_keys:
        raise ServiceError(f"{type} needs field_keys — pick the fields that matter here")
    if type not in {"comparison_table", "stat_block"}:
        raise ServiceError(f"unknown viz type: {type!r}")


def _viz_result_from_spec(
    spec: RenderSpec, registry: SourceRegistry
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    cells = [cell for row in spec.rows for cell in row.cells]
    n_available = sum(1 for cell in cells if cell.available)
    if n_available == 0:
        return (
            {
                "ok": False,
                "status": "error",
                "summary": "No values available for this visualization.",
                "error": "no values available for this visualization — tell the student "
                "honestly that this data is not available; do not invent values",
                "public_receipt": {
                    "viz_type": spec.type,
                    "value_count": 0,
                    "schools": [school.name for school in spec.schools],
                },
            },
            None,
        )
    cell_markers: list[str] = []
    markers: set[int] = set()
    for cell in cells:
        if not cell.available or cell.citation is None:
            cell_markers.append("")
            continue
        index = registry.register(cell.citation, cell.citation.vintage)
        markers.add(index)
        cell_markers.append(f"[{index}]")
    sources = [f"[{index}]" for index in sorted(markers)]
    result_for_agent = _result_for_agent(spec, cell_markers)
    return (
        {
            "ok": True,
            "status": "success",
            "summary": f"{spec.type} rendered with {n_available} cited values",
            "viz": f"{spec.type} rendered with {n_available} values",
            "sources": sources,
            "result_for_agent": result_for_agent,
            "public_receipt": {
                "viz_type": spec.type,
                "value_count": n_available,
                "schools": [school.name for school in spec.schools],
                "sources": sources,
            },
        },
        spec.model_dump(mode="json"),
    )


def _result_for_agent(spec: RenderSpec, cell_markers: list[str]) -> dict[str, Any]:
    marker_iter = iter(cell_markers)
    return {
        "type": spec.type,
        "title": spec.title,
        "schools": [{"unitid": school.unitid, "name": school.name} for school in spec.schools],
        "rows": [
            {
                "label": row.label,
                "cells": [
                    {
                        "school": spec.schools[index].name if index < len(spec.schools) else None,
                        "field": cell.field,
                        "label": cell.label,
                        "display": cell.display,
                        "available": cell.available,
                        "marker": next(marker_iter),
                    }
                    for index, cell in enumerate(row.cells)
                ],
            }
            for row in spec.rows
        ],
    }


def _placement_marker(index: int) -> str:
    return f"[[viz:{index}]]"


def _stage_render_spec(
    viz_emitted: list[dict[str, Any]],
    spec: RenderSpec,
    signature_indexes: dict[str, int] | None = None,
) -> str | None:
    if not any(cell.available for row in spec.rows for cell in row.cells):
        return None

    signature = render_spec_signature(spec)
    if signature_indexes is not None:
        if index := signature_indexes.get(signature):
            return _placement_marker(index)
        viz_emitted.append(spec.model_dump(mode="json"))
        index = len(viz_emitted)
        signature_indexes[signature] = index
        return _placement_marker(index)

    for index, staged in enumerate(viz_emitted, start=1):
        if signature == viz_payload_signature(staged):
            return _placement_marker(index)

    viz_emitted.append(spec.model_dump(mode="json"))
    return _placement_marker(len(viz_emitted))


async def render_viz(
    catalog: Catalog,
    registry: SourceRegistry,
    viz_emitted: list[dict[str, Any]],
    type: VizType,
    unitids: list[int],
    field_keys: list[str] | None = None,
    title: str | None = None,
    viz_signature_indexes: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Render a visualization for the student with compact cited values.

    You pick the SHAPE — which schools, which fields, which chart type; this
    tool fetches the exact cited values from the database and shows them to
    the student directly. On success, ``result_for_agent`` contains only
    display strings already produced by the data layer plus their citation
    markers. Use those display strings verbatim if you discuss the values.
    In your final answer, put the exact returned ``placement_marker`` wherever
    the visualization should appear. Do not alter it, do not wrap it in code,
    and do not explain it; it is hidden from the student. Cite the returned
    markers in the prose around the card.

    Types: ``comparison_table`` (N schools × your field_keys),
    ``stat_block`` (ONE school × your field_keys).
    """
    try:
        spec = await _build_spec(catalog, type, unitids, field_keys, title)
    except ServiceError as exc:
        return {"ok": False, "status": "error", "summary": str(exc), "error": str(exc)}
    except Exception:
        logger.exception("render_viz unexpected error building spec", type=type, unitids=unitids)
        return {
            "ok": False,
            "status": "error",
            "summary": "Visualization data unavailable.",
            "error": (
                "visualization data unavailable — a database error occurred; do not invent values"
            ),
        }
    result, spec_to_emit = _viz_result_from_spec(spec, registry)
    if spec_to_emit is not None:
        placement_marker = _stage_render_spec(viz_emitted, spec, viz_signature_indexes)
        if placement_marker is not None:
            result = {**result, "placement_marker": placement_marker}
    return result
