"""Workspace checklist/essay seeding for newly added schools."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

import asyncpg

from app.workspace.models import Essay, Task, WorkspaceSeedingTemplate


@dataclass(frozen=True)
class SeededWorkspace:
    tasks: list[Task]
    essays: list[Essay]


def _due_at(deadline: date | None, days_before: int | None) -> datetime | None:
    if deadline is None or days_before is None:
        return None
    due_date = deadline - timedelta(days=days_before)
    return datetime.combine(due_date, time.min, tzinfo=UTC)


async def seed_application_workspace(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    application_id: UUID,
    deadline: date | None,
    template: WorkspaceSeedingTemplate,
) -> SeededWorkspace:
    """Insert the editable starter checklist and supplement slot."""
    tasks: list[Task] = []
    for task in template.tasks:
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.tasks
              (user_id, application_id, title, category, priority, due_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            user_id,
            application_id,
            task.title,
            task.category,
            task.priority,
            _due_at(deadline, task.days_before_deadline),
        )
        tasks.append(Task.model_validate(dict(row)))

    essays: list[Essay] = []
    for essay in template.essays:
        row = await conn.fetchrow(
            """
            INSERT INTO counselle.essays
              (user_id, application_id, title, essay_type, status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            """,
            user_id,
            application_id,
            essay.title,
            essay.essay_type,
            essay.status,
        )
        essays.append(Essay.model_validate(dict(row)))

    return SeededWorkspace(tasks=tasks, essays=essays)
