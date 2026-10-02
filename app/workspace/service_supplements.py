"""Supplemental essays on the student's list, from the prompts catalog.

The catalog (``counselle.supplement_*``, filled by ``app.supplements``) says
what each school asks; this module connects it to the student's essays:

- adding a school creates an essay for each prompt every applicant must
  answer (required, not one of a choice, not for some applicants only);
- the student starts any other prompt (a pick from a choice, an optional or
  program-specific one) explicitly;
- the daily sync's changes reach existing essays through
  :func:`apply_catalog_changes` — a reworded prompt is moved and flagged, a
  dropped one flagged, a new required one created. The essay's text is never
  touched.

An essay the student deleted (archived) still counts as answered, so it is
never re-created for them.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

import asyncpg
import structlog

from app.workspace.changes import WorkspaceEventBus, make_change_event, record_change
from app.workspace.models import (
    EMPTY_TIPTAP_DOC,
    Actor,
    ApplicationSupplements,
    ChangeEvent,
    ChangeOp,
    Essay,
    SupplementPromptView,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_utils import publish_events
from config.settings import get_settings
from domain.supplements import best_rewording, essay_title, prompt_key

logger = structlog.get_logger(__name__)

_CATALOG_SQL = """
SELECT s.school_unitid, s.status, s.checked, s.checked_on, s.changed_at,
       p.ordinal, p.prompt, p.context, p.word_limit, p.requirement,
       p.group_label, p.choose_count, p.applies_to
FROM counselle.supplement_schools s
LEFT JOIN counselle.supplement_prompts p USING (school_unitid, cycle)
WHERE s.cycle = $1 AND s.school_unitid = ANY($2::int[])
ORDER BY s.school_unitid, p.ordinal
"""

_ACTIVE_APPLICATIONS_SQL = """
SELECT id, school_unitid, cycle_year FROM counselle.applications
WHERE user_id = $1 AND archived_at IS NULL
ORDER BY created_at
"""

_LINKED_ESSAYS_SQL = """
SELECT id, application_id, supplement_key, archived_at, prompt, word_limit
FROM counselle.essays
WHERE user_id = $1 AND application_id = ANY($2::uuid[]) AND supplement_key IS NOT NULL
"""

_INSERT_ESSAY_SQL = """
INSERT INTO counselle.essays
  (user_id, application_id, title, essay_type, status, prompt, content,
   word_count, word_limit, supplement_key)
