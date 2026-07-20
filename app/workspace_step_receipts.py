"""Public, display-safe previews for workspace read step receipts."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from domain.events import WorkspacePreviewItem, WorkspacePreviewMeta

WORKSPACE_READ_TOOLS = frozenset(
    {
        "view_tasks",
        "search_tasks",
        "search_schools",
        "view_schools",
        "get_school",
        "view_essays",
        "read_essay",
        "view_activities",
        "view_documents",
        "read_document",
    }
)
WORKSPACE_PREVIEW_LIMIT = 12


def _text(row: Mapping[str, Any], key: str) -> str | None:
    value = row.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _meta(
    row: Mapping[str, Any], fields: tuple[tuple[str, str], ...]
) -> list[WorkspacePreviewMeta]:
    return [
        WorkspacePreviewMeta(label=label, value=value)
        for key, label in fields
        if (value := _text(row, key)) is not None
    ]


def _item(
    row: Mapping[str, Any],
    *,
    kind: str,
    title_key: str,
    meta_fields: tuple[tuple[str, str], ...],
    group: str | None = None,
) -> WorkspacePreviewItem | None:
    title = _text(row, title_key)
    if title is None:
        return None
    return WorkspacePreviewItem(
        kind=kind,
        title=title,
        meta=_meta(row, meta_fields),
        status=_text(row, "state") or _text(row, "status"),
        group=group,
    )


def _rows(
    content: Mapping[str, Any],
    key: str,
    *,
    kind: str,
    title_key: str,
    meta_fields: tuple[tuple[str, str], ...],
    group: str | None = None,
) -> list[WorkspacePreviewItem]:
    values = content.get(key)
    if not isinstance(values, list):
        return []
    return [
        item
        for value in values
        if isinstance(value, Mapping)
        and (
            item := _item(
                value,
                kind=kind,
                title_key=title_key,
                meta_fields=meta_fields,
                group=group,
            )
        )
        is not None
    ]


def workspace_preview_items(tool_name: str, content: Any) -> list[WorkspacePreviewItem] | None:
    """Return the exact allowlisted preview for a workspace read result."""
    if tool_name not in WORKSPACE_READ_TOOLS or not isinstance(content, Mapping):
        return None

    if tool_name in {"view_tasks", "search_tasks"}:
        return _rows(
            content,
            "tasks",
            kind="task",
            title_key="title",
            meta_fields=(("due", "Due"), ("category", "Category")),
        )
    if tool_name == "search_schools":
        return _rows(
            content,
            "schools",
            kind="school",
            title_key="name",
            meta_fields=(("location", "Location"),),
        )
    if tool_name == "view_schools":
        return _rows(
            content,
            "schools",
            kind="school",
            title_key="school",
            meta_fields=(
                ("round", "Round"),
                ("deadline", "Deadline"),
                ("tasks", "Tasks"),
                ("essays", "Essays"),
            ),
        )
    if tool_name == "view_essays":
        return _rows(
            content,
            "essays",
            kind="essay",
            title_key="title",
            meta_fields=(
                ("school", "School"),
                ("type", "Type"),
                ("words", "Words"),
                ("deadline", "Deadline"),
            ),
        )
    if tool_name == "view_activities":
        return [
            *_rows(
                content,
                "activities",
                kind="activity",
                title_key="position",
                meta_fields=(("organization", "Organization"), ("type", "Type")),
                group="Activities",
            ),
            *_rows(
                content,
                "honors",
                kind="honor",
                title_key="title",
                meta_fields=(),
                group="Honors",
            ),
        ]

    singular = {
        "get_school": (
            "school",
            "school",
            "school",
            (
                ("round", "Round"),
                ("deadline", "Deadline"),
                ("tasks", "Tasks"),
                ("essays", "Essays"),
            ),
        ),
        "read_essay": (
            "essay",
            "essay",
            "title",
            (("school", "School"), ("type", "Type"), ("words", "Words"), ("deadline", "Deadline")),
        ),
        "read_document": (
            "document",
            "document",
            "title",
            (("type", "Type"), ("filename", "File")),
        ),
    }.get(tool_name)
    if singular is not None:
        key, kind, title_key, meta_fields = singular
        row = content.get(key)
        if isinstance(row, Mapping):
            item = _item(row, kind=kind, title_key=title_key, meta_fields=meta_fields)
            return [] if item is None else [item]
        return []

    return _rows(
        content,
        "documents",
        kind="document",
        title_key="title",
        meta_fields=(("type", "Type"), ("size", "Size"), ("uploaded", "Uploaded")),
    )


def with_workspace_public_receipt(tool_name: str | None, content: Any) -> Any:
    """Attach a compact preview before overflow can spill the full result."""
    if tool_name not in WORKSPACE_READ_TOOLS or not isinstance(content, dict):
        return content
    items = workspace_preview_items(tool_name, content)
    if items is None:
        return content
    existing = content.get("public_receipt")
    receipt = dict(existing) if isinstance(existing, Mapping) else {}
    receipt.update(
        {
            "result_count": (
                content["result_count"]
                if isinstance(content.get("result_count"), int)
                else len(items)
            ),
            "workspace_items": [item.model_dump() for item in items[:WORKSPACE_PREVIEW_LIMIT]],
        }
    )
    summary = _text(content, "summary")
    if summary is not None:
        receipt["summary"] = summary
    return {**content, "public_receipt": receipt}
