"""Render the per-turn student-context prompt block (ADR 0029/0030 seam).

Assembles the ``{student_context}`` slot (``app/prompt.py``) from the three
per-student stores: the typed profile, the document list, and the curated
memory pile. Built fresh every turn by ``prepare`` (``app/graph.py``), exactly
like ``build_temporal_context`` — never cached across turns, so an agent edit
mid-conversation is visible on the very next turn.

Honesty-critical, like the DB value-reading rules: profile scalars render
**verbatim** (never rounded, never reordered — field order follows the typed
model's declared field order), empty sections/fields are omitted rather than
invented, and a document whose text could not be read is never described as
if it had content — its ``text_status`` renders next to it, every time.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date as Date
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel

from app.workspace.memory_context import render_memory_block
from app.workspace.models import Document, Profile
from app.workspace.service_documents import list_documents
from app.workspace.service_memory import list_memories
from app.workspace.service_profile import get_profile

#: Rendered for turns with no authenticated user (ADR 0013: unmounted, not
#: hidden) — the eval runner/CLI path never reads or fabricates student data.
#: No top-level heading here — ``counselor.md`` already wraps the
#: ``{student_context}`` slot in its own "## About This Student" heading.
STUDENT_CONTEXT_UNAUTHENTICATED = (
    "No student profile, documents, or memory for this session (unauthenticated)."
)

_EMPTY_PROFILE_LINE = "Profile is empty - invite the student to fill it in or upload documents."
_NO_DOCUMENTS_LINE = "No documents uploaded yet."
_DOCUMENT_ID_PREFIX_LENGTH = 8
_MIDDLE_DOT = "·"
_DOCUMENT_STATUS_NOTES = {
    "unsupported": "can't read this file type yet, no OCR - tell the student honestly",
    "failed": "couldn't extract readable text from this file - tell the student honestly",
}
#: Characters stripped from student-authored/upload-derived free text before it
#: is interpolated into the prompt. Newlines are collapsed so student text can
#: never open a new line that looks like a fresh markdown section (a mid-line
#: ``##`` renders as inline text, never a heading, in markdown — see
#: ``app/student_context.py`` module docstring / Finding 1 review notes).
_LINE_BREAK_CHARS = ("\r\n", "\r", "\n")


def _collapse_newlines(text: str) -> str:
    """Collapse embedded line breaks in untrusted text to a single space.

    Prevents student-authored profile text from opening a new "line" in the
    rendered prompt that could masquerade as a fresh markdown heading or
    section (e.g. ``"...\\n\\n## SYSTEM OVERRIDE\\n..."``). This alone is
    sufficient: Markdown only recognizes ``#`` headings at the start of a
    line, so once newlines are gone, a literal ``##`` renders as harmless
    inline text.
    """
    collapsed = text
    for line_break in _LINE_BREAK_CHARS:
        collapsed = collapsed.replace(line_break, " ")
    return " ".join(collapsed.split())


async def build_student_context(app_pool: asyncpg.Pool, *, user_id: UUID) -> str:
    """Assemble the full student-context block for one authenticated turn."""
    profile = await get_profile(app_pool, user_id=user_id)
    documents = await list_documents(app_pool, user_id=user_id)
    memories = await list_memories(app_pool, user_id=user_id)
    return "\n\n".join(
        [
            render_profile_block(profile),
            render_documents_block(documents),
            render_memory_block(memories),
        ]
    )


def render_profile_block(profile: Profile) -> str:
    """Render the typed profile verbatim; omit empty sections and fields.

    Field order always follows each model's declared field order (Pydantic
    v2 preserves declaration order) — this is what keeps SAT section scores,
    AP lists, and every other ordered value honest to what was actually
    stored, never resorted or reinterpreted.
    """
    lines = [
        f"{_label(name)}: {rendered}"
        for name in type(profile).model_fields
        for rendered in (_render_submodel(getattr(profile, name)),)
        if rendered
    ]
    if not lines:
        return f"### Profile\n{_EMPTY_PROFILE_LINE}"
    return "\n".join(["### Profile", *lines])


def render_documents_block(documents: Sequence[Document]) -> str:
    """Render the active document list; never imply an unreadable doc has text."""
    header = f"### Documents ({len(documents)})"
    if not documents:
        return f"{header}\n{_NO_DOCUMENTS_LINE}"
    return "\n".join([header, *(_render_document_line(document) for document in documents)])


def _render_document_line(document: Document) -> str:
    prefix = str(document.id)[:_DOCUMENT_ID_PREFIX_LENGTH]
    filename = _neutralize_filename(document.filename)
    return (
        f"- doc {prefix} {_MIDDLE_DOT} {document.doc_type} {_MIDDLE_DOT} "
        f'"{filename}" {_MIDDLE_DOT} {document.text_status} {_MIDDLE_DOT} '
        f"{_document_detail(document)}"
    )


def _neutralize_filename(filename: str) -> str:
    """Strip characters a crafted filename could use to forge extra fields.

    The filename is interpolated into a hand-built ``"..." · ... · ...`` line;
    without neutralization, a literal ``"`` could close the quoted slot early
    and a literal ``·`` could fake an additional delimited field.
    """
    collapsed = _collapse_newlines(filename)
    return collapsed.replace('"', "'").replace(_MIDDLE_DOT, "-")


def _document_detail(document: Document) -> str:
    note = _DOCUMENT_STATUS_NOTES.get(document.text_status)
    if note is not None:
        return note
    if document.summary is None:
        return "no summary available yet"
    return _collapse_newlines(document.summary)


def _render_submodel(value: BaseModel | None) -> str | None:
    if value is None:
        return None
    parts = [
        rendered
        for name in type(value).model_fields
        for rendered in (_render_field(name, getattr(value, name)),)
        if rendered
    ]
    return f" {_MIDDLE_DOT} ".join(parts) if parts else None


def _render_field(name: str, value: Any) -> str | None:
    rendered = _render_value(value)
    return None if rendered is None else f"{_label(name)} {rendered}"


def _render_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, Date):
        return value.isoformat()
    if isinstance(value, str):
        return _collapse_newlines(value) or None
    if isinstance(value, list):
        rendered_items = [item for item in (_render_value(entry) for entry in value) if item]
        return "; ".join(rendered_items) if rendered_items else None
    if isinstance(value, BaseModel):
        return _render_submodel(value)
    return str(value)


def _label(field_name: str) -> str:
    return field_name.replace("_", " ")