VALUES ($1, $2, $3, 'Supplement', 'Not started', $4, $5, 0, $6, $7)
RETURNING *
"""


def _cycle() -> str:
    return str(get_settings().supplements_cycle)


def covers_cycle_year(cycle_year: int | None) -> bool:
    """Whether an application's cycle is the one the catalog holds.

    The catalog's "2026-2027" is the cycle_year 2027 applications; an
    application with no cycle year is the current one.
    """
    return cycle_year is None or str(cycle_year) == _cycle()[-4:]


def _essay_prompt_text(prompt: SupplementPromptView) -> str:
    """What the essay stores as its prompt: any quoted context, then the question."""
    return f"{prompt.context}\n\n{prompt.prompt}" if prompt.context else prompt.prompt


def _is_auto_created(prompt: SupplementPromptView) -> bool:
    return (
        prompt.requirement == "required"
        and prompt.group_label is None
        and prompt.applies_to is None
    )


async def _load_catalog(
    conn: asyncpg.Connection, unitids: list[int]
) -> dict[int, tuple[asyncpg.Record, list[SupplementPromptView]]]:
    rows = await conn.fetch(_CATALOG_SQL, _cycle(), unitids)
    catalog: dict[int, tuple[asyncpg.Record, list[SupplementPromptView]]] = {}
    for row in rows:
        school, prompts = catalog.setdefault(row["school_unitid"], (row, []))
        if row["ordinal"] is not None:
            prompts.append(
                SupplementPromptView(
                    key=prompt_key(row["prompt"]),
                    prompt=row["prompt"],
                    context=row["context"],
                    word_limit=row["word_limit"],
                    requirement=row["requirement"],
                    group_label=row["group_label"],
                    choose_count=row["choose_count"],
                    applies_to=row["applies_to"],
                )
            )
    return catalog


async def list_supplements(
    app_pool: asyncpg.Pool, *, user_id: UUID
) -> list[ApplicationSupplements]:
    """Every active application's supplements for the catalog's cycle."""
    async with app_pool.acquire() as conn:
        applications = [
            a
            for a in await conn.fetch(_ACTIVE_APPLICATIONS_SQL, user_id)
            if covers_cycle_year(a["cycle_year"])
        ]
        catalog = await _load_catalog(conn, [a["school_unitid"] for a in applications])
        essays = await conn.fetch(_LINKED_ESSAYS_SQL, user_id, [a["id"] for a in applications])
    active: dict[tuple[UUID, str], UUID] = {
        (e["application_id"], e["supplement_key"]): e["id"]
        for e in essays
        if e["archived_at"] is None
    }
    views = []
    for application in applications:
        school = catalog.get(application["school_unitid"])
        if school is None:
            views.append(
                ApplicationSupplements(
                    application_id=application["id"],
                    school_unitid=application["school_unitid"],
                    cycle=_cycle(),
                    status="unlisted",
                )
            )
            continue
        row, prompts = school
        views.append(
            ApplicationSupplements(
                application_id=application["id"],
                school_unitid=application["school_unitid"],
                cycle=_cycle(),
                status=row["status"],
                checked=row["checked"],
                checked_on=row["checked_on"],
                changed_at=row["changed_at"],
                prompts=[
                    p.model_copy(update={"essay_id": active.get((application["id"], p.key))})
                    for p in prompts
                ],
            )
        )
    return views


async def _insert_supplement_essay(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
    prompt: SupplementPromptView,
) -> tuple[asyncpg.Record, ChangeEvent]:
    row = await conn.fetchrow(
        _INSERT_ESSAY_SQL,
        user_id,
        application_id,
        essay_title(prompt.prompt),
        _essay_prompt_text(prompt),
        EMPTY_TIPTAP_DOC,
        prompt.word_limit,
        prompt.key,
    )
    return row, await _record(conn, user_id, actor, row["id"], application_id, "created")


async def _record(
    conn: asyncpg.Connection,
    user_id: UUID,
    actor: Actor,
    essay_id: UUID,
    application_id: UUID,
    op: ChangeOp,
) -> ChangeEvent:
    change_id = await record_change(
        conn,
        user_id=user_id,
        actor=actor,
        object_type="essay",
        object_id=essay_id,
        op=op,
        application_id=application_id,
    )
    return make_change_event(
        change_id=change_id,
        actor=actor,
        object_type="essay",
        object_id=essay_id,
        op=op,
        application_id=application_id,
    )


async def ensure_required_essays(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
    school_unitid: int,
    cycle_year: int | None,
) -> list[ChangeEvent]:
    """Create the application's missing auto-created supplements (idempotent)."""
    if not covers_cycle_year(cycle_year):
        return []
    school = (await _load_catalog(conn, [school_unitid])).get(school_unitid)
    if school is None:
        return []
    answered = {
        e["supplement_key"] for e in await conn.fetch(_LINKED_ESSAYS_SQL, user_id, [application_id])
    }
    events = []
    for prompt in school[1]:
        if _is_auto_created(prompt) and prompt.key not in answered:
            _, event = await _insert_supplement_essay(
                conn, user_id=user_id, actor=actor, application_id=application_id, prompt=prompt
            )
            events.append(event)
            answered.add(prompt.key)
    return events


async def create_required_essays_for_new_application(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
    school_unitid: int,
    cycle_year: int | None,
) -> int:
    """Called after a school is added. Never fails the add: a missing essay
    can still be started by hand, a lost school cannot."""
    try:
        async with app_pool.acquire() as conn, conn.transaction():
            events = await ensure_required_essays(
                conn,
                user_id=user_id,
                actor=actor,
                application_id=application_id,
                school_unitid=school_unitid,
                cycle_year=cycle_year,
            )
    except asyncpg.PostgresError:
        logger.exception("supplement_essays_create_failed", application_id=str(application_id))
        return 0
    publish_events(event_bus, user_id, events)
    return len(events)


async def start_supplement_essay(
    app_pool: asyncpg.Pool,
    event_bus: WorkspaceEventBus,
    *,
    user_id: UUID,
    actor: Actor,
    application_id: UUID,
    key: str,
) -> Essay:
    """Create (or return the existing) essay for one of the school's prompts."""
    async with app_pool.acquire() as conn, conn.transaction():
        application = await conn.fetchrow(
            "SELECT id, school_unitid, cycle_year FROM counselle.applications "
            "WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
            application_id,
            user_id,
        )
        if application is None:
            raise WorkspaceNotFoundError()
        school = (await _load_catalog(conn, [application["school_unitid"]])).get(
            application["school_unitid"]
        )
        prompt = next((p for p in (school[1] if school else []) if p.key == key), None)
        if prompt is None or not covers_cycle_year(application["cycle_year"]):
            raise WorkspaceValidationError("that prompt is not on this school's current list")
        existing = await conn.fetchrow(
            "SELECT * FROM counselle.essays WHERE application_id = $1 AND supplement_key = $2 "
            "AND archived_at IS NULL",
            application_id,
            key,
        )
        if existing is not None:
            return Essay.model_validate(dict(existing))
        row, event = await _insert_supplement_essay(
            conn, user_id=user_id, actor=actor, application_id=application_id, prompt=prompt
        )
    publish_events(event_bus, user_id, [event])
    return Essay.model_validate(dict(row))


