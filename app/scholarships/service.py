"""Scholarship records: reads, admin writes, history (plan §5).

Every write runs in one transaction that locks the row (`FOR UPDATE`),
checks `expected_version`, applies the status transition, validates, bumps
the version and appends exactly one revision (D9, D11). `today` is the
server's UTC date unless a caller injects one.
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

import asyncpg

from app.scholarships import rows
from app.scholarships.errors import (
    ScholarshipConflictError,
    ScholarshipNotFoundError,
    ScholarshipValidationError,
)
from app.scholarships.models import (
    AdminScholarship,
    RevisionAction,
    RevisionOut,
    ScholarshipCreateIn,
    ScholarshipPublic,
    ScholarshipUpdateIn,
    StatusChangeIn,
)
from domain.scholarships.publish import publish_problems
from domain.scholarships.types import ScholarshipDraft, ScholarshipStatus

REVISIONS_LIMIT = 100

NOT_FOUND_MESSAGE = "That scholarship was not found."
NOT_READY_MESSAGE = "This scholarship isn't ready to publish."
RESTORE_FIRST_MESSAGE = "Restore this scholarship before editing it."
USE_STATUS_MESSAGE = "Use the status action for this."
FUTURE_CHECK_MESSAGE = "The last-checked date can't be in the future."

_COLUMN_LIST = ", ".join(rows.EDITABLE_COLUMNS)
_PLACEHOLDERS = ", ".join(f"${i}" for i in range(1, len(rows.EDITABLE_COLUMNS) + 1))
_N = len(rows.EDITABLE_COLUMNS)

_INSERT_SQL = f"""
INSERT INTO counselle.scholarships ({_COLUMN_LIST}, status, created_by, updated_by)
VALUES ({_PLACEHOLDERS}, ${_N + 1}, ${_N + 2}, ${_N + 2})
RETURNING id
"""  # noqa: S608 - column names are module constants; values are parameters

_UPDATE_SQL = f"""
UPDATE counselle.scholarships
SET ({_COLUMN_LIST}, status) = ({_PLACEHOLDERS}, ${_N + 1}),
    version = version + 1, updated_at = clock_timestamp(), updated_by = ${_N + 2}
WHERE id = ${_N + 3}
RETURNING version
"""  # noqa: S608 - column names are module constants; values are parameters

_SET_STATUS_SQL = """
UPDATE counselle.scholarships
SET status = $1, version = version + 1, updated_at = clock_timestamp(), updated_by = $2
WHERE id = $3
RETURNING version
"""

_MARK_CHECKED_SQL = """
UPDATE counselle.scholarships
SET last_checked_on = $1, version = version + 1, updated_at = clock_timestamp(),
    updated_by = $2
WHERE id = $3
RETURNING version
"""

_LOCK_SQL = "SELECT * FROM counselle.scholarships WHERE id = $1 FOR UPDATE"

_INSERT_REVISION_SQL = """
INSERT INTO counselle.scholarship_revisions
  (scholarship_id, version, action, snapshot, actor_id)
VALUES ($1, $2, $3, $4, $5)
"""

_LIST_PUBLISHED_SQL = (
    rows.SELECT_SQL + " WHERE s.status = 'published' ORDER BY s.deadline_on NULLS LAST, s.name"
)
_LIST_ALL_SQL = rows.SELECT_SQL + " ORDER BY s.updated_at DESC"
_GET_SQL = rows.SELECT_SQL + " WHERE s.id = $1"

_VINTAGE_SQL = """
SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '') || ':'
       || coalesce(sum(version), 0)::text
