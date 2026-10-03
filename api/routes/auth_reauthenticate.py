"""Session-bound mailbox verification for Google-only account security actions."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from api.auth import UserManager, current_active_user, get_user_manager
from api.auth_account_security import lock_account_session
from api.auth_lifecycle import reserve_account_email, send_account_email
from api.auth_sessions import get_request_session
from api.routes.auth_account import TokenBody
from api.users_db import UserDB

router = APIRouter(tags=["auth"])


@router.post("/reauthenticate/email", status_code=202)
async def request_email_reauthentication(
    request: Request,
    user: UserDB = Depends(current_active_user),
    manager: UserManager = Depends(get_user_manager),
) -> Response:
    if not user.is_verified:
        raise HTTPException(403, "EMAIL_NOT_VERIFIED")
    session = await get_request_session(request, user)
    if session is None:
        raise HTTPException(401, "SESSION_EXPIRED")
    if not reserve_account_email(manager, user.email):
        return Response(status_code=202)
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(seconds=request.app.state.settings.auth_recent_seconds)
    async with request.app.state.runtime.app_pool.acquire() as conn, conn.transaction():
        await lock_account_session(conn, user, session.token_hash)
        await conn.execute(
            """INSERT INTO counselle.auth_action_tokens
                 (token_hash,user_id,purpose,email,session_hash,expires_at)
               VALUES ($1,$2,'reauthenticate',$3,$4,$5) ON CONFLICT(user_id,purpose)
               DO UPDATE SET token_hash=EXCLUDED.token_hash,email=EXCLUDED.email,
                  session_hash=EXCLUDED.session_hash,expires_at=EXCLUDED.expires_at,created_at=now()""",
            hashlib.sha256(token.encode()).hexdigest(),
            user.id,
            user.email,
            session.token_hash,
            expires,
        )
    await send_account_email(
        manager,
        to=user.email,
        purpose="reauthenticate",
        reserved=True,
        subject="Confirm it's you — Acceptra",
        path="/reauthenticate",
        token=token,
    )
    return Response(status_code=202)


@router.post("/reauthenticate/email/confirm", status_code=204)
async def confirm_email_reauthentication(
    body: TokenBody, request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    session = await get_request_session(request, user)
    if session is None:
        raise HTTPException(401, "SESSION_EXPIRED")
    async with request.app.state.runtime.app_pool.acquire() as conn, conn.transaction():
        await lock_account_session(conn, user, session.token_hash)
        current_email = user.email
        consumed = await conn.fetchval(
            """DELETE FROM counselle.auth_action_tokens
               WHERE token_hash=$1 AND user_id=$2 AND purpose='reauthenticate'
                 AND email=$3 AND session_hash=$4 AND expires_at > now() RETURNING user_id""",
            hashlib.sha256(body.token.encode()).hexdigest(),
            user.id,
            current_email,
            session.token_hash,
        )
        if consumed is None:
            raise HTTPException(400, "INVALID_REAUTHENTICATION_TOKEN")
        updated = await conn.fetchval(
            """UPDATE counselle.auth_sessions SET authenticated_at=now()
               WHERE token_hash=$1 AND user_id=$2 AND expires_at > now() RETURNING user_id""",
            session.token_hash,
            user.id,
        )
        if updated is None:
            raise HTTPException(401, "SESSION_EXPIRED")
    return Response(status_code=204)