async def acknowledge_prompt_change(
    app_pool: asyncpg.Pool, event_bus: WorkspaceEventBus, *, user_id: UUID, essay_id: UUID
) -> None:
    """The student has seen a prompt update or removal notice; clear it."""
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.essays
            SET prompt_updated_at = NULL, prompt_previous = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
            RETURNING id, application_id
            """,
            essay_id,
            user_id,
        )
        if row is None:
            raise WorkspaceNotFoundError()
        event = await _record(conn, user_id, "student", row["id"], row["application_id"], "updated")
    publish_events(event_bus, user_id, [event])


async def apply_catalog_changes(
    app_pool: asyncpg.Pool, school_unitids: list[int], event_bus: WorkspaceEventBus | None = None
) -> int:
    """Carry changed schools' prompts into every student's essays; returns essays touched."""
    if not school_unitids:
        return 0
    touched = 0
    async with app_pool.acquire() as conn, conn.transaction():
        catalog = await _load_catalog(conn, school_unitids)
        applications = await conn.fetch(
            "SELECT id, user_id, school_unitid, cycle_year FROM counselle.applications "
            "WHERE archived_at IS NULL AND school_unitid = ANY($1::int[])",
            school_unitids,
        )
        events: dict[UUID, list[ChangeEvent]] = defaultdict(list)
        for application in applications:
            if not covers_cycle_year(application["cycle_year"]):
                continue
            prompts = catalog.get(application["school_unitid"], (None, []))[1]
            changed = await _move_or_flag_essays(conn, application, prompts)
            changed += await ensure_required_essays(
                conn,
                user_id=application["user_id"],
                actor="counselle",
                application_id=application["id"],
                school_unitid=application["school_unitid"],
                cycle_year=application["cycle_year"],
            )
            events[application["user_id"]].extend(changed)
            touched += len(changed)
    if event_bus is not None:
        for user_id, user_events in events.items():
            publish_events(event_bus, user_id, user_events)
    return touched


async def _move_or_flag_essays(
    conn: asyncpg.Connection, application: Any, prompts: list[SupplementPromptView]
) -> list[ChangeEvent]:
    by_key = {p.key: p for p in prompts}
    essays = await conn.fetch(
        _LINKED_ESSAYS_SQL + " AND archived_at IS NULL", application["user_id"], [application["id"]]
    )
    linked = {e["supplement_key"] for e in essays}
    events = []
    for essay in essays:
        current = by_key.get(essay["supplement_key"])
        if current is not None:
            if current.word_limit != essay["word_limit"]:
                await _update_prompt(conn, essay, current)
                events.append(await _essay_event(conn, application, essay["id"]))
            continue
        free = [p for p in prompts if p.key not in linked]
        match = best_rewording(essay["prompt"] or "", [_essay_prompt_text(p) for p in free])
        if match is not None:
            await _update_prompt(conn, essay, free[match])
            linked.add(free[match].key)
        else:
            await conn.execute(
                "UPDATE counselle.essays SET prompt_removed_at = now(), updated_at = now() "
                "WHERE id = $1 AND prompt_removed_at IS NULL",
                essay["id"],
            )
        events.append(await _essay_event(conn, application, essay["id"]))
    return events


async def _update_prompt(
    conn: asyncpg.Connection, essay: asyncpg.Record, prompt: SupplementPromptView
) -> None:
    await conn.execute(
        """
        UPDATE counselle.essays
        SET prompt = $2, word_limit = $3, supplement_key = $4,
            prompt_previous = COALESCE(prompt_previous, prompt),
            prompt_updated_at = now(), prompt_removed_at = NULL, updated_at = now()
        WHERE id = $1
        """,
        essay["id"],
        _essay_prompt_text(prompt),
        prompt.word_limit,
        prompt.key,
    )


async def _essay_event(conn: asyncpg.Connection, application: Any, essay_id: UUID) -> ChangeEvent:
    return await _record(
        conn, application["user_id"], "counselle", essay_id, application["id"], "updated"
    )


async def backfill_required_essays(app_pool: asyncpg.Pool) -> int:
    """Create the auto-created supplements for every school already on a list."""
    created = 0
    async with app_pool.acquire() as conn, conn.transaction():
        for application in await conn.fetch(
            "SELECT id, user_id, school_unitid, cycle_year FROM counselle.applications "
            "WHERE archived_at IS NULL"
        ):
            created += len(
                await ensure_required_essays(
                    conn,
                    user_id=application["user_id"],
                    actor="counselle",
                    application_id=application["id"],
                    school_unitid=application["school_unitid"],
                    cycle_year=application["cycle_year"],
                )
            )
    return created