FROM counselle.scholarships WHERE status = 'published'
"""

_REVISIONS_SQL = """
SELECT r.version, r.action, r.snapshot, r.created_at, u.email AS actor_email
FROM counselle.scholarship_revisions r
LEFT JOIN counselle.users u ON u.id = r.actor_id
WHERE r.scholarship_id = $1
ORDER BY r.version DESC
LIMIT $2
"""


def _today(today: dt.date | None) -> dt.date:
    return today if today is not None else dt.datetime.now(dt.UTC).date()


def action_for(prev: ScholarshipStatus, new: ScholarshipStatus) -> RevisionAction:
    """The one function behind every revision action label."""
    if prev == new:
        return "update"
    if new == "archived":
        return "archive"
    if prev == "archived":
        return "restore"
    return "publish" if new == "published" else "unpublish"


def _validate(draft: ScholarshipDraft, status: ScholarshipStatus, today: dt.date) -> None:
    if draft.last_checked_on is not None and draft.last_checked_on > today + dt.timedelta(days=1):
        raise ScholarshipValidationError(FUTURE_CHECK_MESSAGE)
    if status == "published":
        problems = publish_problems(draft, today)
        if problems:
            raise ScholarshipValidationError(NOT_READY_MESSAGE, problems)


async def _write(conn: asyncpg.Connection, sql: str, *args: Any) -> Any:
    """Run an UPDATE/INSERT, mapping the publish CHECK (a domain-check bug if
    it ever fires) to a plain 422."""
    try:
        return await conn.fetchval(sql, *args)
    except asyncpg.CheckViolationError as exc:
        raise ScholarshipValidationError(NOT_READY_MESSAGE) from exc


async def _lock(
    conn: asyncpg.Connection, scholarship_id: UUID, expected_version: int | None
) -> asyncpg.Record:
    row = await conn.fetchrow(_LOCK_SQL, scholarship_id)
    if row is None:
        raise ScholarshipNotFoundError(NOT_FOUND_MESSAGE)
    if expected_version is not None and expected_version != row["version"]:
        raise ScholarshipConflictError(row["version"])
    return row


async def _log(
    conn: asyncpg.Connection,
    scholarship_id: UUID,
    version: int,
    action: RevisionAction,
    draft: ScholarshipDraft,
    status: ScholarshipStatus,
    actor: UUID,
) -> None:
    await conn.execute(
        _INSERT_REVISION_SQL,
        scholarship_id,
        version,
        action,
        rows.snapshot(draft, status),
        actor,
    )


async def _get(conn: asyncpg.Connection, scholarship_id: UUID) -> AdminScholarship:
    row = await conn.fetchrow(_GET_SQL, scholarship_id)
    if row is None:
        raise ScholarshipNotFoundError(NOT_FOUND_MESSAGE)
    return rows.admin_from_row(row)


async def list_published(pool: asyncpg.Pool) -> list[ScholarshipPublic]:
    records = await pool.fetch(_LIST_PUBLISHED_SQL)
    return [rows.public_from_row(row) for row in records]


async def published_vintage(pool: asyncpg.Pool) -> str:
    """Changes on any publish, unpublish, archive or edit of a published
    record. Never empty, so an empty list still gets an ETag."""
    value: str = await pool.fetchval(_VINTAGE_SQL)
    return value


async def list_all(pool: asyncpg.Pool) -> list[AdminScholarship]:
    records = await pool.fetch(_LIST_ALL_SQL)
    return [rows.admin_from_row(row) for row in records]


async def get(pool: asyncpg.Pool, scholarship_id: UUID) -> AdminScholarship:
    async with pool.acquire() as conn:
        return await _get(conn, scholarship_id)


async def create(
    pool: asyncpg.Pool, data: ScholarshipCreateIn, actor: UUID, *, today: dt.date | None = None
) -> AdminScholarship:
    if data.status == "archived":
        raise ScholarshipValidationError(USE_STATUS_MESSAGE)
    draft = ScholarshipDraft.model_validate(data.model_dump(exclude={"status"}))
    _validate(draft, data.status, _today(today))
    async with pool.acquire() as conn, conn.transaction():
        new_id: UUID = await _write(
            conn, _INSERT_SQL, *rows.columns_from_draft(draft), data.status, actor
        )
        await _log(conn, new_id, 1, "create", draft, data.status, actor)
        return await _get(conn, new_id)


async def update(
    pool: asyncpg.Pool,
    scholarship_id: UUID,
    data: ScholarshipUpdateIn,
    actor: UUID,
    *,
    today: dt.date | None = None,
) -> AdminScholarship:
    """A full replacement of the editable fields plus a status move a PUT
    may make (draft <-> published). A PUT never upserts."""
    draft = ScholarshipDraft.model_validate(data.model_dump(exclude={"status", "expected_version"}))
    async with pool.acquire() as conn, conn.transaction():
        row = await _lock(conn, scholarship_id, data.expected_version)
        if row["status"] == "archived":
            raise ScholarshipValidationError(RESTORE_FIRST_MESSAGE)
        if data.status == "archived":
            raise ScholarshipValidationError(USE_STATUS_MESSAGE)
        _validate(draft, data.status, _today(today))
        version: int = await _write(
            conn,
            _UPDATE_SQL,
            *rows.columns_from_draft(draft),
            data.status,
            actor,
            scholarship_id,
        )
        action = action_for(row["status"], data.status)
        await _log(conn, scholarship_id, version, action, draft, data.status, actor)
        return await _get(conn, scholarship_id)


async def change_status(
    pool: asyncpg.Pool,
    scholarship_id: UUID,
    data: StatusChangeIn,
    actor: UUID,
    *,
    today: dt.date | None = None,
) -> AdminScholarship:
    """Publish, unpublish, archive and restore. A same-status call is a
    no-op: no version bump, no revision."""
    async with pool.acquire() as conn, conn.transaction():
        row = await _lock(conn, scholarship_id, data.expected_version)
        if row["status"] == data.status:
            return await _get(conn, scholarship_id)
        draft = rows.draft_from_row(row)
        _validate(draft, data.status, _today(today))
        version: int = await _write(conn, _SET_STATUS_SQL, data.status, actor, scholarship_id)
        action = action_for(row["status"], data.status)
        await _log(conn, scholarship_id, version, action, draft, data.status, actor)
        return await _get(conn, scholarship_id)


async def mark_checked(
    pool: asyncpg.Pool, scholarship_id: UUID, actor: UUID, *, today: dt.date | None = None
) -> AdminScholarship:
    """Set `last_checked_on` to today and nothing else."""
    checked_on = _today(today)
    async with pool.acquire() as conn, conn.transaction():
        row = await _lock(conn, scholarship_id, None)
        if row["status"] == "archived":
            raise ScholarshipValidationError(RESTORE_FIRST_MESSAGE)
        version: int = await _write(conn, _MARK_CHECKED_SQL, checked_on, actor, scholarship_id)
        draft = rows.draft_from_row(row).model_copy(update={"last_checked_on": checked_on})
        await _log(conn, scholarship_id, version, "checked", draft, row["status"], actor)
        return await _get(conn, scholarship_id)


def _changed(current: dict[str, Any], previous: dict[str, Any] | None) -> list[str]:
    if previous is None:
        return []
    return sorted(key for key in {*current, *previous} if current.get(key) != previous.get(key))


async def revisions(pool: asyncpg.Pool, scholarship_id: UUID) -> list[RevisionOut]:
    """The newest `REVISIONS_LIMIT` revisions, newest first. One extra row is
    read so the oldest returned revision still diffs against its parent."""
    async with pool.acquire() as conn:
        await _get(conn, scholarship_id)
        records = await conn.fetch(_REVISIONS_SQL, scholarship_id, REVISIONS_LIMIT + 1)
    out: list[RevisionOut] = []
    for index, record in enumerate(records[:REVISIONS_LIMIT]):
        parent = records[index + 1]["snapshot"] if index + 1 < len(records) else None
        out.append(
            RevisionOut(
                version=record["version"],
                action=record["action"],
                actor_email=record["actor_email"],
                created_at=record["created_at"],
                changed=_changed(record["snapshot"], parent),
                snapshot=record["snapshot"],
            )
        )
    return out


__all__ = [
    "action_for",
    "change_status",
    "create",
    "get",
    "list_all",
    "list_published",
    "mark_checked",
    "published_vintage",
    "revisions",
    "update",
]
