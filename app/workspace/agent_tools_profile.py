"""Per-run agent tools for the student profile and documents (Part E 1-3).

``update_profile`` is one tool over ten typed, all-optional profile sections
(``app/workspace/models.py``) — a section-level JSON merge patch identical to
``service_profile.update_profile``'s own semantics: a field present in a
section merges/overwrites, a field explicitly ``null`` within a section
clears just that field, and passing the literal string ``"clear"`` for a
whole section empties it (the section-level counterpart to the "clear"
sentinel task/essay date fields already use — a submodel has no scalar
"clear" value of its own, so the sentinel lives one level up).

``view_documents``/``read_document`` are read-only over ``service_documents``;
uploads and deletes stay student-only (``AGENTS.md``/plan Part B), so no
mutation tools live here.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic_ai import Tool

from app.student_context import render_profile_block
from app.tool_middleware import process_tool_result
from app.workspace.agent_tools_shared import ToolCtx, error, resolve_ref
from app.workspace.models import (
    Academics,
    Aid,
    Background,
    Basics,
    Circumstances,
    Document,
    Interests,
    Narrative,
    People,
    Preferences,
    Profile,
    ProfilePatch,
    Testing,
    WorkspaceNotFoundError,
)
from app.workspace.service_documents import get_document, list_documents, read_document
from app.workspace.service_profile import update_profile

_NO_SECTION_RECOVERY = (
    "Pass at least one section (basics, academics, testing, background, circumstances, "
    "aid, interests, preferences, narrative, or people) with the fields to change."
)
_DOCUMENT_STATUS_RECOVERY = (
    "Tell the student honestly that this file can't be read yet, and suggest they paste "
    "the content directly in chat or re-upload it as a text-based PDF."
)
_STALE_DOCUMENT_RECOVERY = (
    "Call view_documents to see the student's current documents and their ids. "
    "Do not retry this same ref."
)
_DOCUMENT_ID_PREFIX_LENGTH = 8

ClearableSection = Literal["clear"]

# --------------------------------------------------------------------------
# E.1 update_profile
# --------------------------------------------------------------------------

_SECTION_NAMES = (
    "basics",
    "academics",
    "testing",
    "background",
    "circumstances",
    "aid",
    "interests",
    "preferences",
    "narrative",
    "people",
)


def make_update_profile_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_profile_tool(
        basics: Basics | ClearableSection | None = None,
        academics: Academics | ClearableSection | None = None,
        testing: Testing | ClearableSection | None = None,
        background: Background | ClearableSection | None = None,
        circumstances: Circumstances | ClearableSection | None = None,
        aid: Aid | ClearableSection | None = None,
        interests: Interests | ClearableSection | None = None,
        preferences: Preferences | ClearableSection | None = None,
        narrative: Narrative | ClearableSection | None = None,
        people: People | ClearableSection | None = None,
    ) -> dict[str, Any]:
        """Update the student's profile — their ground-truth application facts.

        One tool over the profile's ten sections (basics, academics, testing,
        background, circumstances, aid, interests, preferences, narrative,
        people). Pass only the sections that changed; within a section, pass
        only the fields that changed — everything else is left untouched.
        To CLEAR a single field inside a section, set it to null in that
        section's object. To CLEAR an entire section, pass the string
        "clear" for that section instead of an object.

        Call this whenever the student states an application fact ("my SAT
        came back — 1520", "I'm first-gen", "budget is about $35k a year").
        Never write a value the student didn't state or a document doesn't
        show — honesty-critical fields (GPA, test scores) are never inferred
        or estimated. Returns the full updated profile so you can confirm
        exactly what changed.

        Args:
            basics: Preferred name, pronouns, grade level, graduation year,
                high school.
            academics: GPA, class rank, grade trend, current courses, rigor.
            testing: SAT/ACT/PSAT/AP/IB scores, planned tests, English
                proficiency.
            background: Citizenship, residence, first-gen status, hooks,
                languages, community type.
            circumstances: Disruptions, responsibilities, health/learning
                context, disciplinary history — free text, student's own words.
            aid: Need, budget, SAI estimate, loan appetite, merit priority.
            interests: Intended majors, certainty, career direction,
                pre-professional tracks.
            preferences: Size, setting, region, must-haves, dealbreakers.
            narrative: Spike, defining experiences, self-description, values,
                essay angles — quote the student, never paraphrase into
                something they didn't say.
            people: Recommenders, counselor context, family stance, other
                support.
        """
        payload = await _update_profile_impl(
            ctx,
            basics=basics,
            academics=academics,
            testing=testing,
            background=background,
            circumstances=circumstances,
            aid=aid,
            interests=interests,
            preferences=preferences,
            narrative=narrative,
            people=people,
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_profile")  # type: ignore[no-any-return]

    return Tool(update_profile_tool, takes_ctx=False, name="update_profile")


def _build_patch_dict(sections: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    for name in _SECTION_NAMES:
        value = sections.get(name)
        if value is None:
            continue
        if value == "clear":
            patch[name] = None
        else:
            patch[name] = value.model_dump(exclude_unset=True, mode="json")
    return patch


async def _update_profile_impl(ctx: ToolCtx, **sections: Any) -> dict[str, Any]:
    patch_dict = _build_patch_dict(sections)
    if not patch_dict:
        return error(
            "No profile section was provided — nothing to update.",
            retryable=True,
            recovery=_NO_SECTION_RECOVERY,
        )
    patch = ProfilePatch.model_validate(patch_dict)
    profile: Profile = await update_profile(
        ctx.app_pool, ctx.workspace_events, user_id=ctx.user_id, actor="counselle", data=patch
    )
    changed = ", ".join(sorted(patch_dict))
    return {
        "status": "ok",
        "summary": f"Updated the profile ({changed}).",
        "profile": render_profile_block(profile),
    }


# --------------------------------------------------------------------------
# E.2 view_documents
# --------------------------------------------------------------------------


def _size_display(size_bytes: int) -> str:
    kb = max(1, size_bytes // 1024)
    return f"{kb} KB" if kb < 1024 else f"{kb / 1024:.1f} MB"


def _document_row(document: Document, *, state: str | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(document.id)[:_DOCUMENT_ID_PREFIX_LENGTH],
        "title": document.title,
        "type": document.doc_type,
        "filename": document.filename,
        "text_status": document.text_status,
        "size": _size_display(document.size_bytes),
        "uploaded": document.created_at.date().isoformat(),
    }
    if document.summary:
        row["summary"] = document.summary
    if state is not None:
        row["state"] = state
    return row


def _document_state(document: Document, status: str) -> str | None:
    if status != "all":
        return None
    return "archived" if document.archived_at else "active"


def make_view_documents_tool(ctx: ToolCtx) -> Tool[Any]:
    async def view_documents(
        status: Literal["active", "archived", "all"] = "active",
    ) -> dict[str, Any]:
        """List the student's uploaded documents (transcript, resume, essays, etc).

        Each row shows id, title, type, filename, extraction status, size,
        upload date, and a short summary when one exists. Call this after the
        student mentions uploading something mid-conversation, to re-check
        what's on file. Use read_document with a row's id to see full text.

        Args:
            status: "active" (default) = documents on file now; "archived" =
                removed documents; "all" = both, each flagged with its state.
        """
        payload = await _view_documents_impl(ctx, status)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="view_documents")  # type: ignore[no-any-return]

    return Tool(view_documents, takes_ctx=False)


async def _view_documents_impl(ctx: ToolCtx, status: str) -> dict[str, Any]:
    include_archived = status in ("archived", "all")
    documents = await list_documents(
        ctx.app_pool, user_id=ctx.user_id, include_archived=include_archived
    )
    if status == "active":
        documents = [d for d in documents if d.archived_at is None]
    elif status == "archived":
        documents = [d for d in documents if d.archived_at is not None]

    if not documents:
        summary = {
            "active": "No documents uploaded yet.",
            "archived": "No archived documents.",
            "all": "No documents, active or archived.",
        }[status]
        return {
            "status": "ok",
            "summary": summary,
            "documents": [],
            "footer": "Invite the student to upload a transcript, resume, or essay draft.",
        }

    rows = [
        _document_row(document, state=_document_state(document, status)) for document in documents
    ]
    return {
        "status": "ok",
        "summary": f"{len(rows)} document{'' if len(rows) == 1 else 's'}.",
        "documents": rows,
        "footer": "Use read_document with an id above to read a document's full text.",
    }


# --------------------------------------------------------------------------
# E.3 read_document
# --------------------------------------------------------------------------


def make_read_document_tool(ctx: ToolCtx) -> Tool[Any]:
    async def read_document_tool(document_ref: str) -> dict[str, Any]:
        """Read one document's full extracted text.

        document_ref accepts the 8-char id prefix shown in your student
        context or a view_documents row, or the full id. Unreadable
        documents (text_status "unsupported" or "failed") return a teaching
        error instead of text — tell the student honestly and suggest
        pasting the content or re-uploading a text-based PDF.

        Args:
            document_ref: The document's id (prefix or full), from your
                student context or view_documents.
        """
        payload = await _read_document_impl(ctx, document_ref)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="read_document")  # type: ignore[no-any-return]

    return Tool(read_document_tool, takes_ctx=False, name="read_document")


def _stale_document_error(document_ref: str) -> dict[str, Any]:
    return error(
        f'No document matches "{document_ref}". It may have been archived, or the ref may '
        "be stale.",
        retryable=False,
        recovery=_STALE_DOCUMENT_RECOVERY,
    )


async def _read_document_impl(ctx: ToolCtx, document_ref: str) -> dict[str, Any]:
    active = await list_documents(ctx.app_pool, user_id=ctx.user_id)
    matched, ambiguous = resolve_ref(document_ref, [document.id for document in active])
    if ambiguous:
        return error(
            f'"{document_ref}" matches more than one document.',
            retryable=True,
            recovery="Use the full id from view_documents instead of a short prefix.",
        )
    if matched is None:
        return _stale_document_error(document_ref)

    try:
        document = await get_document(ctx.app_pool, user_id=ctx.user_id, document_id=matched)
    except WorkspaceNotFoundError:
        return _stale_document_error(document_ref)
    if document.text_status != "extracted":
        return error(
            f'"{document.title}" can\'t be read — {document.text_status}.',
            retryable=False,
            recovery=_DOCUMENT_STATUS_RECOVERY,
        )

    try:
        content = await read_document(ctx.app_pool, user_id=ctx.user_id, document_id=matched)
    except WorkspaceNotFoundError:
        return _stale_document_error(document_ref)
    framing = f'"{document.title}" ({document.doc_type}) — student-provided document.'
    return {
        "status": "ok",
        "document": {
            "id": str(document.id)[:_DOCUMENT_ID_PREFIX_LENGTH],
            "title": document.title,
            "type": document.doc_type,
            "filename": document.filename,
        },
        "content": f"{framing}\n\n{content.extracted_text or ''}",
    }
