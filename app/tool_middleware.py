"""One seam for cross-cutting tool result handling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, cast

from app.caveats import caveat_catalog, render_caveat
from app.sources import SourceRegistry
from app.tool_overflow import ToolResultStore, reduce_tool_result
from app.workspace_step_receipts import with_workspace_public_receipt
from counselle_db.models import ProfileProvenanceReceipt
from domain.envelope import CaveatKind, Citation, CitationEnvelope
from domain.events import tool_ui_from_payload

_SEARCH_TOOLS = frozenset({"search_web", "search_school_site", "search_reddit"})
_OVERFLOW_EXEMPT_TOOLS = frozenset({"render_viz"})

# school-data-v3 §5.4/§6a -- the one name for this source on every chat
# surface leads both vintage forms; "checked {month_year}" is the facts
# vintage (a `get_facts` citation over a non-null `facts_updated_at`),
# "identity profile from {snapshot_date}" is the identity vintage
# (`get_school_profile`/`resolve_school`, always; `get_facts` too when
# `facts_updated_at` is null -- a facts vintage is never minted over an
# empty date slot). Per-fact vintage (the string each `get_facts` row
# carries, distinct from the shared citation's own vintage) rides the fact's
# own `reported_period`, never the citation.
_FACTS_VINTAGE = "Counselle school data · checked {month_year}"
_IDENTITY_VINTAGE = "Counselle school data · identity profile from {snapshot_date}"
_FACT_VINTAGE_WITH_PERIOD = "Counselle school data · {period} · checked {month_year}"
_FACT_VINTAGE_NO_PERIOD = "Counselle school data · reporting period unstated · checked {month_year}"


def _caveats(kinds: list[str] | tuple[str, ...], **values: Any) -> tuple[Any, ...]:
    """Slot-driven from `caveat_catalog()` (plan §6a) instead of a hand-list
    that silently drops any kind not explicitly wired here: a kind present
    in the catalog always renders once the caller supplies its slots."""
    catalog = caveat_catalog()
    rendered = []
    for kind in kinds:
        item = catalog.get(kind)
        if item is None or any(slot not in values for slot in item["slots"]):
            continue
        rendered.append(
            render_caveat(cast(CaveatKind, kind), **{slot: values[slot] for slot in item["slots"]})
        )
    return tuple(rendered)


def _month_year(observed_at_iso: str) -> str:
    return datetime.fromisoformat(observed_at_iso).strftime("%B %Y")


def identity_vintage(snapshot_date: str) -> str:
    return _IDENTITY_VINTAGE.format(snapshot_date=snapshot_date)


def _fact_row_vintage(reported_period: str | None, observed_at_iso: str) -> str:
    month_year = _month_year(observed_at_iso)
    if reported_period:
        return _FACT_VINTAGE_WITH_PERIOD.format(period=reported_period, month_year=month_year)
    return _FACT_VINTAGE_NO_PERIOD.format(month_year=month_year)


def _resolve_school_db_citation(result: dict[str, Any]) -> Any:
    """`resolve_school` mints exactly one `db` citation for a `match` --
    always the identity vintage (plan §6a: `resolve_school` never mints the
    facts vintage)."""
    if result.get("status") != "match":
        return result
    school = result.get("school") or {}
    unitid = school.get("unitid")
    snapshot_date = result.get("profile_snapshot_date")
    if not unitid or not snapshot_date:
        return result
    citation = Citation(
        source="db", vintage=identity_vintage(str(snapshot_date)), school_unitid=unitid
    )
    return {
        **result,
        "citation": citation.model_dump(mode="json"),
        "source_label": school.get("name"),
    }


def _get_school_profile_db_citation(result: dict[str, Any]) -> Any:
    """`get_school_profile` mints exactly one `db` citation, always the
    identity vintage -- unchanged from the CDS-era shape (appendix F-i's
    "unchanged" note) except the citation `source` moves from `profile` to
    `db` (F9) and drops the profile-only identity fields `db` cannot carry."""
    if not isinstance(result.get("groups"), list):
        return result
    school = result.get("school") or {}
    snapshot_date = str(result.get("profile_snapshot_date") or "")
    citation = Citation(
        source="db", vintage=identity_vintage(snapshot_date), school_unitid=school.get("unitid")
    )
    label = school.get("name")
    groups = []
    for group in result["groups"]:
        rows = []
        for row in group.get("rows") or []:
            available = bool(row.get("available"))
            provenance = (
                ProfileProvenanceReceipt.model_validate(row["provenance"]).model_dump(mode="json")
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


def get_facts_db_citation(result: dict[str, Any]) -> Any:
    """`get_facts` mints exactly one `db` citation for the school: the facts
    vintage when `status.facts_updated_at` is non-null, else the identity
    vintage (never a facts vintage over an empty date slot, plan §6a). Every
    row `get_facts` returns already has a reported value
    (`current_school_facts` carries only reported facts), so every envelope
    is `available=True`; each row also carries its own per-fact `vintage`
    string, riding that fact's `reported_period` -- distinct from the shared
    citation's vintage (plan §5.4)."""
    if not isinstance(result.get("rows"), list):
        return result
    school = result.get("school") or {}
    status = result.get("status") or {}
    facts_updated_at = status.get("facts_updated_at")
    if facts_updated_at:
        citation = Citation(
            source="db",
            vintage=_FACTS_VINTAGE.format(month_year=_month_year(facts_updated_at)),
            school_unitid=school.get("unitid"),
            facts_updated_at=date.fromisoformat(str(facts_updated_at)[:10]),
        )
    else:
        snapshot_date = str(result.get("profile_snapshot_date") or "")
        citation = Citation(
            source="db",
            vintage=identity_vintage(snapshot_date),
            school_unitid=school.get("unitid"),
        )
    label = school.get("name")
    rows = []
    for row in result["rows"]:
        envelope = CitationEnvelope(
            field=row.get("fact_key"),
            label=row.get("label") or row.get("fact_key") or "Value",
            display=row.get("display") or "",
            unit=row.get("unit"),
            raw=row.get("value"),
            available=True,
            citation=citation,
        )
        rows.append(
            {
                **envelope.model_dump(mode="json"),
                "section": row.get("section"),
                "state": row.get("state", "value"),
                "reported_period": row.get("reported_period"),
                "vintage": _fact_row_vintage(row.get("reported_period"), row.get("observed_at")),
                # Passthrough for `app/viz.py`'s `observed_at_spread` caveat
                # (school-data-v3 Phase 3) -- the per-fact
                # confirmation date, distinct from the shared citation's
                # vintage string above.
                "observed_at": row.get("observed_at"),
                "source_label": label,
            }
        )
    # Minted at top level too, not only per-row: a school with zero facts
    # (has_collegedata=False, or every tab never_fetched) still names the
    # school it describes -- "exactly one db citation" holds even when
    # `rows` is empty. `source_key` dedup means this never double-registers
    # against the per-row citations above (same citation, same key).
    return {
        **result,
        "rows": rows,
        "citation": citation.model_dump(mode="json"),
        "source_label": label,
    }


