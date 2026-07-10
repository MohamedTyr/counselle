"""Per-run agent tools that give the Counselle agent direct control over essays.

Two layers (plans/agent-essay-tools.md Part A): general control — the essay
library as a workspace object, mirroring the task/school tools — and
specialized control over the essay *document*, presented to the agent as
markdown (``app/workspace/essay_markdown.py``; ADR 0030).

Read tools (``view_essays``, ``read_essay``) live here. General mutations
(``create_essays``/``update_essay``/``duplicate_essay``/``archive_essays``/
``restore_essay``) live in ``agent_tools_essays_mutations.py``; content
tools (``edit_essay``/``write_essay``) live in
``agent_tools_essays_content.py`` — split purely to stay under the
file-size convention.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import essay_markdown
from app.workspace.agent_tools_shared import (
    ToolCtx,
    active_workspace_links,
    link_targets,
    stale_essay_error,
    today,
    try_uuid,
)
from app.workspace.models import Essay, EssaySummary, WorkspaceNotFoundError
from app.workspace.service_essays import get_essay, list_essays

_ARCHIVED_ESSAYS_SQL = """
SELECT e.*, a.school_unitid, COALESCE(e.deadline, a.deadline) AS deadline
FROM counselle.essays e
LEFT JOIN counselle.applications a
  ON a.id = e.application_id AND a.user_id = e.user_id
WHERE e.user_id = $1 AND e.archived_at IS NOT NULL
  AND ($2::uuid IS NULL OR e.application_id = $2)
