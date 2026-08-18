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
from app.chat_deletion import cancel_and_drop_threads

router = APIRouter(tags=["me"])
logger = structlog.get_logger(__name__)

_GOOGLE = "google"

# `settings.onboarding` is owned exclusively by `PATCH /v1/onboarding` (README
# §8/§19.4) — a generic `/v1/me` settings write must never read, set, or clear it.
_RESERVED_SETTINGS_KEYS = frozenset({"onboarding"})


class MePatchBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    settings: dict[str, Any] | None = None


def _merge_settings(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """RFC 7396-style top-level merge: omitted key = keep, explicit null = delete."""
    merged = dict(current)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


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
            "is_superuser": user.is_superuser,
        }
    )


@router.patch("/me", dependencies=[Depends(require_json)])
async def patch_me(
    body: MePatchBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> JSONResponse:
    """Update ``name`` and/or ``settings`` (the only writable profile columns).

    ``settings`` is an RFC 7396-style top-level patch, not a replacement: an
    omitted key is preserved, an explicit ``null`` value deletes that one key,
    and ``settings: null`` (clearing the whole object) is rejected — a later
    theme/source-config update must never erase unrelated settings, onboarding
    progress included. Writing the reserved ``onboarding`` key here is always
    rejected; it changes only through ``PATCH /v1/onboarding``. Name and
    settings persist together in one atomic UPDATE.

    The merge source for ``settings`` is a freshly ``SELECT ... FOR UPDATE``'d
    row, not the ``current_active_user`` snapshot taken at request start —
    that snapshot can be stale by the time this handler runs. Reading under
    the row lock, inside the same transaction as the write, closes the race
    against a concurrent ``PATCH /v1/onboarding`` (see
    ``app.onboarding.update_onboarding_progress``, which takes the same lock):
    whichever write commits second merges against the other's already-applied
    change instead of clobbering it with a stale value.
    """
    pool = request.app.state.runtime.app_pool
    fields = body.model_dump(exclude_unset=True)
    settings_patch: dict[str, Any] | None = None
    if "settings" in fields:
        settings_patch = fields["settings"]
        if settings_patch is None:
            raise EnvelopeError(422, "settings cannot be cleared entirely.")
        if _RESERVED_SETTINGS_KEYS & settings_patch.keys():
            raise EnvelopeError(422, "settings.onboarding is reserved; use PATCH /v1/onboarding.")

    cols = [c for c in ("name",) if c in fields]
    if settings_patch is not None:
        cols.append("settings")

    new_settings: dict[str, Any] | None = None
    current_settings = user.settings or {}
    if cols:
        # Column names come ONLY from the fixed allowlist above (never user input);
        # all values bind via $N. Safe by construction.
        async with pool.acquire() as conn, conn.transaction():
            if settings_patch is not None:
                row = await conn.fetchrow(
                    "SELECT settings FROM counselle.users WHERE id = $1 FOR UPDATE", user.id
                )
                if row is None:
                    raise EnvelopeError(404, "user not found")
                current_settings = row["settings"] or {}
                new_settings = _merge_settings(current_settings, settings_patch)
            assignments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(cols))
            args = [new_settings if col == "settings" else fields[col] for col in cols]
            await conn.execute(
                f"UPDATE counselle.users SET {assignments} WHERE id = $1",  # nosec B608
                user.id,
                *args,
            )
    name = fields.get("name", user.name)
    settings_value = new_settings if new_settings is not None else current_settings
    return JSONResponse(content={"id": str(user.id), "name": name, "settings": settings_value})


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
    failed = await cancel_and_drop_threads(
        request.app.state.turn_registry,
        request.app.state.runtime.checkpointer,
        session_ids,
    )
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
    failed = await cancel_and_drop_threads(
        request.app.state.turn_registry,
        request.app.state.runtime.checkpointer,
        session_ids,
    )
    if failed:
        logger.error("chat delete aborted — checkpoint threads survived", failed=failed)
        raise EnvelopeError(500, "Deleting your chats didn't fully complete — please try again.")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.sessions WHERE user_id = $1", user.id)
    return Response(status_code=204)
