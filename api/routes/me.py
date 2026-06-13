"""The custom ``/v1/me`` surface (B3, §28): profile read/write + account/chat delete.

Distinct from the fastapi-users users router at ``/v1/auth`` (credential changes —
email/password). ``/v1/me`` owns the honest profile shape (``has_password``,
``google_connected``), the ``settings`` jsonb, and the two cascade deletes.

The deletes follow the strict order: registry-cancel any in-flight turn FIRST (a
live task must not checkpoint after ``adelete_thread``), then drop the checkpoint
threads (no FK), then the rows (FK cascade for the account delete). If any
checkpoint-thread delete fails we **abort and signal** (500, rows left intact) so
we never report a full deletion while a student's conversation checkpoints survive
— the operation stays retryable.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from api.auth import current_active_user
from api.deps import EnvelopeError, require_json
from api.users_db import UserDB

router = APIRouter(tags=["me"])
logger = structlog.get_logger(__name__)

_GOOGLE = "google"


class MePatchBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    settings: dict[str, Any] | None = None


def _has_password(user: UserDB) -> bool:
    return user.hashed_password is not None


def _google_connected(user: UserDB) -> bool:
    return any(acc.oauth_name == _GOOGLE for acc in user.oauth_accounts)


async def _user_session_ids(pool: Any, user_id: str) -> list[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT session_id FROM counselle.sessions WHERE user_id = $1", user_id
        )
    return [str(row["session_id"]) for row in rows]


@router.get("/me")
async def get_me(user: UserDB = Depends(current_active_user)) -> JSONResponse:
    """The authed user's profile, settings, and credential posture."""
    return JSONResponse(
        content={
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "has_password": _has_password(user),
            "google_connected": _google_connected(user),
            "settings": user.settings,
        }
    )


@router.patch("/me", dependencies=[Depends(require_json)])
async def patch_me(
    body: MePatchBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> JSONResponse:
    """Update ``name`` and/or ``settings`` (the only writable profile columns)."""
    pool = request.app.state.runtime.app_pool
    fields = body.model_dump(exclude_unset=True)
    cols = [c for c in ("name", "settings") if c in fields]
    if cols:
        # Column names come ONLY from the fixed allowlist above (never user input);
        # all values bind via $N. Safe by construction.
        assignments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(cols))
        args = [fields["settings"] or {} if col == "settings" else fields[col] for col in cols]
        async with pool.acquire() as conn:
            await conn.execute(
                f"UPDATE counselle.users SET {assignments} WHERE id = $1",  # nosec B608
                user.id,
                *args,
            )
    name = fields.get("name", user.name)
    settings_value = fields.get("settings", user.settings) or {}
    return JSONResponse(content={"id": str(user.id), "name": name, "settings": settings_value})


async def _cancel_and_drop_threads(request: Request, session_ids: list[str]) -> list[str]:
    """Registry-cancel any live turn, then drop each session's checkpoint thread.

    Returns the session ids whose ``adelete_thread`` FAILED. Cancel failures are
    logged-and-tolerated (``registry.cancel`` awaits the task + persists its
    partial, so a cancel slip is not a data-survival risk); a failed thread-delete
    means checkpoints survive and the caller must abort the row deletion.
    """
    registry = request.app.state.turn_registry
    # adelete_thread lives on the checkpointer (AsyncPostgresSaver), not the
    # compiled graph — the graph has no such method.
    checkpointer = request.app.state.runtime.checkpointer
    failed: list[str] = []
    for sid in session_ids:
        try:
            await registry.cancel(sid)
        except Exception:
            logger.exception("registry cancel failed during delete (session_id=%s)", sid)
        try:
            await checkpointer.adelete_thread(sid)
        except Exception:
            logger.exception("adelete_thread failed during delete (session_id=%s)", sid)
            failed.append(sid)
    return failed


@router.delete("/me", status_code=204)
async def delete_me(
    request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    """Delete the account: cancel turns, drop threads, then the user row (FK cascade).

    If any checkpoint thread fails to drop we abort (500) and leave the rows — a
    half-deletion must never report success; a retry re-enumerates and re-attempts.
    """
    pool = request.app.state.runtime.app_pool
    session_ids = await _user_session_ids(pool, str(user.id))
    failed = await _cancel_and_drop_threads(request, session_ids)
    if failed:
        logger.error("account delete aborted — checkpoint threads survived", failed=failed)
        raise EnvelopeError(500, "Account deletion didn't fully complete — please try again.")
    async with pool.acquire() as conn:
        # FK cascade removes the user's sessions + oauth_accounts.
        await conn.execute("DELETE FROM counselle.users WHERE id = $1", user.id)
    return Response(status_code=204)


@router.delete("/me/chats", status_code=204)
async def delete_my_chats(
    request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    """Delete all of the user's chats (cancel turns, drop threads, delete rows).

    Aborts (500, rows intact) if any checkpoint thread fails to drop — same
    abort-and-signal posture as the account delete; the operation stays retryable.
    """
    pool = request.app.state.runtime.app_pool
    session_ids = await _user_session_ids(pool, str(user.id))
    failed = await _cancel_and_drop_threads(request, session_ids)
    if failed:
        logger.error("chat delete aborted — checkpoint threads survived", failed=failed)
        raise EnvelopeError(500, "Deleting your chats didn't fully complete — please try again.")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.sessions WHERE user_id = $1", user.id)
    return Response(status_code=204)