ORDER BY e.archived_at DESC
"""


# --------------------------------------------------------------------------
# Row rendering (fixed key order, null/default fields omitted — ADR 0029 shape)
# --------------------------------------------------------------------------


def words_display(word_count: int, word_limit: int | None) -> str:
    return f"{word_count}/{word_limit}" if word_limit is not None else str(word_count)


def render_essay_row(essay: EssaySummary, *, state: str | None = None) -> dict[str, Any]:
    """One essay row for view/mutation results (null fields omitted)."""
    row: dict[str, Any] = {
        "id": str(essay.id),
        "title": essay.title,
        "type": essay.essay_type,
        "status": essay.status,
    }
    if essay.school_name:
        row["school"] = essay.school_name
    row["words"] = words_display(essay.word_count, essay.word_limit)
    if essay.deadline is not None:
        row["deadline"] = essay.deadline.isoformat()
    row["updated"] = essay.updated_at.date().isoformat()
    if essay.preview:
        row["preview"] = essay.preview
    if state is not None:
        row["state"] = state
    return row


async def _archived_essay_rows(
    ctx: ToolCtx, application_id: UUID | None = None
) -> list[dict[str, Any]]:
    async with ctx.app_pool.acquire() as conn:
        rows = await conn.fetch(_ARCHIVED_ESSAYS_SQL, ctx.user_id, application_id)
    out: list[dict[str, Any]] = []
    for row in rows:
        school = ctx.catalog.school_name(row["school_unitid"]) if row["school_unitid"] else None
        item: dict[str, Any] = {
            "id": str(row["id"]),
            "title": row["title"],
            "type": row["essay_type"],
            "status": row["status"],
        }
        if school:
            item["school"] = school
        item["words"] = words_display(row["word_count"], row["word_limit"])
        if row["deadline"] is not None:
            item["deadline"] = row["deadline"].isoformat()
        item["updated"] = row["updated_at"].date().isoformat()
        item["state"] = "archived"
        item["archived"] = row["archived_at"].date().isoformat()
        out.append(item)
    return out


# --------------------------------------------------------------------------
# view_essays
# --------------------------------------------------------------------------


def make_view_essays_tool(ctx: ToolCtx) -> Tool[Any]:
    async def view_essays(
        status: Literal["active", "archived", "all"] = "active",
        application_id: str | None = None,
        limit: int = 25,
    ) -> dict[str, Any]:
        """View the student's essay library — the shared workspace you both see.

        Each row shows title, type, status, linked school (if any), word count
        (against the limit when one is set), deadline, and a short content preview.
        Call this before discussing, creating, or changing essays — it returns the
        exact ids that read_essay, update_essay, and the other essay tools require.

        This is metadata only. To read or change an essay's actual text, call
        read_essay with its id.

        Args:
            status: "active" (default) = essays in the library now; "archived" =
                removed essays (restore_essay brings one back); "all" = both, each
                flagged with its state.
            application_id: Only essays linked to this school (exact id from
                view_schools).
            limit: Maximum rows (default 25).
        """
        payload = await _view_essays_impl(ctx, status, application_id, limit)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="view_essays")  # type: ignore[no-any-return]

    return Tool(view_essays, takes_ctx=False)


def _sort_essays(essays: list[EssaySummary]) -> list[EssaySummary]:
    """Deadline asc (undated last), then most-recently-updated first."""
    return sorted(
        essays,
        key=lambda e: (e.deadline is None, e.deadline or date.max, -e.updated_at.timestamp()),
    )


async def _view_essays_impl(
    ctx: ToolCtx, status: str, application_id: str | None, limit: int
) -> dict[str, Any]:
    app_filter = try_uuid(application_id) if application_id else None
    filter_unmatchable = application_id is not None and app_filter is None

    active: list[dict[str, Any]] = []
    if status in ("active", "all") and not filter_unmatchable:
        essays = await list_essays(ctx.app_pool, ctx.catalog, user_id=ctx.user_id)
        if app_filter is not None:
            essays = [e for e in essays if e.application_id == app_filter]
        essays = _sort_essays(essays)
        state = "active" if status == "all" else None
        active = [render_essay_row(e, state=state) for e in essays]

    archived: list[dict[str, Any]] = []
    if status in ("archived", "all") and not filter_unmatchable:
        archived = await _archived_essay_rows(ctx, app_filter)

    rows = (active + archived)[:limit]
    total = len(active) + len(archived)
    if not rows:
        summary = {
            "active": "The student's essay library is empty.",
            "archived": "No archived essays.",
            "all": "The student has no essays, active or archived.",
        }[status]
        apps, essays = await active_workspace_links(ctx)
        footer = (
            "Consider offering to draft a starter essay with create_essays, linked to one "
            "of the student's active applications below."
            if apps
            else "Consider offering to draft a starter essay with create_essays once the "
            "student has an application."
        )
        return {
            "status": "ok",
            "today": today(),
            "summary": summary,
            "essays": [],
            "footer": footer,
            "link_targets": link_targets(apps, essays)["applications"],
        }

    footer = "Use read_essay with an id above to see and edit an essay's full content."
    if total > limit:
        footer = f"Showing {limit} of {total} essays. " + footer
    if status == "archived" or (status == "all" and archived):
        footer += " Archived essays can be brought back with restore_essay."
    return {
        "status": "ok",
        "today": today(),
        "summary": f"{total} essay{'s' if total != 1 else ''}.",
        "essays": rows,
        "footer": footer,
    }


# --------------------------------------------------------------------------
# read_essay
# --------------------------------------------------------------------------


def make_read_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def read_essay(essay_id: str) -> dict[str, Any]:
        """Read one essay's full content as markdown — the document view.

        Returns the essay's metadata, its content as markdown, and a version token.
        Echo that version as expected_version when you call edit_essay or
        write_essay — it protects against clobbering text the student is typing
        right now. Always read_essay before editing; never edit from memory of an
        earlier turn.

        Use edit_essay for targeted changes to specific text. Use write_essay only
        for drafting an empty essay or a full redraft the student explicitly asked
        for.

        Args:
            essay_id: The essay's id, from view_essays.
        """
        payload = await _read_essay_impl(ctx, essay_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="read_essay")  # type: ignore[no-any-return]

    return Tool(read_essay, takes_ctx=False)


async def _read_essay_impl(ctx: ToolCtx, essay_id: str) -> dict[str, Any]:
    parsed = try_uuid(essay_id)
    if parsed is None:
        return stale_essay_error(essay_id)
    try:
        essay: Essay = await get_essay(
            ctx.app_pool, ctx.catalog, user_id=ctx.user_id, essay_id=parsed
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)

    content_markdown = essay_markdown.to_markdown(essay.content)
    essay_meta: dict[str, Any] = {
        "id": str(essay.id),
        "title": essay.title,
        "type": essay.essay_type,
        "status": essay.status,
    }
    if essay.school_name:
        essay_meta["school"] = essay.school_name
    if essay.prompt:
        essay_meta["prompt"] = essay.prompt
    if essay.deadline is not None:
        essay_meta["deadline"] = essay.deadline.isoformat()
    essay_meta["words"] = words_display(essay.word_count, essay.word_limit)

    if not content_markdown:
        footer = "The essay is empty — draft it with write_essay."
    else:
        footer = (
            "Echo version as expected_version when you edit. Use edit_essay for targeted "
            "changes, write_essay only for a full redraft the student asked for."
        )
    return {
        "status": "ok",
        "today": today(),
        "essay": essay_meta,
        "version": essay.updated_at.isoformat(),
        "content_markdown": content_markdown,
        "footer": footer,
    }
