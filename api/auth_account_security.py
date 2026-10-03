"""Recheck account actions under the user lock used by credential revocation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    from api.users_db import UserDB


async def lock_account_session(
    conn: Any, user: UserDB, token_hash: str, recent_seconds: int | None = None
) -> None:
    """Hold user then session locks until the action commits.

    An auth dependency's snapshot can predate a concurrent password recovery.
    Always check the session again after acquiring the credential row lock.
    """
    account = await conn.fetchval(
        """SELECT id FROM counselle.users WHERE id=$1 AND email=$2
           AND hashed_password IS NOT DISTINCT FROM $3 AND is_active=true
           AND credential_revision=$4 FOR UPDATE""",
        user.id,
        user.email,
        user.hashed_password,
        user.credential_revision,
    )
    if account is None:
        raise HTTPException(401, "SESSION_EXPIRED")
    session = await conn.fetchval(
        """SELECT user_id FROM counselle.auth_sessions
           WHERE token_hash=$1 AND user_id=$2 AND expires_at > now()
             AND ($3::integer IS NULL OR
                  authenticated_at BETWEEN now() - $3 * interval '1 second' AND now())
           FOR UPDATE""",
        token_hash,
        user.id,
        recent_seconds,
    )
    if session is None:
        raise HTTPException(403, "REAUTHENTICATION_REQUIRED")
