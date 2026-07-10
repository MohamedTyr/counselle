"""Shared context, constants, and rendering helpers for the workspace agent tools.

Split out of ``agent_tools.py`` purely to keep each module under the file-size
convention — shared by every workspace tool module (tasks, schools, essays,
activities, honors). No public surface of its own beyond what those modules
re-export.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any, Literal
from uuid import UUID

import asyncpg
from pydantic import BaseModel, Field

from app.tool_middleware import ToolMiddlewareContext
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    ApplicationView,
    Assignee,
    EssayStatus,
    EssaySummary,
    EssayType,
    Task,
    TaskCategory,
    TaskPriority,
    TaskStatus,
    WorkspaceSeedingTemplate,
)
from app.workspace.service_activities import ACTIVITY_CAP, HONOR_CAP
from app.workspace.service_applications import list_applications
from app.workspace.service_essays import list_essays
from counselle_db.catalog import Catalog

MAX_NOTES_CHARS = 120
LINK_TARGET_CAP = 30
BATCH_MIN = 1
BATCH_MAX = 20
DUPLICATE_SIMILARITY_THRESHOLD = 0.6
ACTIVE_STATUSES: list[TaskStatus] = ["todo", "doing", "waiting"]
PRIORITY_ORDER = {"high": 0, "med": 1, "low": 2}

# Mirrors ``frontend/src/domain/activity.ts``. Confirm the Common App
# vocabulary against the live form each admissions cycle before changing it.
ActivityType = Literal[
    "Academic",
    "Art",
    "Athletics: Club",
    "Athletics: JV/Varsity",
    "Career Oriented",
    "Community Service (Volunteer)",
    "Computer/Technology",
    "Cultural",
    "Dance",
    "Debate/Speech",
    "Environmental",
    "Family Responsibilities",
    "Foreign Exchange",
    "Foreign Language",
    "Internship",
    "Journalism/Publication",
    "Junior R.O.T.C.",
    "LGBT",
    "Music: Instrumental",
    "Music: Vocal",
    "Religious",
    "Research",
    "Robotics",
    "School Spirit",
    "Science/Math",
    "Social Justice",
    "Student Govt./Politics",
    "Theater/Drama",
    "Work (Paid)",
    "Other Club/Activity",
]
Grade = Literal["9", "10", "11", "12", "pg"]
Timing = Literal["school_year", "break", "all_year"]
RecognitionLevel = Literal["school", "state_regional", "national", "international"]

POSITION_CHAR_LIMIT = 50
ORGANIZATION_CHAR_LIMIT = 100
DESCRIPTION_CHAR_LIMIT = 150
HONOR_TITLE_CHAR_LIMIT = 100
HOURS_MAX = 168
WEEKS_MAX = 52
# Slot limits are owned and enforced in ``service_activities``; the aliases
# keep tool-facing names descriptive without duplicating those values.
MAX_ACTIVITIES = ACTIVITY_CAP
MAX_HONORS = HONOR_CAP

STALE_TASK_RECOVERY = (
    "Call view_tasks to see current active tasks and their ids, or search_tasks if it may be "
    "done or archived (archived tasks come back with restore_task). Do not retry this same id."
)
DATE_RECOVERY = (
    'Resubmit with the date as YYYY-MM-DD, e.g. "2026-07-15". Pass "clear" to remove a date.'
)
LINK_RECOVERY = (
    "Pick the exact id from link_targets below and resubmit the whole batch, or omit the "
    "link if none fits."
)


class TaskDraft(BaseModel):
    """One task to create in a ``create_tasks`` batch."""

    title: str
    notes: str | None = None
    status: TaskStatus = "todo"
    category: TaskCategory = "other"
    priority: TaskPriority = "med"
    assignee: Assignee = "student"
    needs_input: bool = False
    due: str | None = None
    planned_for: str | None = None
    reminder: str | None = None
    application_id: str | None = None
    essay_id: str | None = None


class EssayDraft(BaseModel):
    """One essay to create in a ``create_essays`` batch."""

    title: str
    application_id: str | None = None
    essay_type: EssayType = "Supplement"
    status: EssayStatus = "Not started"
    prompt: str | None = None
    word_limit: int | None = None
    content_markdown: str | None = None


class ActivityDraft(BaseModel):
    """One Common App activity to create in a ``create_activities`` batch."""

    type: ActivityType
    position: str
    organization: str = ""
    description: str = ""
    grades: list[Grade] = Field(default_factory=list)
    timing: list[Timing] = Field(default_factory=list)
    hours_per_week: int | None = Field(default=None, ge=1, le=HOURS_MAX)
    weeks_per_year: int | None = Field(default=None, ge=1, le=WEEKS_MAX)
    continue_in_college: bool | None = None
    story: str | None = None


class HonorDraft(BaseModel):
    """One Common App honor to create in a ``create_honors`` batch."""

    title: str
    grades: list[Grade] = Field(default_factory=list)
    levels: list[RecognitionLevel] = Field(default_factory=list)


@dataclass(frozen=True)
class ToolCtx:
    app_pool: asyncpg.Pool
    catalog: Catalog
    workspace_events: WorkspaceEventBus
    user_id: UUID
    tool_overflow: ToolMiddlewareContext | None
    #: Starter tasks/essays seeded when the agent adds a school (``add_schools``).
    #: ``None`` on the task-only mount path; ``add_schools`` errors cleanly if unset.
    template: WorkspaceSeedingTemplate | None = None


def today() -> str:
    return datetime.now(UTC).date().isoformat()


def try_uuid(value: str) -> UUID | None:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


def error(message: str, *, retryable: bool, recovery: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "error",
        "error": message,
        "retryable": retryable,
        "recovery": recovery,
    }
    payload.update(extra)
    return payload


def stale_task_error(task_id: str) -> dict[str, Any]:
    return error(
        f'No active task with id "{task_id}". It may have been archived, completed and '
        "pruned from your view, or the id may be stale.",
        retryable=False,
        recovery=STALE_TASK_RECOVERY,
    )


def stale_school_recovery() -> str:
    return (
        "Call view_schools to see the student's current schools and their ids, or "
        'view_schools(status="archived") if it may have been removed (restore_school '
        "brings one back). Do not retry this same id."
    )


def stale_school_error(application_id: str) -> dict[str, Any]:
    return error(
        f'No active school with id "{application_id}". It may have been archived, or the id '
        "may be stale.",
        retryable=False,
        recovery=stale_school_recovery(),
    )


def stale_essay_recovery() -> str:
    return (
        "Call view_essays to see current essays and their ids, or "
        'view_essays(status="archived") if it may have been archived (restore_essay '
        "brings one back). Do not retry this same id."
    )


def stale_essay_error(essay_id: str) -> dict[str, Any]:
    return error(
        f'No active essay with id "{essay_id}". It may have been archived, or the id may be stale.',
        retryable=False,
        recovery=stale_essay_recovery(),
    )


def stale_activity_error(activity_id: str) -> dict[str, Any]:
    return error(
        f'No active activity with id "{activity_id}". It may have been archived, or the id '
        "may be stale.",
        retryable=False,
        recovery=(
            "Call view_activities to see the current lists and their ids (archived activities "
            "come back with restore_activity). Do not retry this same id."
        ),
    )


def stale_honor_error(honor_id: str) -> dict[str, Any]:
    return error(
        f'No active honor with id "{honor_id}". It may have been archived, or the id may be stale.',
        retryable=False,
        recovery=(
            "Call view_activities to see the current lists and their ids (archived honors come "
            "back with restore_honor). Do not retry this same id."
        ),
    )


def slot_cap_error(kind: Literal["activity", "honor"], cap: int, active: int) -> dict[str, Any]:
    plural = "activities" if kind == "activity" else "honors"
    return error(
        f"The Common App allows {cap} {plural}; this student already has {active} active.",
        retryable=True,
        recovery=f"Archive another {kind} first, or fold this into an existing entry.",
    )


def stale_version_error() -> dict[str, Any]:
    return error(
        "The essay changed since you read it (the student may be typing right now).",
        retryable=True,
        recovery="Call read_essay again and rebuild your edit against the current text.",
    )


def batch_size_error(tool_name: str, count: int) -> dict[str, Any]:
    return error(
        f"{tool_name} accepts {BATCH_MIN}-{BATCH_MAX} items per call; got {count}.",
        retryable=True,
        recovery=f"Split the batch into calls of {BATCH_MAX} or fewer and resubmit.",
    )


async def active_workspace_links(
    ctx: ToolCtx,
) -> tuple[list[ApplicationView], list[EssaySummary]]:
    apps = await list_applications(ctx.app_pool, ctx.catalog, user_id=ctx.user_id)
    essays = await list_essays(ctx.app_pool, ctx.catalog, user_id=ctx.user_id)
    return apps, essays


def link_targets(apps: list[ApplicationView], essays: list[EssaySummary]) -> dict[str, Any]:
    return {
        "applications": _cap_lines([_app_target_line(app) for app in apps]),
        "essays": _cap_lines([_essay_target_line(essay) for essay in essays]),
    }


def _app_target_line(app: ApplicationView) -> str:
    if app.deadline is not None:
        return f"{app.id} · {app.school_name} ({app.round}, deadline {app.deadline.isoformat()})"
    return f"{app.id} · {app.school_name} ({app.round})"


def _essay_target_line(essay: EssaySummary) -> str:
    if essay.school_name:
        return f"{essay.id} · {essay.title} ({essay.school_name})"
    return f"{essay.id} · {essay.title}"


def _cap_lines(lines: list[str], cap: int = LINK_TARGET_CAP) -> list[str]:
    if len(lines) <= cap:
        return lines
    return [*lines[:cap], f"+{len(lines) - cap} more"]


def application_name(application_id: UUID | None, apps: list[ApplicationView]) -> str | None:
    if application_id is None:
        return None
    return next((app.school_name for app in apps if app.id == application_id), None)


def essay_name(essay_id: UUID | None, essays: list[EssaySummary]) -> str | None:
    if essay_id is None:
        return None
    return next((essay.title for essay in essays if essay.id == essay_id), None)


def _fmt_date(value: datetime | None) -> str | None:
    return value.date().isoformat() if value is not None else None


def _truncate(text: str | None) -> str | None:
    if text is None:
        return None
    return text if len(text) <= MAX_NOTES_CHARS else text[:MAX_NOTES_CHARS] + "…"


def render_task_row(
    task: Task,
    *,
    app_name: str | None,
    essay_name: str | None,
    include_completed: bool = False,
    state: str | None = None,
) -> dict[str, Any]:
    """One task row, fixed key order, null/default-false fields omitted (Part A)."""
    row: dict[str, Any] = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status,
        "category": task.category,
        "priority": task.priority,
        "assignee": task.assignee,
    }
    if task.needs_input:
        row["needs_input"] = True
    for key, value in (
        ("due", _fmt_date(task.due_at)),
        ("planned", _fmt_date(task.planned_for)),
        ("reminder", _fmt_date(task.reminder_at)),
        ("app", app_name),
        ("essay", essay_name),
        ("notes", _truncate(task.notes)),
    ):
        if value is not None:
            row[key] = value
    if include_completed:
        completed = _fmt_date(task.completed_at)
        if completed is not None:
            row["completed"] = completed
    if state is not None:
        row["state"] = state
    return row


def validate_date_field(value: str, field: str) -> tuple[datetime | None, str | None]:
    """Parse a ``YYYY-MM-DD`` string; returns ``(parsed, None)`` or ``(None, error)``."""
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None, f'{field} "{value}" is not a valid date.'
    return datetime.combine(parsed, time.min, tzinfo=UTC), None


def validate_date_only(value: str, field: str) -> tuple[date | None, str | None]:
    """Parse a ``YYYY-MM-DD`` string to a ``date`` (application deadlines are date-typed).

    Companion to ``validate_date_field`` (which returns a midnight-UTC ``datetime``
    for task timestamps); returns ``(parsed, None)`` or ``(None, error)``.
    """
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, f'{field} "{value}" is not a valid date.'


def resolve_link(
    value: str | None, field: str, active_ids: set[UUID]
) -> tuple[UUID | None, str | None]:
    """Resolve a link param to an active id, or an A.7-shaped error fragment."""
    if value is None:
        return None, None
    kind = "application" if field == "application_id" else "essay"
    parsed = try_uuid(value)
    if parsed is None or parsed not in active_ids:
        return None, (
            f'{field} "{value}" does not match any active {kind} in this student\'s workspace.'
        )
    return parsed, None


def resolve_ref(ref: str, ids: list[UUID]) -> tuple[UUID | None, bool]:
    """Resolve a document/memory ref against active ids (Part D 8-char id prefixes).

    Accepts either a full UUID or the rendered 8-char prefix (or any shorter
    hex prefix, ``>=4`` chars, to tolerate a model truncating further).
    Returns ``(matched_id, ambiguous)`` — ``(None, False)`` means not found,
    ``(None, True)`` means more than one active id shares that prefix.
    """
    parsed = try_uuid(ref)
    if parsed is not None:
        return (parsed, False) if parsed in ids else (None, False)
    candidate = ref.strip().lower()
    if len(candidate) < 4 or any(char not in "0123456789abcdef" for char in candidate):
        return None, False
    matches = [item_id for item_id in ids if str(item_id).replace("-", "").startswith(candidate)]
    if len(matches) == 1:
        return matches[0], False
    if len(matches) > 1:
        return None, True
    return None, False


async def find_similar_active_task(ctx: ToolCtx, title: str) -> dict[str, Any] | None:
    """Trgm duplicate guard (Locked decision 8): best active-title match ≥0.6, if any.

    Tool-layer, read-only presentation logic (not a service-layer concern —
    no ownership/transaction/change-log semantics), so it lives here rather
    than in ``service_tasks.py``.
    """
    async with ctx.app_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, title, status, similarity(title, $2) AS sim
            FROM counselle.tasks
            WHERE user_id = $1 AND archived_at IS NULL AND similarity(title, $2) >= $3
            ORDER BY sim DESC
            LIMIT 1
            """,
            ctx.user_id,
            title,
            DUPLICATE_SIMILARITY_THRESHOLD,
        )
    if row is None:
        return None
    return {"id": row["id"], "title": row["title"], "status": row["status"]}
