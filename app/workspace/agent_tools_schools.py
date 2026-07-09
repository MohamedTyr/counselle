"""Per-run agent tools that give the Counselle agent direct control over schools.

"Schools" on the workspace are ``counselle.applications`` rows — one school on
the student's list. These seven PydanticAI function tools wrap
``service_applications`` directly with ``actor="counselle"`` — same
transaction, change log, cascade archive/restore, and live SSE invalidation as
the HTTP routes (ADR 0029, reused from the task tools). ``search_schools``,
``view_schools``, and ``get_school`` (reads) live here; ``add_schools`` /
``update_school`` / ``archive_schools`` / ``restore_school`` live in
``agent_tools_schools_mutations.py`` — split purely to stay under the
file-size convention.

``search_schools`` is the discovery seam: it queries the read-only national
catalog (``counselle_ro``), not the student's list, because ``add_schools``
needs a ``unitid`` and the catalog is the only place a name → unitid lookup
lives. The other six tools operate on the student's own application rows.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace.agent_tools_shared import ToolCtx, today, try_uuid
from app.workspace.models import ApplicationView, EssaySummary, Task
from app.workspace.service_applications import (
    get_application_detail,
    list_applications,
    search_schools,
)

_ARCHIVED_SCHOOLS_SQL = """
SELECT id, school_unitid, list_type, round, status, deadline, archived_at
FROM counselle.applications
WHERE user_id = $1 AND archived_at IS NOT NULL
ORDER BY archived_at DESC
"""


# --------------------------------------------------------------------------
# Row rendering (fixed key order, null/default fields omitted — ADR 0029 shape)
# --------------------------------------------------------------------------


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _truncate_notes(text: str | None, limit: int = 120) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[:limit] + "…"


def render_school_row(app: ApplicationView, *, state: str | None = None) -> dict[str, Any]:
    """One school row for view/detail/mutation results (null fields omitted)."""
    row: dict[str, Any] = {
        "id": str(app.id),
        "school": app.school_name,
        "list": app.list_type,
        "round": app.round,
        "status": app.status,
    }
    for key, value in (
        ("deadline", _iso(app.deadline)),
        ("aid_deadline", _iso(app.aid_deadline)),
        ("scholarship_deadline", _iso(app.scholarship_deadline)),
        ("major", app.intended_major),
        ("test_plan", app.test_plan),
    ):
        if value is not None:
            row[key] = value
    row["tasks"] = f"{app.progress.completed}/{app.progress.total}"
    row["essays"] = f"{app.essays.completed}/{app.essays.total}"
    notes = _truncate_notes(app.notes)
    if notes is not None:
        row["notes"] = notes
    if state is not None:
        row["state"] = state
    return row


def _render_task_line(task: Task) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status,
        "category": task.category,
    }
    if task.due_at is not None:
        row["due"] = task.due_at.date().isoformat()
    return row


def _render_essay_line(essay: EssaySummary) -> dict[str, Any]:
    return {
        "id": str(essay.id),
        "title": essay.title,
        "type": essay.essay_type,
        "status": essay.status,
    }


# --------------------------------------------------------------------------
# search_schools (national catalog discovery)
# --------------------------------------------------------------------------


def make_search_schools_tool(ctx: ToolCtx) -> Tool[Any]:
    async def search_schools_tool(query: str, limit: int = 8) -> dict[str, Any]:
        """Search the national catalog of US colleges by name — the way to find a
        school's id before adding it to the student's list.

        This searches ALL colleges, not just the ones on the student's list. Each
        result carries a unitid (the id add_schools needs), the school's city/state,
        and on_list: true when the student already has this school on their list.

        Search by the school's real name, not a nickname or abbreviation the catalog
        may not store: search "Mississippi", not "Ole Miss"; "California Polytechnic
        San Luis Obispo", not "Cal Poly SLO"; the single most distinctive word
        ("Vanderbilt", "Bowdoin") when unsure. If a query finds nothing, try the
        official full name, then a shorter distinctive fragment, and try once or
        twice more BEFORE telling the student the school isn't in the catalog — a
        false "it's not available" misleads them just like an invented fact.

        When several schools share a name (many "Columbia"s, "Washington
        University"s), use the city/state on each result to pick the right one; if
        still unsure, ask the student rather than guess a unitid. Never guess or
        construct a unitid. To see or change schools already on the list, use
        view_schools.

        Args:
            query: The school's real name, or a distinctive part of it (e.g. "duke",
                "georgia institute of technology").
            limit: Maximum matches, best first (default 8, max 25).
        """
        payload = await _search_schools_impl(ctx, query, limit)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="search_schools")  # type: ignore[no-any-return]

    return Tool(search_schools_tool, takes_ctx=False, name="search_schools")


def _render_catalog_hit(hit: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"unitid": hit.unitid, "name": hit.name}
    location = ", ".join(part for part in (hit.city, hit.state) if part)
    if location:
        row["location"] = location
    if hit.on_list:
        row["on_list"] = True
    return row


async def _search_schools_impl(ctx: ToolCtx, query: str, limit: int) -> dict[str, Any]:
    limit = max(1, min(limit, 25))
    hits = await search_schools(
        ctx.catalog, ctx.app_pool, user_id=ctx.user_id, query=query, limit=limit
    )
    if not hits:
        return {
            "status": "ok",
            "today": today(),
            "summary": f'No colleges in the catalog matched "{query}".',
            "schools": [],
            "footer": (
                "Try the official full name, then the single most distinctive word (e.g. "
                '"Mississippi" instead of "Ole Miss"), and search once or twice more before '
                "telling the student the school isn't in the catalog."
            ),
        }
    footer = "Use a unitid with add_schools to put that school on the student's list."
    if len(hits) > 1:
        footer = (
            "Several schools matched — use each one's city/state to pick the right one, then "
            "its unitid with add_schools."
        )
    return {
        "status": "ok",
        "today": today(),
        "summary": f'Found {len(hits)} college{"" if len(hits) == 1 else "s"} matching "{query}".',
        "schools": [_render_catalog_hit(hit) for hit in hits],
        "footer": footer,
    }


# --------------------------------------------------------------------------
# view_schools (the student's list)
# --------------------------------------------------------------------------


def make_view_schools_tool(ctx: ToolCtx) -> Tool[Any]:
    async def view_schools(
        status: Literal["active", "archived", "all"] = "active",
        limit: int = 40,
    ) -> dict[str, Any]:
        """View the student's school list — the shared workspace you both see.

        Each school shows its list type (Reach/Target/Safety), application round,
        status, deadlines, intended major, test plan, and how many of its tasks and
        essays are done (x/y). Call this before discussing, adding, or changing
        schools — it returns the exact application ids that get_school,
        update_school, and archive_schools all require.

        Args:
            status: "active" (default) = schools on the list now; "archived" =
                removed schools (restore_school brings one back); "all" = both,
                each flagged with its state.
            limit: Maximum rows (default 40 — more than any real list).
        """
        payload = await _view_schools_impl(ctx, status, limit)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="view_schools")  # type: ignore[no-any-return]

    return Tool(view_schools, takes_ctx=False)


async def _archived_school_rows(ctx: ToolCtx) -> list[dict[str, Any]]:
    async with ctx.app_pool.acquire() as conn:
        rows = await conn.fetch(_ARCHIVED_SCHOOLS_SQL, ctx.user_id)
    out: list[dict[str, Any]] = []
    for row in rows:
        name = ctx.catalog.school_name(row["school_unitid"]) or f"School {row['school_unitid']}"
        # Key order mirrors render_school_row (id, school, list, round, status,
        # deadline, …), with state/archived trailing — archived rows carry no
        # task/essay rollups (that read is skipped for the recovery path).
        item: dict[str, Any] = {
            "id": str(row["id"]),
            "school": name,
            "list": row["list_type"],
            "round": row["round"],
            "status": row["status"],
        }
        if row["deadline"] is not None:
            item["deadline"] = row["deadline"].isoformat()
        item["state"] = "archived"
        item["archived"] = row["archived_at"].date().isoformat()
        out.append(item)
    return out


async def _view_schools_impl(ctx: ToolCtx, status: str, limit: int) -> dict[str, Any]:
    active: list[dict[str, Any]] = []
    if status in ("active", "all"):
        apps = await list_applications(ctx.app_pool, ctx.catalog, user_id=ctx.user_id)
        state = "active" if status == "all" else None
        active = [render_school_row(app, state=state) for app in apps]

    archived: list[dict[str, Any]] = []
    if status in ("archived", "all"):
        archived = await _archived_school_rows(ctx)

    # One combined cap (not per-slice) so status="all" never returns 2×limit rows.
    schools = (active + archived)[:limit]
    if not schools:
        summary = {
            "active": "The student's school list is empty.",
            "archived": "No archived schools.",
            "all": "The student has no schools, active or archived.",
        }[status]
        payload: dict[str, Any] = {
            "status": "ok",
            "today": today(),
            "summary": summary,
            "schools": [],
        }
        if status in ("active", "all"):
            payload["footer"] = (
                "Find schools with search_schools, then add them with add_schools."
            )
        return payload

    label = {"active": "active", "archived": "archived", "all": ""}[status]
    noun = f"{label} school" if label else "school"
    return {
        "status": "ok",
        "today": today(),
        "summary": f"{len(schools)} {noun}{'' if len(schools) == 1 else 's'}.",
        "schools": schools,
        "footer": (
            "archive_schools removes a school (and its tasks/essays); restore_school "
            "undoes it. Task/essay counts show as done/total."
        ),
    }


# --------------------------------------------------------------------------
# get_school (one school's tasks + essays)
# --------------------------------------------------------------------------


def make_get_school_tool(ctx: ToolCtx) -> Tool[Any]:
    async def get_school(application_id: str) -> dict[str, Any]:
        """Look inside one school on the student's list: its full record plus every
        task and essay linked to it. Use this to answer "what's left for Duke?" or
        before advising on a specific school's remaining work.

        application_id must be an exact id echoed from a view_schools result — never
        a guessed or constructed id. This works on active schools only; to look
        inside an archived school, restore_school it first.

        Args:
            application_id: The school's application id, from view_schools.
        """
        payload = await _get_school_impl(ctx, application_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="get_school")  # type: ignore[no-any-return]

    return Tool(get_school, takes_ctx=False)


async def _get_school_impl(ctx: ToolCtx, application_id: str) -> dict[str, Any]:
    from app.workspace.agent_tools_shared import error, stale_school_recovery
    from app.workspace.models import WorkspaceNotFoundError

    parsed = try_uuid(application_id)
    if parsed is None:
        return error(
            f'No school with id "{application_id}" — it may be archived or the id may be stale.',
            retryable=False,
            recovery=stale_school_recovery(),
        )
    try:
        detail = await get_application_detail(
            ctx.app_pool, ctx.catalog, user_id=ctx.user_id, application_id=parsed
        )
    except WorkspaceNotFoundError:
        return error(
            f'No active school with id "{application_id}". It may have been archived, or the '
            "id may be stale.",
            retryable=False,
            recovery=stale_school_recovery(),
        )
    school = render_school_row(detail.application)
    return {
        "status": "ok",
        "today": today(),
        "summary": (
            f"{detail.application.school_name}: {len(detail.tasks)} "
            f"task{'' if len(detail.tasks) == 1 else 's'}, {len(detail.essays)} "
            f"essay{'' if len(detail.essays) == 1 else 's'}."
        ),
        "school": school,
        "tasks": [_render_task_line(task) for task in detail.tasks],
        "essays": [_render_essay_line(essay) for essay in detail.essays],
    }
