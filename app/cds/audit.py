"""The CDS admin audit log — who did what, when, to which document (plan §C2).

Mirrors `app/workspace/changes.py::record_change`: one INSERT, called inside
the caller's existing transaction on the app pool (`counselle.*`), so an audit
row commits atomically with the mutation it describes. The actor is always the
authenticated superuser's id, resolved by the caller from `current_superuser`
(`api/auth.py`) — this module never accepts a client-supplied actor.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

import asyncpg

AuditAction = Literal[
    "upload", "commit", "extract", "edit", "approve", "approve_override", "reject", "rerun"
]

_INSERT_SQL = """
INSERT INTO counselle.cds_admin_audit
  (actor_user_id, action, school_id, academic_year, document_id, extraction_id, detail)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id
"""


async def record_audit(
    conn: asyncpg.Connection,
    *,
    actor_user_id: UUID,
    action: AuditAction,
    school_id: int | None = None,
    academic_year: int | None = None,
    document_id: int | None = None,
    extraction_id: UUID | str | None = None,
    detail: dict[str, Any] | None = None,
) -> int:
    """Insert one audit row inside the caller's transaction and return its id."""
    audit_id = await conn.fetchval(
        _INSERT_SQL,
        actor_user_id,
        action,
        school_id,
        academic_year,
        document_id,
        str(extraction_id) if extraction_id is not None else None,
        detail or {},
    )
    return int(audit_id)
