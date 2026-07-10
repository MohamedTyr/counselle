"""Read and render the student's Common App activities and honors.

``view_activities`` deliberately returns both lists: together they are the
small, shared Activities workspace surface. Mutation tools reuse the row
renderers below in later phases.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace.agent_tools_shared import (
    DESCRIPTION_CHAR_LIMIT,
    HONOR_TITLE_CHAR_LIMIT,
    MAX_ACTIVITIES,
    MAX_HONORS,
    ORGANIZATION_CHAR_LIMIT,
    POSITION_CHAR_LIMIT,
    ToolCtx,
    today,
)
from app.workspace.models import Activity, Honor
from app.workspace.service_activities import list_activities, list_honors

_ARCHIVED_ROWS_SQL = {
    "activities": """
        SELECT *
        FROM counselle.activities
        WHERE user_id = $1 AND archived_at IS NOT NULL
        ORDER BY archived_at DESC
        """,
    "honors": """
        SELECT *
        FROM counselle.honors
        WHERE user_id = $1 AND archived_at IS NOT NULL
        ORDER BY archived_at DESC
        """,
}


def _common_app_char_count(value: str) -> int:
    """Count exported characters using Python's exact string length."""
    return len(value)


def _chars(label: str, value: str, limit: int) -> str:
    """Render the exact Common App character budget for one exported field."""
    count = _common_app_char_count(value)
    suffix = " OVER" if count > limit else ""
    return f"{label} {count}/{limit}{suffix}"


def activity_chars(activity: Activity) -> str:
    """Exact, never-rounded budgets for an activity's export-facing fields."""
    return " · ".join(
        (
            _chars("position", activity.position, POSITION_CHAR_LIMIT),
            _chars("org", activity.organization, ORGANIZATION_CHAR_LIMIT),
            _chars("desc", activity.description, DESCRIPTION_CHAR_LIMIT),
        )
    )


def honor_chars(honor: Honor) -> str:
    """Exact, never-rounded budget for an honor's export-facing title."""
    return _chars("title", honor.title, HONOR_TITLE_CHAR_LIMIT)


def activity_over_limit(activity: Activity) -> bool:
    return any(
        _common_app_char_count(value) > limit
        for value, limit in (
            (activity.position, POSITION_CHAR_LIMIT),
            (activity.organization, ORGANIZATION_CHAR_LIMIT),
            (activity.description, DESCRIPTION_CHAR_LIMIT),
        )
    )


def honor_over_limit(honor: Honor) -> bool:
    return _common_app_char_count(honor.title) > HONOR_TITLE_CHAR_LIMIT


def render_activity_row(
    activity: Activity, *, rank: int | None = None, state: str | None = None
) -> dict[str, Any]:
    """One activity row in fixed key order, omitting empty optional values."""
    row: dict[str, Any] = {}
    if rank is not None:
        row["rank"] = rank
    row.update(
        {
            "id": str(activity.id),
            "type": activity.activity_type,
            "position": activity.position,
            "organization": activity.organization,
            "description": activity.description,
            "grades": activity.grades,
            "timing": activity.timing,
        }
    )
    for key, value in (
        ("hours_per_week", activity.hours_per_week),
        ("weeks_per_year", activity.weeks_per_year),
        ("continue", activity.continue_in_college),
    ):
        if value is not None:
            row[key] = value
    row["chars"] = activity_chars(activity)
    if activity.story:
        row["story"] = activity.story
    if state is not None:
        row["state"] = state
    if state == "archived" and activity.archived_at is not None:
        row["archived"] = activity.archived_at.date().isoformat()
    return row


def render_honor_row(
    honor: Honor, *, rank: int | None = None, state: str | None = None
) -> dict[str, Any]:
    """One honor row in fixed key order, omitting archive metadata when absent."""
    row: dict[str, Any] = {}
    if rank is not None:
        row["rank"] = rank
    row.update(
        {
            "id": str(honor.id),
            "title": honor.title,
            "grades": honor.grades,
            "levels": honor.levels,
            "chars": honor_chars(honor),
        }
    )
    if state is not None:
        row["state"] = state
    if state == "archived" and honor.archived_at is not None:
        row["archived"] = honor.archived_at.date().isoformat()
    return row


