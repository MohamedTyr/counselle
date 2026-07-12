"""Per-run agent tools that give the Counselle agent direct control over tasks.

Six PydanticAI function tools (view/search/create/update/archive/restore) wrap
``service_tasks`` directly with ``actor="counselle"`` — same transaction, same
change log, same live SSE invalidation as the HTTP routes (plans/
agent-task-tools.md Part A). Mount gate, StepKind, and wiring live in later
phases; this module only builds the closures.

``view_tasks``/``search_tasks`` live here; ``create_tasks``/``update_task``/
``archive_tasks``/``restore_task`` live in ``agent_tools_mutations.py`` —
split purely to stay under the file-size convention (Part A is one dense
spec; six full closures plus shared rendering logic don't fit in 800 lines).

Legacy-replay caution: a GraphInterrupt re-execution could re-run
``create_tasks`` (no idempotency keys yet); V1 mounts no ``ask_student``
alongside these tools, which is what keeps that exposure low today.

Deviation from the plan's literal 4-arg factory signature: ``view_tasks``'s
``link_targets`` (and every "app"/"essay" name shown on a task row) requires
resolving a school name from a ``unitid``, which lives in the read-only
catalog database (``counselle_ro``), not the app-role ``app_pool`` — see
``service_applications.list_applications`` / ``service_essays.list_essays``,
which both already take a ``Catalog`` alongside ``app_pool`` for exactly this
reason. ``build_workspace_tools`` therefore takes ``catalog`` too; the Phase 4
mount site already has ``deps.catalog`` in scope.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import asyncpg
from pydantic_ai import Tool

from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.workspace import service_tasks
from app.workspace.agent_tools_activities import make_view_activities_tool
from app.workspace.agent_tools_activities_mutations import (
    make_archive_activities_tool,
    make_create_activities_tool,
    make_reorder_activities_tool,
    make_restore_activity_tool,
    make_update_activity_tool,
)
from app.workspace.agent_tools_essays import make_read_essay_tool, make_view_essays_tool
from app.workspace.agent_tools_essays_content import make_edit_essay_tool, make_write_essay_tool
from app.workspace.agent_tools_essays_mutations import (
    make_archive_essays_tool,
    make_create_essays_tool,
    make_duplicate_essay_tool,
    make_restore_essay_tool,
    make_update_essay_tool,
)
from app.workspace.agent_tools_honors_mutations import (
    make_archive_honors_tool,
    make_create_honors_tool,
    make_reorder_honors_tool,
    make_restore_honor_tool,
    make_update_honor_tool,
)
from app.workspace.agent_tools_memory import (
    make_forget_tool,
    make_remember_tool,
    make_update_memory_tool,
)
from app.workspace.agent_tools_mutations import (
    make_archive_tasks_tool,
    make_create_tasks_tool,
    make_restore_task_tool,
    make_update_task_tool,
)
from app.workspace.agent_tools_profile import (
    make_read_document_tool,
    make_update_profile_tool,
    make_view_documents_tool,
)
from app.workspace.agent_tools_schools import (
    make_get_school_tool,
    make_search_schools_tool,
    make_view_schools_tool,
)
from app.workspace.agent_tools_schools_mutations import (
    make_add_schools_tool,
    make_archive_schools_tool,
    make_restore_school_tool,
    make_update_school_tool,
)
from app.workspace.agent_tools_shared import (
    ACTIVE_STATUSES,
    PRIORITY_ORDER,
    ToolCtx,
    active_workspace_links,
    link_targets,
    render_task_row,
    today,
    try_uuid,
)

#: Re-exported so callers can do ``from app.workspace.agent_tools import ActivityDraft``.
from app.workspace.agent_tools_shared import ActivityDraft as ActivityDraft  # noqa: E402

#: Re-exported so callers can do ``from app.workspace.agent_tools import EssayDraft``.
from app.workspace.agent_tools_shared import EssayDraft as EssayDraft  # noqa: E402

#: Re-exported so callers can do ``from app.workspace.agent_tools import HonorDraft``.
from app.workspace.agent_tools_shared import HonorDraft as HonorDraft  # noqa: E402

#: Re-exported so callers can do ``from app.workspace.agent_tools import TaskDraft``.
from app.workspace.agent_tools_shared import TaskDraft as TaskDraft  # noqa: E402
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationView,
    Task,
    TaskBoardCounts,
    TaskSearchHit,
    TaskStatus,
)
from counselle_db.catalog import Catalog

_MAX_MATCH_CHARS = 140


def build_workspace_tools(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    workspace_events: WorkspaceEventBus,
    user_id: UUID,
    tool_overflow: ToolMiddlewareContext | None,
) -> list[Tool[Any]]:
    """Build the per-run workspace tools bound to one authenticated turn.

    Six task tools (view/search/create/update/archive/restore), seven school
    tools (search/view/get/add/update/archive/restore), nine essay tools —
    general control (view/create/update/duplicate/archive/restore) plus
    specialized document control (read/edit/write, ADR 0030) — eleven
    activity/honor tools: one shared read (``view_activities``, both lists in
    one payload) plus five mutations per object type
    (create/update/archive/restore/reorder) — and the six profile/memory
    tools (plans/user-profile-and-memory.md Part E): ``update_profile``,
    ``view_documents``, ``read_document`` (student documents, not essays),
    ``remember``, ``update_memory``, ``forget``.
    """
    ctx = ToolCtx(
        app_pool=app_pool,
        catalog=catalog,
        workspace_events=workspace_events,
        user_id=user_id,
        tool_overflow=tool_overflow,
    )
    return [
        _make_view_tasks_tool(ctx),
        _make_search_tasks_tool(ctx),
        make_create_tasks_tool(ctx),
        make_update_task_tool(ctx),
        make_archive_tasks_tool(ctx),
        make_restore_task_tool(ctx),
        make_search_schools_tool(ctx),
        make_view_schools_tool(ctx),
        make_get_school_tool(ctx),
        make_add_schools_tool(ctx),
        make_update_school_tool(ctx),
        make_archive_schools_tool(ctx),
        make_restore_school_tool(ctx),
        make_view_essays_tool(ctx),
        make_read_essay_tool(ctx),
        make_create_essays_tool(ctx),
        make_update_essay_tool(ctx),
        make_duplicate_essay_tool(ctx),
        make_archive_essays_tool(ctx),
        make_restore_essay_tool(ctx),
        make_edit_essay_tool(ctx),
        make_write_essay_tool(ctx),
        make_view_activities_tool(ctx),
        make_create_activities_tool(ctx),
        make_update_activity_tool(ctx),
        make_archive_activities_tool(ctx),
        make_restore_activity_tool(ctx),
        make_reorder_activities_tool(ctx),
        make_create_honors_tool(ctx),
        make_update_honor_tool(ctx),
        make_archive_honors_tool(ctx),
        make_restore_honor_tool(ctx),
        make_reorder_honors_tool(ctx),
        make_update_profile_tool(ctx),
        make_view_documents_tool(ctx),
        make_read_document_tool(ctx),
        make_remember_tool(ctx),
        make_update_memory_tool(ctx),
        make_forget_tool(ctx),
    ]


# --------------------------------------------------------------------------
# A.1 view_tasks
# --------------------------------------------------------------------------


def _make_view_tasks_tool(ctx: ToolCtx) -> Tool[Any]:
    async def view_tasks(
        status: Literal["active", "todo", "doing", "waiting", "done", "all"] = "active",
        application_id: str | None = None,
        essay_id: str | None = None,
        done_within_days: int = 30,
        limit: int = 25,
    ) -> dict[str, Any]:
        """View the student's task board — the shared workspace you and the student both see.

        Defaults to the active working set (todo, doing, waiting), sorted by urgency:
        earliest due date first (undated last), then priority high to low. Call this
        before discussing, creating, or changing tasks — it returns current task ids,
        and every mutation tool requires an id echoed from here or from search_tasks.

        The result also lists link_targets: the active applications and essays
        (id · name) that tasks can link to. Use those exact ids for application_id /
        essay_id when creating or updating tasks.

        Completed tasks are hidden by default; the footer says how many exist and how
        recent they are. Fetch them with status="done". Archived tasks never appear
        here — search_tasks finds them.

        Args:
            status: Which slice to show. "active" (default) = todo + doing + waiting;
                a single status name; or "all" = active plus done.
            application_id: Only tasks linked to this application (exact id from
                link_targets).
            essay_id: Only tasks linked to this essay (exact id from link_targets).
            done_within_days: When done tasks are in scope, only those completed in
                the last N days (default 30). Raise it to look further back.
            limit: Maximum rows returned (default 25). The footer reports anything
                beyond the cap and how to narrow.
        """
        payload = await _view_tasks_impl(
            ctx, status, application_id, essay_id, done_within_days, limit
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="view_tasks")  # type: ignore[no-any-return]

    return Tool(view_tasks, takes_ctx=False)


def _statuses_for(status: str) -> list[TaskStatus] | None:
    if status == "active":
        return list(ACTIVE_STATUSES)
    if status == "all":
        return None
    return [status]  # type: ignore[list-item]


def _sort_tasks(tasks: list[Task], status: str) -> list[Task]:
    if status == "done":
        return sorted(
            tasks, key=lambda t: t.completed_at or datetime.min.replace(tzinfo=UTC), reverse=True
        )
    return sorted(
        tasks,
        key=lambda t: (
            t.due_at is None,
            t.due_at or datetime.max.replace(tzinfo=UTC),
            PRIORITY_ORDER.get(t.priority, 3),
            t.created_at,
        ),
    )


def _empty_board_footer(apps: list[ApplicationView]) -> str:
    if apps:
        return (
            "The board is empty — consider offering starter tasks with create_tasks, "
            "linked to the student's active applications in link_targets below."
        )
    return (
        "The board is empty — consider offering starter tasks with create_tasks once "
        "the student has applications."
    )


def _showing_footer(
    *,
    label: str,
    shown: int,
    total: int,
    limit: int,
    counts: TaskBoardCounts,
    done_within_days: int,
    status: str,
) -> str:
    if total > limit:
        base = f"Showing {limit} of {total} — narrow with application_id, essay_id, or status."
    else:
        base = f"Showing {shown} of {total} {label} tasks."
    tail: list[str] = []
    if status != "done":
        if counts.done > 0:
            tail.append(
                f"{counts.done} done ({counts.done_recent} in the last {done_within_days} "
                'days) — view_tasks(status="done") to see them.'
            )
        if counts.archived > 0:
            tail.append(f"{counts.archived} archived — search_tasks finds them.")
    return " ".join([base, *tail])


async def _view_tasks_impl(
    ctx: ToolCtx,
    status: str,
    application_id: str | None,
    essay_id: str | None,
    done_within_days: int,
    limit: int,
) -> dict[str, Any]:
    apps, essays = await active_workspace_links(ctx)
    app_names = {app.id: app.school_name for app in apps}
    essay_names = {essay.id: essay.title for essay in essays}
    targets = link_targets(apps, essays)

    app_filter = try_uuid(application_id) if application_id else None
    essay_filter = try_uuid(essay_id) if essay_id else None
    filter_unmatchable = (application_id is not None and app_filter is None) or (
        essay_id is not None and essay_filter is None
    )

    statuses = _statuses_for(status)
    completed_after = (
        datetime.now(UTC) - timedelta(days=done_within_days) if status == "done" else None
    )

    tasks = (
        []
        if filter_unmatchable
        else await service_tasks.list_tasks(
            ctx.app_pool,
            user_id=ctx.user_id,
            statuses=statuses,
            application_id=app_filter,
            essay_id=essay_filter,
            completed_after=completed_after,
        )
    )
    tasks = _sort_tasks(tasks, status)
    total = len(tasks)
    rows = [
        render_task_row(
            task,
            app_name=app_names.get(task.application_id) if task.application_id else None,
            essay_name=essay_names.get(task.essay_id) if task.essay_id else None,
            include_completed=task.status == "done",
        )
        for task in tasks[:limit]
    ]
    label = status

    if not rows and (application_id is not None or essay_id is not None):
        linked_name = (
            (app_names.get(app_filter) if app_filter is not None else None)
            or (essay_names.get(essay_filter) if essay_filter is not None else None)
            or "that filter"
        )
        elsewhere = await service_tasks.list_tasks(
            ctx.app_pool, user_id=ctx.user_id, statuses=statuses, completed_after=completed_after
        )
        elsewhere_total = len(elsewhere)
        footer = (
            f"{elsewhere_total} {label} tasks exist elsewhere — call view_tasks() without filters."
            if elsewhere_total
            else _empty_board_footer(apps)
        )
        return {
            "status": "ok",
            "today": today(),
            "summary": f"No {label} tasks linked to {linked_name}.",
            "tasks": [],
            "link_targets": targets,
            "footer": footer,
        }

    if not rows:
        payload: dict[str, Any] = {
            "status": "ok",
            "today": today(),
            "summary": f"No {label} tasks.",
            "tasks": [],
            "link_targets": targets,
        }
        if status in ("active", "all"):
            payload["footer"] = _empty_board_footer(apps)
        return payload

    counts = await service_tasks.task_board_counts(
        ctx.app_pool, user_id=ctx.user_id, done_within_days=done_within_days
    )
    shown = len(rows)
    return {
        "status": "ok",
        "today": today(),
        "summary": f"{shown} {label} task{'' if shown == 1 else 's'}.",
        "tasks": rows,
        "link_targets": targets,
        "footer": _showing_footer(
            label=label,
            shown=shown,
            total=total,
            limit=limit,
            counts=counts,
            done_within_days=done_within_days,
            status=status,
        ),
    }


# --------------------------------------------------------------------------
# A.2 search_tasks
# --------------------------------------------------------------------------


def _make_search_tasks_tool(ctx: ToolCtx) -> Tool[Any]:
    async def search_tasks(query: str, limit: int = 15) -> dict[str, Any]:
        """Full-text search across ALL of the student's tasks — active, completed, and
        archived. Matches title and notes, tolerates typos and partial words.

        Use this to find a specific task that isn't in the view_tasks active set:
        past work ("did we finish the FAFSA?"), possibly-archived items, or anything
        you remember by wording rather than by id.

        Query tips: use plain keywords, not sentences. Include synonyms joined with
        OR — students and counselors name the same work differently ("LOR OR
        recommendation OR rec letter", "aid OR FAFSA OR CSS profile"). Quoted phrases
        match exactly; prefix a word with - to exclude it. If a query finds nothing,
        rephrase with different synonyms and try once or twice more BEFORE concluding
        the task does not exist — a false "there's no such task" misleads the student
        just like an invented fact does.

        Every hit carries state: "active", "done", or "archived". Archived hits are
        off the student's board; offer restore_task if the student wants one back.

        Args:
            query: Keywords with OR-joined synonyms. Not a full sentence.
            limit: Maximum hits, most relevant first (default 15).
        """
        payload = await _search_tasks_impl(ctx, query, limit)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="search_tasks")  # type: ignore[no-any-return]

    return Tool(search_tasks, takes_ctx=False)


def _format_match(match: str | None, title: str) -> str | None:
    if not match:
        return None
    truncated = match if len(match) <= _MAX_MATCH_CHARS else match[:_MAX_MATCH_CHARS] + "…"
    plain = truncated.replace("«", "").replace("»", "").strip()
    if plain.lower() == title.strip().lower():
        return None
    return truncated


def _render_search_row(hit: TaskSearchHit) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(hit.id),
        "title": hit.title,
        "status": hit.status,
        "category": hit.category,
        "state": hit.state,
    }
    match = _format_match(hit.match, hit.title)
    if match is not None:
        row["match"] = match
    if hit.state == "archived" and hit.archived_at is not None:
        row["archived"] = hit.archived_at.date().isoformat()
    return row


async def _search_tasks_impl(ctx: ToolCtx, query: str, limit: int) -> dict[str, Any]:
    hits = await service_tasks.search_tasks(
        ctx.app_pool, user_id=ctx.user_id, query=query, limit=limit
    )
    if not hits:
        return {
            "status": "ok",
            "today": today(),
            "summary": f'No tasks matched "{query}".',
            "tasks": [],
            "footer": (
                'Try different keywords or synonyms joined with OR (e.g. "LOR OR '
                'recommendation OR rec letter") before concluding the task does not exist.'
            ),
        }
    rows = [_render_search_row(hit) for hit in hits]
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f'Found {len(hits)} task{"" if len(hits) == 1 else "s"} matching "{query}".',
        "tasks": rows,
    }
    if any(hit.state == "archived" for hit in hits):
        payload["footer"] = "Archived hits can be restored with restore_task(...)"
    return payload
