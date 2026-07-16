"""Transactional resolver for the two verified visualization value channels."""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any

import structlog

from app.caveats import render_caveat
from app.sources import SourceRegistry
from app.viz_signature import render_spec_signature, viz_payload_signature
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.models import DomainResult, ProfileGroupResult, ProfileLeaf, ServiceError
from counselle_db.service import get_domain, get_school_profile
from domain.envelope import Citation, CitationEnvelope, EvidenceItem
from domain.specs import (
    ColumnInput,
    MetricCellInput,
    ProfileCellInput,
    SchoolRef,
    SourcedCellInput,
    TabularRenderSpec,
    UnavailableCellInput,
    VizRow,
    VizRowInput,
)

logger = structlog.get_logger(__name__)
VizType = str
_KNOWN_TYPES = {"stat_block", "comparison_table"}


def _defect(row: int, col: int, reason: str) -> dict[str, Any]:
    return {"row": row, "col": col, "reason": reason}


def _suggest(value: str, choices: list[str]) -> str:
    ranked = sorted(
        choices,
        key=lambda item: (-SequenceMatcher(None, value, item).ratio(), item),
    )[:3]
    return f" — did you mean {', '.join(repr(item) for item in ranked)}?" if ranked else ""


def _validate_shape(
    type: str, columns: list[ColumnInput], rows: list[VizRowInput]
) -> list[dict[str, Any]]:
    defects: list[dict[str, Any]] = []
    if type not in _KNOWN_TYPES:
        return [_defect(0, 0, f"unsupported tabular visualization type {type!r}")]
    if not columns:
        defects.append(_defect(0, 0, "render_viz needs at least one column"))
    if not rows:
        defects.append(_defect(0, 0, "render_viz needs at least one row"))
    if type == "stat_block" and len(columns) != 1:
        defects.append(_defect(0, 0, "stat_block requires exactly one column"))
    if type == "comparison_table" and len(columns) < 2:
        defects.append(_defect(0, 0, "comparison_table requires at least two columns"))
    for row_index, row in enumerate(rows):
        if not row.label.strip():
            defects.append(_defect(row_index, 0, "row label must be nonblank"))
        if len(row.cells) != len(columns):
            defects.append(
                _defect(
                    row_index,
                    0,
                    f"row has {len(row.cells)} cells but {len(columns)} columns",
                )
            )
    return defects


def _validate_column_identities(columns: list[ColumnInput]) -> list[dict[str, Any]]:
    """Reject duplicate identities without consulting the catalog or sources."""
    defects: list[dict[str, Any]] = []
    db_ids: set[int] = set()
    web_names: set[str] = set()
    for col, column in enumerate(columns):
        if column.unitid is not None:
            if column.unitid in db_ids:
                defects.append(_defect(0, col, f"duplicate database unitid {column.unitid}"))
            db_ids.add(column.unitid)
            continue
        normalized_name = " ".join((column.name or "").casefold().split())
        if normalized_name in web_names:
            defects.append(
                _defect(0, col, f"duplicate web-only identity {(column.name or '').strip()!r}")
            )
        web_names.add(normalized_name)
    return defects


def _resolve_columns(
    catalog: Catalog, columns: list[ColumnInput]
) -> tuple[list[SchoolRef | None], list[dict[str, Any]]]:
    resolved: list[SchoolRef | None] = []
    defects: list[dict[str, Any]] = []
    for col, column in enumerate(columns):
        if column.unitid is not None:
            record = catalog.snapshot.schools.get(column.unitid)
            if record is None:
                defects.append(_defect(0, col, f"unitid {column.unitid} is not in our database"))
                resolved.append(None)
            else:
                basics = record.basics
                resolved.append(
                    SchoolRef(
                        unitid=basics.unitid,
                        name=basics.name,
                        domain=basics.official_domain,
                    )
                )
        else:
            name = (column.name or "").strip()
            resolved.append(SchoolRef(unitid=None, name=name, domain=column.domain))
    return resolved, defects


def _metric_ref(catalog: Catalog, value: str) -> tuple[str, str] | None:
    if value.count(".") != 1 or value not in catalog.snapshot.metrics:
        return None
    return tuple(value.split(".", 1))  # type: ignore[return-value]


def _profile_ref(catalog: Catalog, value: str) -> tuple[str, str] | None:
    if value.count(".") < 1:
        return None
    group, _ = value.split(".", 1)
    return (group, value) if group in catalog.snapshot.profile_groups else None