async def _archived_rows(ctx: ToolCtx) -> tuple[list[Activity], list[Honor]]:
    async with ctx.app_pool.acquire() as conn:
        activity_rows = await conn.fetch(_ARCHIVED_ROWS_SQL["activities"], ctx.user_id)
        honor_rows = await conn.fetch(_ARCHIVED_ROWS_SQL["honors"], ctx.user_id)
    return (
        [Activity.model_validate(dict(row)) for row in activity_rows],
        [Honor.model_validate(dict(row)) for row in honor_rows],
    )


def _summary(activity_count: int, honor_count: int) -> str:
    return (
        f"{activity_count} of {MAX_ACTIVITIES} activity slots · "
        f"{honor_count} of {MAX_HONORS} honor slots."
    )


def _footer(
    *,
    status: str,
    activities: list[Activity],
    honors: list[Honor],
    archived_activities: list[Activity],
    archived_honors: list[Honor],
) -> str:
    if status == "archived" and not archived_activities and not archived_honors:
        return "No archived activities or honors. Call view_activities() to see the current page."
    if not activities and not honors and not archived_activities and not archived_honors:
        return (
            "The activity board is empty — ask about the student's extracurriculars, then "
            "create_activities."
        )

    parts: list[str] = []
    if activities or honors:
        parts.append(
            "Rank is Common App importance order: 1 is the headline. Use "
            "reorder_activities or reorder_honors to change it."
        )
    visible_activities = [*activities, *archived_activities]
    visible_honors = [*honors, *archived_honors]
    if any(activity_over_limit(item) for item in visible_activities) or any(
        honor_over_limit(item) for item in visible_honors
    ):
        parts.append("One or more entries are over the Common App character limit and need a trim.")
    elif visible_activities or visible_honors:
        parts.append("Over-limit entries are flagged in chars and warrant a trim.")
    if archived_activities or archived_honors:
        parts.append("Archived entries can be brought back with restore_activity or restore_honor.")
    return " ".join(parts)


def make_view_activities_tool(ctx: ToolCtx) -> Tool[Any]:
    """Build the one read tool for the Activities and Honors workspace page."""

    async def view_activities(
        status: Literal["active", "archived", "all"] = "active",
    ) -> dict[str, Any]:
        """View the student's full Activities and Honors page.

        Call this before discussing or changing activities or honors: it returns the
        current exact ids and Common App importance ranks. The full private ``story``
        is included when present so it can be distilled truthfully; it is never an
        export field. ``chars`` reports exact Common App budgets, and ``OVER`` means
        the entry must be trimmed before it can be submitted.

        Args:
            status: "active" (default) shows the current page; "archived" shows
                removed entries that restore_activity or restore_honor can bring back;
                "all" returns both, each marked with its state.
        """
        payload = await _view_activities_impl(ctx, status)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="view_activities")  # type: ignore[no-any-return]

    return Tool(view_activities, takes_ctx=False)


async def _view_activities_impl(ctx: ToolCtx, status: str) -> dict[str, Any]:
    active_activities = await list_activities(ctx.app_pool, user_id=ctx.user_id)
    active_honors = await list_honors(ctx.app_pool, user_id=ctx.user_id)

    archived_activities: list[Activity] = []
    archived_honors: list[Honor] = []
    if status in ("archived", "all"):
        archived_activities, archived_honors = await _archived_rows(ctx)

    activity_rows: list[dict[str, Any]] = []
    honor_rows: list[dict[str, Any]] = []
    if status in ("active", "all"):
        active_state = "active" if status == "all" else None
        activity_rows.extend(
            render_activity_row(item, rank=index, state=active_state)
            for index, item in enumerate(active_activities, start=1)
        )
        honor_rows.extend(
            render_honor_row(item, rank=index, state=active_state)
            for index, item in enumerate(active_honors, start=1)
        )
    if status in ("archived", "all"):
        activity_rows.extend(
            render_activity_row(item, state="archived") for item in archived_activities
        )
        honor_rows.extend(render_honor_row(item, state="archived") for item in archived_honors)

    return {
        "status": "ok",
        "today": today(),
        "summary": _summary(len(active_activities), len(active_honors)),
        "activities": activity_rows,
        "honors": honor_rows,
        "footer": _footer(
            status=status,
            activities=active_activities if status in ("active", "all") else [],
            honors=active_honors if status in ("active", "all") else [],
            archived_activities=archived_activities,
            archived_honors=archived_honors,
        ),
    }
