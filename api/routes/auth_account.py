"""Recent authentication, account credentials, and verified email changes."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from fastapi_users.exceptions import InvalidPasswordException
from pydantic import BaseModel, EmailStr, Field

from api.auth import UserManager, auth_backend, current_active_user, get_user_manager
from api.auth_account_security import lock_account_session
from api.auth_lifecycle import reserve_account_email, send_account_email
from api.auth_sessions import mark_session_recent, require_recent_auth, revoke_user_sessions
from api.users_db import UserDB

router = APIRouter(tags=["auth"])


class PasswordBody(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class EmailBody(BaseModel):
    email: EmailStr


class TokenBody(BaseModel):
    token: str = Field(min_length=1, max_length=4096)


@router.post("/reauthenticate", status_code=204)
async def reauthenticate(
    body: PasswordBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
    manager: UserManager = Depends(get_user_manager),
) -> Response:
    if user.hashed_password is None:
        raise HTTPException(400, "GOOGLE_REAUTHENTICATION_REQUIRED")
    valid, _ = manager.password_helper.verify_and_update(body.password, user.hashed_password)
    if not valid:
        raise HTTPException(400, "INVALID_PASSWORD")
    await mark_session_recent(request, user)
    return Response(status_code=204)


@router.post("/password", status_code=204)
async def change_password(
    body: PasswordBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
    manager: UserManager = Depends(get_user_manager),
) -> Response:
    session = await require_recent_auth(request, user)
    if not user.is_verified:
        raise HTTPException(403, "EMAIL_NOT_VERIFIED")
    try:
        await manager.validate_password(body.password, user)
    except InvalidPasswordException as exc:
        raise HTTPException(400, {"code": "INVALID_PASSWORD", "reason": exc.reason}) from exc
    updated = await manager.user_db.replace_password(
        user,
        manager.password_helper.hash(body.password),
        session_hash=session.token_hash,
        recent_seconds=request.app.state.settings.auth_recent_seconds,
    )
    if updated is None:
        raise HTTPException(409, "ACCOUNT_CHANGED")
    await manager.on_after_reset_password(updated, request)
    return await auth_backend.transport.get_logout_response()


@router.post("/logout-all", status_code=204)
async def logout_all(request: Request, user: UserDB = Depends(current_active_user)) -> Response:
    await revoke_user_sessions(request.app.state.runtime.app_pool, user.id)
    return await auth_backend.transport.get_logout_response()


@router.post("/email/change", status_code=202)
async def request_email_change(
    body: EmailBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
    manager: UserManager = Depends(get_user_manager),
) -> Response:
    session = await require_recent_auth(request, user)
    email = str(body.email)
    if email.casefold() == user.email.casefold():
        raise HTTPException(400, "EMAIL_UNCHANGED")
    if not reserve_account_email(manager, email):
        return Response(status_code=202)
    # One opaque single-use challenge, storing only its digest. The exact target
    # address lives in the locked row, so confirmation cannot substitute it.
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(
        seconds=request.app.state.settings.auth_action_lifetime_seconds
    )
    async with request.app.state.runtime.app_pool.acquire() as conn, conn.transaction():
        await lock_account_session(
            conn, user, session.token_hash, request.app.state.settings.auth_recent_seconds
        )
        occupied = await conn.fetchval(
            "SELECT id FROM counselle.users WHERE lower(email) = lower($1)", email
        )
        if occupied:
            raise HTTPException(400, "EMAIL_UNAVAILABLE")
        await conn.execute(
            """INSERT INTO counselle.auth_action_tokens(token_hash,user_id,purpose,email,expires_at)
               VALUES ($1,$2,'email_change',$3,$4) ON CONFLICT(user_id,purpose)
               DO UPDATE SET token_hash=EXCLUDED.token_hash,email=EXCLUDED.email,
                             expires_at=EXCLUDED.expires_at,created_at=now()""",
            hashlib.sha256(token.encode()).hexdigest(),
            user.id,
            email,
            expires,
        )
    await send_account_email(
        manager,
        to=email,
        purpose="email_change",
        reserved=True,
        subject="Confirm your Acceptra email address",
        path="/confirm-email",
        token=token,
    )
    return Response(status_code=202)


async def _confirm_email(pool: asyncpg.Pool, token: str) -> tuple[str, str]:
    async with pool.acquire() as conn, conn.transaction():
        # Lock user before challenge, matching password/reset and request paths.
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        user_id = await conn.fetchval(
            "SELECT user_id FROM counselle.auth_action_tokens WHERE token_hash=$1", token_hash
        )
        user = await conn.fetchrow(
            "SELECT email FROM counselle.users WHERE id=$1 AND is_active=true FOR UPDATE", user_id
        )
        row = await conn.fetchrow(
            """DELETE FROM counselle.auth_action_tokens
               WHERE token_hash=$1 AND purpose='email_change' AND expires_at > now()
               RETURNING user_id,email""",
            token_hash,
        )
        if not row or not user:
            raise HTTPException(400, "INVALID_EMAIL_CHANGE_TOKEN")
        await conn.execute(
            "UPDATE counselle.users SET email=$2,is_verified=true, "
            "credential_revision=credential_revision+1 WHERE id=$1",
            row["user_id"],
            row["email"],
        )
        await revoke_user_sessions(conn, row["user_id"])
        return user["email"], row["email"]


@router.post("/email/confirm", status_code=204)
async def confirm_email(
    body: TokenBody, request: Request, manager: UserManager = Depends(get_user_manager)
) -> Response:
    try:
        old, new = await _confirm_email(request.app.state.runtime.app_pool, body.token)
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(400, "EMAIL_UNAVAILABLE") from exc
    for email in (old, new):
        await send_account_email(
            manager,
            to=email,
            purpose="email_changed",
            subject="Your Acceptra email address changed",
        )
    return await auth_backend.transport.get_logout_response()