async def _fetch_groups(
    catalog: Catalog,
    schools: list[SchoolRef | None],
    rows: list[VizRowInput],
) -> tuple[
    dict[tuple[int, str], DomainResult],
    dict[tuple[int, str], ProfileGroupResult],
]:
    metric_groups: set[tuple[int, str]] = set()
    profile_groups: set[tuple[int, str]] = set()
    for row in rows:
        for col, cell in enumerate(row.cells):
            school = schools[col] if col < len(schools) else None
            if school is None or school.unitid is None:
                continue
            if isinstance(cell, MetricCellInput) and (
                parsed := _metric_ref(catalog, cell.metric_ref)
            ):
                metric_groups.add((school.unitid, parsed[0]))
            elif isinstance(cell, ProfileCellInput) and (
                parsed_profile := _profile_ref(catalog, cell.profile_field)
            ):
                profile_groups.add((school.unitid, parsed_profile[0]))
    domains = {key: await get_domain(catalog, key[0], key[1]) for key in sorted(metric_groups)}
    profiles = {
        key: await get_school_profile(catalog, key[0], [key[1]]) for key in sorted(profile_groups)
    }
    return domains, profiles


def _db_envelope(result: DomainResult, ref: str) -> CitationEnvelope | None:
    row = next((item for item in result.rows if item.ref == ref), None)
    if row is None or not row.available or row.display is None or row.evidence is None:
        return None
    citation = Citation(
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
    evidence = EvidenceItem.model_validate(row.evidence)
    return CitationEnvelope(
        field=ref,
        label=row.label,
        display=row.display,
        raw=row.value,
        available=True,
        citation=citation,
        evidence=evidence,
        caveats=tuple(
            render_caveat(kind, edition=row.vintage)
            if kind == "stale_edition"
            else render_caveat(kind)
            for kind in row.caveat_kinds
        ),
    )


def _profile_envelope(result: ProfileGroupResult, ref: str) -> CitationEnvelope | None:
    leaf = _profile_leaf(result, ref)
    if leaf is None or not leaf.available or leaf.display is None:
        return None
    citation = Citation(
        source="profile",
        tier="official",
        vintage=f"Profile snapshot {result.profile_snapshot_date.isoformat()}",
        school_unitid=result.school.unitid,
        profile_sha256=result.profile_sha256,
    )
    return CitationEnvelope(
        field=ref,
        label=leaf.label,
        display=leaf.display,
        raw=leaf.value,
        available=True,
        citation=citation,
        caveats=(
            render_caveat(
                "profile_snapshot", snapshot_date=result.profile_snapshot_date.isoformat()
            ),
        ),
    )


def _profile_leaf(result: ProfileGroupResult, ref: str) -> ProfileLeaf | None:
    return next((row for group in result.groups for row in group.rows if row.ref == ref), None)


def _unavailable(label: str, ref: str | None = None) -> CitationEnvelope:
    return CitationEnvelope(
        field=ref,
        label=label,
        display="not available",
        raw=None,
        available=False,
    )


def _apply_mismatch(cells: list[CitationEnvelope]) -> list[CitationEnvelope]:
    cds = [
        cell for cell in cells if cell.available and cell.citation and cell.citation.source == "cds"
    ]
    identities = {
        (cell.citation.academic_year, cell.citation.manifest_version)
        for cell in cds
        if cell.citation
    }
    if len(identities) <= 1:
        return cells
    editions = ", ".join(sorted({cell.citation.vintage for cell in cds if cell.citation}))
    caveat = render_caveat("edition_mismatch_comparison", editions=editions)
    return [
        cell.model_copy(update={"caveats": (*cell.caveats, caveat)})
        if cell in cds and caveat not in cell.caveats
        else cell
        for cell in cells
    ]


def _stage_render_spec(
    viz_emitted: list[dict[str, Any]],
    spec: TabularRenderSpec,
    signature_indexes: dict[str, int] | None = None,
) -> str:
    signature = render_spec_signature(spec)
    if signature_indexes is not None and (index := signature_indexes.get(signature)):
        return f"[[viz:{index}]]"
    for index, staged in enumerate(viz_emitted, start=1):
        if signature == viz_payload_signature(staged):
            return f"[[viz:{index}]]"
    viz_emitted.append(spec.model_dump(mode="json"))
    index = len(viz_emitted)
    if signature_indexes is not None:
        signature_indexes[signature] = index
    return f"[[viz:{index}]]"


async def render_viz(
    catalog: Catalog,
    registry: SourceRegistry,
    viz_emitted: list[dict[str, Any]],
    type: str,
    columns: list[ColumnInput],
    rows: list[VizRowInput],
    title: str | None = None,
    viz_signature_indexes: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Compose a verified card after reading database/search results first.

    Each cell is exactly one of: ``{"metric_ref": "domain.metric"}`` (a
    qualified CDS ref read from a prior ``get_domain`` call), ``{"profile_field":
    "group.field"}`` (from ``get_school_profile``), ``{"display": "...", "raw":
    ..., "marker": "[n]"}`` for an external web/edu/reddit marker already
    registered this turn, or ``{"unavailable": true}`` for a genuine, declared
    hole. Database refs are fetched here in-process; sourced citations are
    copied verbatim from the turn's source registry — never merge or author
    citation metadata. Never pair a sourced marker cell with a CDS/profile ref
    cell as if they were the same channel of truth.

    Validation runs before any fetch, including the configured max-cell
    ceiling; an invalid or unavailable database ref, an unregistered marker, or
    a shape violation rejects the *entire* call — nothing partially renders.
    A genuinely missing value must be an explicit ``unavailable`` cell, never
    a dropped row or a silently rejected-then-hidden one.

    On success (``status: "rendered"``), the result carries only counts, the
    distinct source markers actually used, and the exact ``placement_marker``
    to place verbatim in the final answer — never the cell values themselves
    (already in your context from the reads above). On failure (``status:
    "rejected"``), every rejected cell comes back with its row, column, and a
    corrective reason (e.g. a suggested ref); fix only those cells and retry
    the same call — never invent a value or a marker to route around a
    rejection.
    """
    defects = _validate_shape(type, columns, rows)
    cell_count = len(columns) * len(rows)
    if cell_count > get_settings().viz_max_cells:
        defects.append(_defect(0, 0, f"cell count {cell_count} exceeds configured maximum"))
    defects.extend(_validate_column_identities(columns))
    if defects:
        return {"ok": False, "status": "rejected", "rejected_cells": defects, "valid_cells": 0}
    schools, column_defects = _resolve_columns(catalog, columns)
    defects.extend(column_defects)
    if defects:
        return {"ok": False, "status": "rejected", "rejected_cells": defects, "valid_cells": 0}
    try:
        domains, profiles = await _fetch_groups(catalog, schools, rows)
    except ServiceError as exc:
        return {
            "ok": False,
            "status": "rejected",
            "rejected_cells": [_defect(0, 0, str(exc))],
            "valid_cells": 0,
        }
    except Exception:
        logger.exception("render_viz grouped fetch failed", type=type)
        return {
            "ok": False,
            "status": "rejected",
            "rejected_cells": [_defect(0, 0, "visualization data unavailable")],
            "valid_cells": 0,
        }

    candidate_registry = registry.fork()
    flat: list[CitationEnvelope] = []
    valid_cells = 0
    metric_choices = list(catalog.snapshot.metrics)
    for row_index, row in enumerate(rows):
        for col, cell in enumerate(row.cells):
            school = schools[col]
            envelope: CitationEnvelope | None = None
            reason: str | None = None
            if school is None:
                reason = "column identity is invalid"
            elif isinstance(cell, UnavailableCellInput):
                envelope = _unavailable(row.label)
            elif isinstance(cell, SourcedCellInput):
                entry = candidate_registry.lookup_marker(cell.marker)
                if entry is None:
                    reason = f"marker {cell.marker} is not available in this turn"
                elif entry.citation.source not in {"web", "edu", "reddit"}:
                    reason = f"marker {cell.marker} is not an external web/edu/reddit source"
                else:
                    envelope = CitationEnvelope(
                        field=None,
                        label=row.label,
                        display=cell.display,
                        raw=cell.raw,
                        available=True,
                        citation=entry.citation,
                        marker=cell.marker,
                    )
            elif school.unitid is None:
                reason = "web-only columns cannot resolve database references"
            elif isinstance(cell, MetricCellInput):
                parsed = _metric_ref(catalog, cell.metric_ref)
                if parsed is None:
                    domain = cell.metric_ref.split(".", 1)[0]
                    choices = [ref for ref in metric_choices if ref.startswith(f"{domain}.")]
                    reason = (
                        f"unknown metric_ref {cell.metric_ref!r}"
                        f"{_suggest(cell.metric_ref, choices)}"
                    )
                else:
                    envelope = _db_envelope(domains[(school.unitid, parsed[0])], cell.metric_ref)
                    if envelope is None:
                        reason = (
                            f"{cell.metric_ref!r} is unavailable; replace this cell "
                            'with {"unavailable":true}'
                        )
            elif isinstance(cell, ProfileCellInput):
                parsed_profile = _profile_ref(catalog, cell.profile_field)
                if parsed_profile is None:
                    reason = f"unknown profile_field {cell.profile_field!r}"
                else:
                    profile = profiles[(school.unitid, parsed_profile[0])]
                    leaf = _profile_leaf(profile, cell.profile_field)
                    if leaf is None:
                        choices = [
                            row.ref
                            for group in profile.groups
                            if group.id == parsed_profile[0]
                            for row in group.rows
                        ]
                        reason = (
                            f"unknown profile_field {cell.profile_field!r}"
                            f"{_suggest(cell.profile_field, choices)}"
                        )
                    else:
                        envelope = _profile_envelope(profile, cell.profile_field)
                    if leaf is not None and envelope is None:
                        reason = (
                            f"{cell.profile_field!r} is unavailable; replace this cell "
                            'with {"unavailable":true}'
                        )
            if reason:
                defects.append(_defect(row_index, col, reason))
            else:
                valid_cells += 1
                assert envelope is not None
                flat.append(envelope)
    if defects:
        return {
            "ok": False,
            "status": "rejected",
            "rejected_cells": defects,
            "valid_cells": valid_cells,
        }
    if not any(cell.available for cell in flat):
        return {
            "ok": False,
            "status": "rejected",
            "rejected_cells": [
                _defect(
                    0, 0, "no values available for this visualization — tell the student honestly"
                )
            ],
            "valid_cells": valid_cells,
        }

    flat = _apply_mismatch(flat)
    markers: set[int] = set()
    resolved_rows: list[VizRow] = []
    offset = 0
    for row in rows:
        resolved_cells: list[CitationEnvelope] = []
        for resolved_cell in flat[offset : offset + len(columns)]:
            if resolved_cell.available and resolved_cell.citation:
                marker = candidate_registry.marker_for(resolved_cell.citation)
                if marker is None:
                    school = schools[len(resolved_cells)]
                    assert school is not None
                    if (
                        resolved_cell.citation.source == "cds"
                        or resolved_cell.citation.source == "profile"
                    ):
                        label = f"{school.name} — {resolved_cell.citation.vintage}"
                    else:
                        label = resolved_cell.citation.vintage
                    marker = candidate_registry.register_source(resolved_cell.citation, label)
                marker_index = int(marker[1:-1])
                markers.add(marker_index)
                if resolved_cell.evidence is not None:
                    candidate_registry.register_used_evidence(marker_index, resolved_cell.evidence)
                resolved_cell = resolved_cell.model_copy(update={"marker": marker})
            resolved_cells.append(resolved_cell)
        resolved_rows.append(
            VizRow.model_validate(
                {
                    "label": row.label,
                    "cells": [cell.model_dump(mode="python") for cell in resolved_cells],
                }
            )
        )
        offset += len(columns)
    spec = TabularRenderSpec(
        type=type,  # type: ignore[arg-type]
        title=title or (" vs ".join(s.name for s in schools if s) or "Comparison"),
        columns=tuple(s for s in schools if s is not None),
        rows=tuple(resolved_rows),
    )
    staged = list(viz_emitted)
    indexes = dict(viz_signature_indexes) if viz_signature_indexes is not None else None
    try:
        placement_marker = _stage_render_spec(staged, spec, indexes)
    except Exception:
        logger.exception("render_viz staging failed", type=type)
        return {
            "ok": False,
            "status": "rejected",
            "rejected_cells": [_defect(0, 0, "visualization could not be staged")],
            "valid_cells": valid_cells,
        }
    viz_emitted[:] = staged
    if viz_signature_indexes is not None and indexes is not None:
        viz_signature_indexes.clear()
        viz_signature_indexes.update(indexes)
    registry.commit_from(candidate_registry)
    sources = [f"[{index}]" for index in sorted(markers)]
    available_count = sum(cell.available for cell in flat)
    return {
        "ok": True,
        "status": "rendered",
        "placement_marker": placement_marker,
        "cell_count": cell_count,
        "available_count": available_count,
        "unavailable_count": cell_count - available_count,
        "source_count": len(sources),
        "sources": sources,
        "public_receipt": {
            "viz_type": type,
            "value_count": available_count,
            "schools": [school.name for school in schools if school],
            "sources": sources,
        },
    }
