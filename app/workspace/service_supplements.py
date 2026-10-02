"""Supplemental essays on the student's list, from the prompts catalog.

The catalog (``counselle.supplement_*``, filled by ``app.supplements``) says
what each school asks; this module connects it to the student's essays:

- adding a school creates an essay for each prompt every applicant must
  answer (required, not one of a choice, not for some applicants only);
- the student starts any other prompt (a pick from a choice, an optional or
  program-specific one) explicitly;
- the daily sync's changes reach existing essays through
  :func:`propagate_catalog_changes` — a reworded prompt is moved and flagged,
  a dropped one flagged, a new required one created. The essay's text is never
  touched, and the sync compares the catalog only with what it last applied
  (``supplement_prompt``/``supplement_word_limit``), never with the
  student-editable prompt or limit.

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
SELECT id, application_id, supplement_key, archived_at, prompt, word_limit,
       supplement_prompt, supplement_word_limit, prompt_removed_at
FROM counselle.essays
WHERE user_id = $1 AND application_id = ANY($2::uuid[]) AND supplement_key IS NOT NULL
"""

_INSERT_ESSAY_SQL = """
INSERT INTO counselle.essays
  (user_id, application_id, title, essay_type, status, prompt, content,
   word_count, word_limit, supplement_key, supplement_prompt, supplement_word_limit)
VALUES ($1, $2, $3, 'Supplement', 'Not started', $4, $5, 0, $6, $7, $4, $6)
ON CONFLICT (application_id, supplement_key)
  WHERE supplement_key IS NOT NULL AND archived_at IS NULL
  DO NOTHING
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
) -> tuple[asyncpg.Record, ChangeEvent] | None:
    """None when the application already has an active essay for the prompt
    (a concurrent add or a double click)."""
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
    if row is None:
        return None
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
            created = await _insert_supplement_essay(
                conn, user_id=user_id, actor=actor, application_id=application_id, prompt=prompt
            )
            if created is not None:
                events.append(created[1])
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
    except Exception:
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
        created = await _insert_supplement_essay(
            conn, user_id=user_id, actor=actor, application_id=application_id, prompt=prompt
        )
        if created is None:
            existing = await conn.fetchrow(
                "SELECT * FROM counselle.essays WHERE application_id = $1 "
                "AND supplement_key = $2 AND archived_at IS NULL",
                application_id,
                key,
            )
            return Essay.model_validate(dict(existing))
        row, event = created
    publish_events(event_bus, user_id, [event])
    return Essay.model_validate(dict(row))


async def acknowledge_prompt_change(
    app_pool: asyncpg.Pool, event_bus: WorkspaceEventBus, *, user_id: UUID, essay_id: UUID
) -> None:
    """The student has seen a prompt update or removal notice; clear it.

    ``updated_at`` is left alone so an open editor's guarded autosave does
    not conflict with the acknowledgement."""
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE counselle.essays
            SET prompt_updated_at = NULL, prompt_previous = NULL, prompt_removed_at = NULL
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


_PENDING_SCHOOLS_SQL = """
SELECT school_unitid FROM counselle.supplement_schools
WHERE cycle = $1 AND essays_synced_sha256 IS DISTINCT FROM prompts_sha256
ORDER BY school_unitid
"""


async def propagate_catalog_changes(
    app_pool: asyncpg.Pool, event_bus: WorkspaceEventBus | None = None
) -> int:
    """Carry every school whose prompts changed since its essays were last
    synced into its students' essays; returns essays touched.

    Driven by stored state (``essays_synced_sha256``), not by one sync pass's
    report, so a step that failed or was cut short is retried next pass. Each
    school commits on its own: one school's failure never holds back another.
    """
    async with app_pool.acquire() as conn:
        pending = [r["school_unitid"] for r in await conn.fetch(_PENDING_SCHOOLS_SQL, _cycle())]
    touched = 0
    for unitid in pending:
        try:
            touched += await _propagate_school(app_pool, unitid, event_bus)
        except asyncpg.PostgresError:
            logger.exception("supplement_essays_propagate_failed", school_unitid=unitid)
    return touched


async def _propagate_school(
    app_pool: asyncpg.Pool, unitid: int, event_bus: WorkspaceEventBus | None
) -> int:
    events: dict[UUID, list[ChangeEvent]] = defaultdict(list)
    async with app_pool.acquire() as conn, conn.transaction():
        prompts_sha256 = await conn.fetchval(
            "SELECT prompts_sha256 FROM counselle.supplement_schools "
            "WHERE cycle = $1 AND school_unitid = $2 FOR UPDATE",
            _cycle(),
            unitid,
        )
        prompts = (await _load_catalog(conn, [unitid])).get(unitid, (None, []))[1]
        applications = await conn.fetch(
            "SELECT id, user_id, school_unitid, cycle_year FROM counselle.applications "
            "WHERE archived_at IS NULL AND school_unitid = $1",
            unitid,
        )
        for application in applications:
            if not covers_cycle_year(application["cycle_year"]):
                continue
            changed = await _move_or_flag_essays(conn, application, prompts)
            changed += await ensure_required_essays(
                conn,
                user_id=application["user_id"],
                actor="counselle",
                application_id=application["id"],
                school_unitid=unitid,
                cycle_year=application["cycle_year"],
            )
            events[application["user_id"]].extend(changed)
        await conn.execute(
            "UPDATE counselle.supplement_schools SET essays_synced_sha256 = $3 "
            "WHERE cycle = $1 AND school_unitid = $2",
            _cycle(),
            unitid,
            prompts_sha256,
        )
    if event_bus is not None:
        for user_id, user_events in events.items():
            publish_events(event_bus, user_id, user_events)
    return sum(len(e) for e in events.values())


async def _move_or_flag_essays(
    conn: asyncpg.Connection, application: Any, prompts: list[SupplementPromptView]
) -> list[ChangeEvent]:
    """Bring the application's linked essays in line with the school's prompts.

    Active essays go first, so they get first claim on a reworded prompt;
    archived ones follow so their key moves too (a deleted supplement whose
    prompt was reworded must still count as answered), but they are never
    flagged as removed.
    """
    by_key = {p.key: p for p in prompts}
    essays = sorted(
        await conn.fetch(_LINKED_ESSAYS_SQL, application["user_id"], [application["id"]]),
        key=lambda e: e["archived_at"] is not None,
    )
    linked = {e["supplement_key"] for e in essays if e["supplement_key"] in by_key}
    events = []
    for essay in essays:
        current = by_key.get(essay["supplement_key"])
        if current is None:
            free = [p for p in prompts if p.key not in linked]
            previous = essay["supplement_prompt"] or essay["prompt"] or ""
            match = best_rewording(previous, [_essay_prompt_text(p) for p in free])
            if match is not None:
                current = free[match]
                linked.add(current.key)
        if current is not None:
            changed = await _apply_prompt(conn, essay, current)
        elif essay["archived_at"] is None and essay["prompt_removed_at"] is None:
            await conn.execute(
                "UPDATE counselle.essays SET prompt_removed_at = now() WHERE id = $1",
                essay["id"],
            )
            changed = True
        else:
            changed = False
        if changed:
            events.append(await _essay_event(conn, application, essay["id"]))
    return events


async def _apply_prompt(
    conn: asyncpg.Connection, essay: asyncpg.Record, prompt: SupplementPromptView
) -> bool:
    """Point the essay at *prompt*; True when anything changed.

    The wording and the limit move only when the catalog's own value moved
    (against the snapshot), so the student's edits to either survive a sync
    that changed something else at the school. ``updated_at`` is left alone:
    an open editor's guarded autosave must not conflict with a sync.
    """
    text = _essay_prompt_text(prompt)
    reworded = text != essay["supplement_prompt"]
    new_limit = prompt.word_limit != essay["supplement_word_limit"]
    rekeyed = prompt.key != essay["supplement_key"]
    returned = essay["prompt_removed_at"] is not None
    if not (reworded or new_limit or rekeyed or returned):
        return False
    await conn.execute(
        """
        UPDATE counselle.essays
        SET supplement_key = $2,
            prompt = CASE WHEN $3 THEN $4 ELSE prompt END,
            prompt_previous = CASE WHEN $3 THEN COALESCE(prompt_previous, supplement_prompt)
                                   ELSE prompt_previous END,
            prompt_updated_at = CASE WHEN $3 THEN now() ELSE prompt_updated_at END,
            supplement_prompt = $4,
            word_limit = CASE WHEN $5 THEN $6 ELSE word_limit END,
            supplement_word_limit = $6,
            prompt_removed_at = NULL
        WHERE id = $1
        """,
        essay["id"],
        prompt.key,
        reworded,
        text,
        new_limit,
        prompt.word_limit,
    )
    return True


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