#: The fields of an annotated `get_facts` row the model reads. Everything else
#: on the envelope (the shared citation, the raw value, unit, section,
#: `observed_at`, ...) repeats once per row and roughly quadruples the payload;
#: the school's citation is kept once at top level instead, and `render_viz`
#: does its own read, so nothing downstream needs the full rows.
_MODEL_FACT_ROW_FIELDS = ("label", "display", "vintage", "marker")


def compact_facts_for_model(result: Any, tool_name: str | None) -> Any:
    """Slim an annotated `get_facts` result to what the model cites from."""
    if tool_name != "get_facts" or not isinstance(result, dict):
        return result
    if not isinstance(result.get("rows"), list):
        return result
    rows = []
    for row in result["rows"]:
        compact = {"fact_key": row.get("field")}
        compact.update({field: row.get(field) for field in _MODEL_FACT_ROW_FIELDS})
        if row.get("caveats"):
            compact["caveats"] = row["caveats"]
        rows.append(compact)
    return {**result, "rows": rows}


_DB_CITATION_MINTERS = {
    "resolve_school": _resolve_school_db_citation,
    "get_school_profile": _get_school_profile_db_citation,
    "get_facts": get_facts_db_citation,
}


def _normalize_db_payload(result: Any, tool_name: str | None) -> Any:
    """Mint the `db` citation for the three tools plan §6a names --
    `{get_facts, get_school_profile, resolve_school}`. `query_database`
    mints none: appendix F-iii's validator requires `school_unitid` and a
    cross-school result has no single school (its honesty carriers are the
    `coverage_denominator` caveat and the printed-name sentence it already
    carries, per `counselle_db.sql_guard`)."""
    if not isinstance(result, dict):
        return result
    minter = _DB_CITATION_MINTERS.get(tool_name or "")
    return minter(result) if minter is not None else result


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
    result = compact_facts_for_model(result, tool_name)
    result = error_envelope(result)
    result = with_workspace_public_receipt(tool_name, result)
    result = demote_tool_ui(result)
    exempt_overflow = exempt_overflow or tool_name in _OVERFLOW_EXEMPT_TOOLS
    return overflow_spill(result, context, exempt_overflow=exempt_overflow)
