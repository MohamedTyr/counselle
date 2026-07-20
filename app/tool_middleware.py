"""One seam for cross-cutting tool result handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.caveats import render_caveat
from app.sources import SourceRegistry
from app.tool_overflow import ToolResultStore, reduce_tool_result
from app.workspace_step_receipts import with_workspace_public_receipt
from counselle_db.models import ProfileProvenanceReceipt
from domain.envelope import Citation, CitationEnvelope, EvidenceItem
from domain.events import tool_ui_from_payload

_SEARCH_TOOLS = frozenset({"search_web", "search_school_site", "search_reddit"})
_OVERFLOW_EXEMPT_TOOLS = frozenset({"render_viz"})


def _caveats(
    kinds: list[str] | tuple[str, ...], *, snapshot_date: str = "", edition: str = ""
) -> tuple[Any, ...]:
    rendered = []
    for kind in kinds:
        if kind == "profile_snapshot":
            rendered.append(render_caveat(kind, snapshot_date=snapshot_date))
        elif kind == "stale_edition":
            rendered.append(render_caveat(kind, edition=edition))
        elif kind in {
            "partial_packet",
            "definition_drift",
            "not_in_template_version",
            "not_reported",
            "not_applicable",
            "suppressed",
        }:
            rendered.append(render_caveat(kind))
    return tuple(rendered)


def _normalize_db_payload(result: Any, tool_name: str | None) -> Any:
    if not isinstance(result, dict):
        return result
    if tool_name == "get_domain" and isinstance(result.get("rows"), list):
        school = result.get("school") or {}
        year = result.get("academic_year")
        sha = result.get("document_sha256")
        if not (
            year
            and sha
            and result.get("source_kind")
            and result.get("retrieved_at")
            and result.get("manifest_version")
        ):
            return result
        citation = Citation(
            source="cds",
            tier="official",
            vintage=f"Common Data Set {year}-{str(year + 1)[-2:]}",
            document_sha256=sha,
            source_kind=result["source_kind"],
            retrieved_at=result["retrieved_at"],
            academic_year=year,
            manifest_version=result["manifest_version"],
            school_unitid=school.get("unitid"),
        )
        label = f"{school.get('name')} — Common Data Set {year}-{str(year + 1)[-2:]}"
        rows = []
        for row in result["rows"]:
            available = bool(row.get("available"))
            evidence = EvidenceItem.model_validate(row["evidence"]) if available else None
            envelope = CitationEnvelope(
                field=row.get("ref"),
                label=row.get("label") or row.get("ref") or "Value",
                display=row.get("display") if available else "not available",
                raw=row.get("value") if available else None,
                available=available,
                citation=citation if available else None,
                evidence=evidence,
                caveats=_caveats(row.get("caveat_kinds") or (), edition=citation.vintage),
            )
            rows.append(
                {
                    **envelope.model_dump(mode="json"),
                    "vintage": row.get("vintage") or citation.vintage,
                    "source_label": label,
                }
            )
        return {**result, "rows": rows}
    if tool_name == "get_school_profile" and isinstance(result.get("groups"), list):
        school = result.get("school") or {}
        snapshot_date = str(result.get("profile_snapshot_date") or "")
        citation = Citation(
            source="profile",
            tier="official",
            vintage=f"Profile {result.get('profile_version')} ({snapshot_date})",
            school_unitid=school.get("unitid"),
            profile_sha256=result.get("profile_sha256"),
        )
        label = f"{school.get('name')} — profile snapshot {snapshot_date}"
        groups = []
        for group in result["groups"]:
            rows = []
            for row in group.get("rows") or []:
                available = bool(row.get("available"))
                provenance = (
                    ProfileProvenanceReceipt.model_validate(row["provenance"]).model_dump(
                        mode="json"
                    )
                    if isinstance(row.get("provenance"), dict)
                    else None
                )
                envelope = CitationEnvelope(
                    field=row.get("ref"),
                    label=row.get("label") or row.get("ref") or "Value",
                    display=row.get("display") if available else "not available",
                    raw=row.get("value") if available else None,
                    available=available,
                    citation=citation if available else None,
                    caveats=_caveats(row.get("caveat_kinds") or (), snapshot_date=snapshot_date),
                )
                rows.append(
                    {
                        **envelope.model_dump(mode="json"),
                        "provenance": provenance,
                        "source_label": label,
                    }
                )
            groups.append({**group, "rows": rows})
        return {**result, "groups": groups}
    return result


@dataclass
class ToolMiddlewareContext:
    registry: SourceRegistry | None = None
    overflow_store: ToolResultStore | None = None
    max_result_chars: int = 0


def annotate_citations(
    result: Any, context: ToolMiddlewareContext | None, *, tool_name: str | None
) -> Any:
    """Attach source markers to cited tool results without mutating payloads."""
    if context is None or context.registry is None:
        return result
    if tool_name in _SEARCH_TOOLS:
        return context.registry.annotate_search_results(result)
    return context.registry.annotate_envelopes(result)


def error_envelope(result: Any) -> Any:
    """Normalize tool error returns.

    Today the concrete tools already return the D6 shape themselves. Keeping
    this as an explicit pipeline stage makes the order testable and gives MCP
    server errors one stable target shape.
    """
    return result


def demote_tool_ui(result: Any) -> Any:
    """Move a top-level tool ``ui`` payload into ``public_receipt.ui``.

    The raw ``ui`` key is intended for the client-side step event, not for the
    model-visible tool result. Keeping the public copy on the receipt also lets
    overflow reduction preserve it in the compact envelope.
    """
    if not isinstance(result, dict) or "ui" not in result:
        return result

    base = {key: value for key, value in result.items() if key != "ui"}
    ui = tool_ui_from_payload(result.get("ui"))
    if ui is None:
        return base

    receipt = base.get("public_receipt")
    receipt_dict = dict(receipt) if isinstance(receipt, dict) else {}
    return {**base, "public_receipt": {**receipt_dict, "ui": ui.model_dump()}}


def overflow_spill(
    result: Any,
    context: ToolMiddlewareContext | None,
    *,
    exempt_overflow: bool = False,
) -> Any:
    """Spill oversized payloads after annotations/error normalization."""
    if context is None or context.overflow_store is None or exempt_overflow:
        return result
    return reduce_tool_result(result, context.overflow_store, max_chars=context.max_result_chars)


def process_tool_result(
    result: Any,
    context: ToolMiddlewareContext | None,
    *,
    tool_name: str | None = None,
    exempt_overflow: bool = False,
) -> Any:
    """Apply the ordered tool-result middleware pipeline."""
    result = _normalize_db_payload(result, tool_name)
    result = annotate_citations(result, context, tool_name=tool_name)
    result = error_envelope(result)
    result = with_workspace_public_receipt(tool_name, result)
    result = demote_tool_ui(result)
    exempt_overflow = exempt_overflow or tool_name in _OVERFLOW_EXEMPT_TOOLS
    return overflow_spill(result, context, exempt_overflow=exempt_overflow)
