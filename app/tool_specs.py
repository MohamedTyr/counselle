"""Single registry for agent tool timeline metadata.

The labels asset owns the product voice; this module turns those rows into
typed, frozen specs so tool mounting and step mapping do not drift apart.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, cast

from domain.events import StepDetail, StepKind, StepTier

ReceiptBuilder = Callable[[str, dict[str, Any], Any, int, Any], StepDetail]

_GATED_BY: dict[str, str] = {
    "search_web": "web",
    "search_school_site": "edu",
    "search_reddit": "reddit",
    "view_tasks": "auth",
    "search_tasks": "auth",
    "create_tasks": "auth",
    "update_task": "auth",
    "archive_tasks": "auth",
    "restore_task": "auth",
    "search_schools": "auth",
    "view_schools": "auth",
    "get_school": "auth",
    "add_schools": "auth",
    "update_school": "auth",
    "archive_schools": "auth",
    "restore_school": "auth",
}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: StepKind
    tier: StepTier | None
    label: str
    receipt: ReceiptBuilder
    gated_by: str | None = None


def build_tool_specs(
    labels: Mapping[str, Any], receipt: ReceiptBuilder
) -> dict[str, ToolSpec]:
    """Build one typed spec per label row.

    Unknown/future tools still fall back inside ``StepMapper``; the registry
    only represents the known agent surface.
    """
    rows = labels.get("tools") if isinstance(labels, Mapping) else None
    if not isinstance(rows, Mapping):
        return {}
    specs: dict[str, ToolSpec] = {}
    for name, row in rows.items():
        if not isinstance(name, str) or not isinstance(row, Mapping):
            continue
        specs[name] = ToolSpec(
            name=name,
            kind=cast("StepKind", row.get("kind", "db_tool")),
            tier=cast("StepTier | None", row.get("tier")),
            label=str(row.get("label", "Working")),
            receipt=receipt,
            gated_by=_GATED_BY.get(name),
        )
    return specs


def gateable_tool_names(specs: Mapping[str, ToolSpec]) -> frozenset[str]:
    """Names of tools controlled by source config."""
    return frozenset(name for name, spec in specs.items() if spec.gated_by is not None)
