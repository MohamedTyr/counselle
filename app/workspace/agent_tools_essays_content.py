"""Content tools for essays: edit_essay, write_essay.

The specialized-control layer (plans/agent-essay-tools.md Part A.5/A.6). The
agent never sees or produces Tiptap JSON — it reads/writes markdown via
``app/workspace/essay_markdown.py`` (ADR 0030), and every write is guarded by
the ``version`` token ``read_essay`` returns, so a stale write is a clean
retryable error instead of a silent clobber of text the student may be
typing right now.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel
from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import essay_markdown
from app.workspace.agent_tools_essays import words_display
from app.workspace.agent_tools_shared import (
    ToolCtx,
    error,
    stale_essay_error,
    stale_version_error,
    today,
    try_uuid,
)
from app.workspace.models import EssayPatch, WorkspaceNotFoundError, WorkspaceValidationError
from app.workspace.service_essays import get_essay, update_essay

_EDIT_BATCH_MIN = 1
_EDIT_BATCH_MAX = 20


class EditItem(BaseModel):
    old_text: str
    new_text: str


def _parse_version(
    essay_id: str, expected_version: str
) -> tuple[datetime | None, dict[str, Any] | None]:
    try:
        return datetime.fromisoformat(expected_version), None
    except ValueError:
        return None, stale_version_error()


async def _apply_content_write(
    ctx: ToolCtx,
    essay_id: str,
    expected_version: str,
    new_content: dict[str, Any],
) -> dict[str, Any]:
    parsed_id = try_uuid(essay_id)
    if parsed_id is None:
        return stale_essay_error(essay_id)
    parsed_version, version_err = _parse_version(essay_id, expected_version)
    if version_err is not None:
        return version_err

    try:
        essay = await update_essay(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            essay_id=parsed_id,
            data=EssayPatch(content=new_content, expected_updated_at=parsed_version),
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)
    except WorkspaceValidationError:
        return stale_version_error()

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "words": words_display(essay.word_count, essay.word_limit),
        "version": essay.updated_at.isoformat(),
    }
    if essay.word_limit is not None and essay.word_count > essay.word_limit:
        payload["warning"] = (
            f"Over the word limit: {essay.word_count}/{essay.word_limit}. Consider cutting "
            "before the student submits."
        )
    if essay.status == "Not started":
        payload["footer"] = (
            'The essay has content but status is still "Not started" — consider '
            'update_essay(status="Drafting").'
        )
    return payload


# --------------------------------------------------------------------------
# edit_essay
# --------------------------------------------------------------------------


def make_edit_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def edit_essay(
        essay_id: str, expected_version: str, edits: list[EditItem]
    ) -> dict[str, Any]:
        """Apply targeted text edits to an essay — the way to make specific changes
        without rewriting the whole draft.

        Always read_essay first and echo its version as expected_version, verbatim.
        If the essay changed since you read it (the student may be typing right
        now), this fails cleanly and retryably — read_essay again and rebuild your
        edit against the current text.

        Each edit's old_text must match the essay's current text exactly and
        uniquely — the same mechanic as a precise find-and-replace. If it doesn't
        match anywhere, or matches more than once, the whole batch fails with
        nothing applied; add more surrounding context to old_text and retry. Edits
        in a batch apply in order, each against the result of the previous one.
        Setting new_text to "" deletes the matched text.

        Never invent personal facts, activities, hardship, or emotional meaning —
        if material is missing, ask the student for it first. Don't hide a meaning
        change inside a polish edit; say what changed and why.

        Args:
            essay_id: The essay's id, from view_essays or read_essay.
            expected_version: The version from your most recent read_essay call.
            edits: 1-20 {old_text, new_text} pairs to apply in order.
        """
        payload = await _edit_essay_impl(ctx, essay_id, expected_version, edits)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="edit_essay")  # type: ignore[no-any-return]

    return Tool(edit_essay, takes_ctx=False)


async def _edit_essay_impl(
    ctx: ToolCtx, essay_id: str, expected_version: str, edits: list[EditItem]
) -> dict[str, Any]:
    if not (_EDIT_BATCH_MIN <= len(edits) <= _EDIT_BATCH_MAX):
        return error(
            f"edit_essay accepts {_EDIT_BATCH_MIN}-{_EDIT_BATCH_MAX} edits per call; "
            f"got {len(edits)}.",
            retryable=True,
            recovery=f"Split the batch into calls of {_EDIT_BATCH_MAX} or fewer and resubmit.",
        )

    parsed_id = try_uuid(essay_id)
    if parsed_id is None:
        return stale_essay_error(essay_id)
    try:
        essay = await get_essay(ctx.app_pool, ctx.catalog, user_id=ctx.user_id, essay_id=parsed_id)
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)

    if essay.updated_at.isoformat() != expected_version:
        return stale_version_error()

    try:
        result = essay_markdown.apply_edits(
            essay.content,
            [essay_markdown.Edit(old_text=e.old_text, new_text=e.new_text) for e in edits],
        )
    except essay_markdown.EssayEditError as exc:
        if exc.reason == "not_found":
            recovery = "Re-check old_text against the essay's current markdown and retry."
        else:
            recovery = "Add more surrounding text to old_text to make it unique and retry."
        return error(
            f"edits[{exc.index}]: {exc.detail}",
            retryable=True,
            recovery=recovery,
        )

    payload = await _apply_content_write(ctx, essay_id, expected_version, result.new_doc)
    if payload.get("status") == "ok":
        payload["summary"] = f"Applied {result.applied} edit{'s' if result.applied != 1 else ''}."
    return payload


# --------------------------------------------------------------------------
# write_essay
# --------------------------------------------------------------------------


def make_write_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def write_essay(
        essay_id: str, expected_version: str, content_markdown: str
    ) -> dict[str, Any]:
        """Replace an essay's entire content with a full draft — only for drafting an
        empty essay or a full redraft the student explicitly asked for. Prefer
        edit_essay for targeted changes; a full rewrite discards everything the
        essay had before.

        Always read_essay first and echo its version as expected_version, verbatim
        — the same staleness protection as edit_essay.

        Args:
            essay_id: The essay's id, from view_essays or read_essay.
            expected_version: The version from your most recent read_essay call.
            content_markdown: The full new draft, as markdown.
        """
        payload = await _write_essay_impl(ctx, essay_id, expected_version, content_markdown)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="write_essay")  # type: ignore[no-any-return]

    return Tool(write_essay, takes_ctx=False)


async def _write_essay_impl(
    ctx: ToolCtx, essay_id: str, expected_version: str, content_markdown: str
) -> dict[str, Any]:
    if not content_markdown.strip():
        return error(
            "content_markdown is empty — an essay is never blanked this way.",
            retryable=False,
            recovery="If the student wants the essay gone, use archive_essays instead.",
        )

    new_content = essay_markdown.to_tiptap(content_markdown)
    payload = await _apply_content_write(ctx, essay_id, expected_version, new_content)
    if payload.get("status") == "ok":
        payload["summary"] = "Replaced the essay's content."
    return payload
