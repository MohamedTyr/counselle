"""Google sign-in, explicit linking, and session-bound recent-authentication flow."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import unquote, urlencode, urlsplit

import jwt
import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi_users.exceptions import UserNotExists
from fastapi_users.jwt import decode_jwt
from fastapi_users.router.oauth import STATE_TOKEN_AUDIENCE, generate_state_token
from httpx_oauth.clients.google import GoogleOAuth2, GoogleOAuth2AuthorizeParams
from starlette.responses import RedirectResponse

from api.auth_expected_user import require_expected_user
from api.auth_google_accounts import associate_google_user, create_google_user, find_google_user
from api.auth_google_identity import GoogleFlowError, GoogleIdentity, verify_google_identity
from api.users_db import UserDB
from config.settings import Settings

logger = structlog.get_logger(__name__)
Mode = Literal["login", "associate", "reauth"]
_STATE_SECONDS = 600
_COOKIE_PATH = "/v1/auth/google"


class _GoogleOIDCAuthorizeParams(GoogleOAuth2AuthorizeParams, total=False):
    """Google OIDC fields absent from httpx-oauth's narrower parameter typing."""

    nonce: str
    claims: str


def safe_next(value: str | None, default: str = "/app") -> str:
    """Allow only a local absolute path, including after percent decoding."""
    if not value or len(value) > 2000:
        return default
    decoded = value
    for _ in range(3):
        decoded = unquote(decoded)
    try:
        parts = urlsplit(decoded)
    except ValueError:
        return default
    if (
        not decoded.startswith("/")
        or decoded.startswith("//")
        or "\\" in decoded
        or any(ord(char) < 32 or ord(char) == 127 for char in decoded)
        or parts.scheme
        or parts.netloc
    ):
        return default
    return value


def _cookie_name(settings: Settings, mode: Mode) -> str:
    return f"{settings.cookie_name}_google_{mode}"


def _finish(settings: Settings, mode: Mode, next_path: str, error: str | None = None) -> Response:
    query = {"next": safe_next(next_path)}
    if error:
        query["error"] = error
    origin = settings.auth_public_url.rstrip("/")
    response = RedirectResponse(f"{origin}/auth/callback?{urlencode(query)}", status_code=302)
    response.delete_cookie(
        _cookie_name(settings, mode),
        path=_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _read_state(
    request: Request, settings: Settings, mode: Mode, state: str | None
) -> dict[str, Any]:
    try:
        data = decode_jwt(
            state or "", settings.effective_oauth_state_secret, [STATE_TOKEN_AUDIENCE]
        )
    except jwt.PyJWTError as exc:
        raise GoogleFlowError("oauth_invalid_state") from exc
    csrf = data.get("csrf")
    cookie = request.cookies.get(_cookie_name(settings, mode))
    if (
        not isinstance(csrf, str)
        or not cookie
        or not secrets.compare_digest(csrf, cookie)
        or data.get("purpose") != f"google:{mode}"
        or not isinstance(data.get("nonce"), str)
        or not isinstance(data.get("next"), str)
    ):
        raise GoogleFlowError("oauth_invalid_state")
    return data


async def _current_user(request: Request, manager: Any) -> tuple[Any, UserDB]:
    from api.auth_sessions import get_request_session

    session = await get_request_session(request)
    if session is None:
        raise HTTPException(401, "Authentication required")
    try:
        user = await manager.get(session.user_id)
    except UserNotExists as exc:
        raise HTTPException(401, "Authentication required") from exc
    if not user.is_active:
        raise HTTPException(401, "Authentication required")
    return session, user


async def _bound_user(request: Request, manager: Any, data: dict[str, Any]) -> UserDB:
    try:
        session, user = await _current_user(request, manager)
    except HTTPException as exc:
        raise GoogleFlowError("oauth_invalid_state") from exc
    if data.get("user") != str(user.id) or data.get("session") != session.token_hash:
        raise GoogleFlowError("oauth_invalid_state")
    return user


async def _login_user(
    request: Request, settings: Settings, manager: Any, identity: GoogleIdentity
) -> UserDB:
    user = await find_google_user(manager.user_db, identity)
    if user is None:
        if await manager.user_db.get_by_email(identity.email) is not None:
            raise GoogleFlowError("account_exists")
        user = await create_google_user(
            request.app.state.runtime.app_pool,
            identity,
            signup_enabled=settings.auth_self_signup_enabled,
        )
        await manager.on_after_register(user, request)
    if not user.is_active:
        raise GoogleFlowError()
    return user


async def _complete(
    request: Request,
    settings: Settings,
    mode: Mode,
    manager: Any,
    identity: GoogleIdentity,
    data: dict[str, Any],
) -> Response:
    from api.auth import _build_backend
    from api.auth_sessions import (
        get_oauth_session_strategy,
        mark_session_recent,
        require_recent_auth,
    )

    response = _finish(settings, mode, data["next"])
    if mode == "login":
        user = await _login_user(request, settings, manager, identity)
        authenticated_at = (
            datetime.fromtimestamp(identity.authenticated_at, UTC)
            if identity.authenticated_at is not None
            else None
        )
        strategy = get_oauth_session_strategy(request, authenticated_at)
        backend = _build_backend(settings)
        login_response = await backend.login(strategy, user)
        for key, value in login_response.raw_headers:
            if key.lower() == b"set-cookie":
                response.raw_headers.append((key, value))
        await manager.on_after_login(user, request, response)
        return response
    user = await _bound_user(request, manager, data)
    if mode == "associate":
        if not user.is_verified:
            raise GoogleFlowError("email_not_verified")
        try:
            session = await require_recent_auth(request, user)
        except HTTPException as exc:
            raise GoogleFlowError("recent_auth_required") from exc
        await associate_google_user(
            request.app.state.runtime.app_pool,
            user,
            identity,
            session_hash=session.token_hash,
            recent_seconds=settings.auth_recent_seconds,
        )
    else:
        linked_user = await find_google_user(manager.user_db, identity)
        if linked_user is None or linked_user.id != user.id:
            raise GoogleFlowError("oauth_identity_mismatch")
        auth_timestamp = identity.authenticated_at
        if auth_timestamp is None or not identity.recently_authenticated(
            settings.auth_recent_seconds
        ):
            raise GoogleFlowError("oauth_reauth_required")
        await mark_session_recent(
            request,
            user,
            authenticated_at=datetime.fromtimestamp(auth_timestamp, UTC),
        )
    return response


def _router(settings: Settings, client: GoogleOAuth2, mode: Mode) -> APIRouter:
    from api.auth import get_user_manager
    from api.auth_sessions import require_recent_auth
    from api.ratelimit import auth_rate_limit

    router = APIRouter(dependencies=[Depends(auth_rate_limit)])
    prefix = "" if mode == "login" else f"/{mode}"
    callback_name = f"google:{mode}:callback"

    @router.get(f"{prefix}/authorize", name=f"google:{mode}:authorize")
    async def authorize(
        request: Request,
        response: Response,
        next: str | None = None,
        manager: Any = Depends(get_user_manager),
    ) -> dict[str, str]:
        csrf, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        data = {
            "csrf": csrf,
            "nonce": nonce,
            "purpose": f"google:{mode}",
            "next": safe_next(next, "/app" if mode == "login" else "/account"),
        }
        if mode != "login":
            session, user = await _current_user(request, manager)
            require_expected_user(request, user)
            if mode == "associate":
                if not user.is_verified:
                    raise HTTPException(403, "EMAIL_NOT_VERIFIED")
                await require_recent_auth(request, user)
            data = {**data, "user": str(user.id), "session": session.token_hash}
        state = generate_state_token(data, settings.effective_oauth_state_secret, _STATE_SECONDS)
        url = await client.get_authorization_url(
            str(request.url_for(callback_name)),
            state,
            ["openid", "email"],
            extras_params=_GoogleOIDCAuthorizeParams(
                nonce=nonce,
                prompt="select_account",
                claims='{"id_token":{"auth_time":{"essential":true}}}',
            ),
        )
        response.set_cookie(
            _cookie_name(settings, mode),
            csrf,
            max_age=_STATE_SECONDS,
            path=_COOKIE_PATH,
            secure=settings.cookie_secure,
            httponly=True,
            samesite="lax",
        )
        response.headers["Cache-Control"] = "no-store"
        return {"authorization_url": url}

    @router.get(f"{prefix}/callback", name=callback_name)
    async def callback(
        request: Request,
        code: str | None = None,
        state: str | None = None,
        error: str | None = None,
        manager: Any = Depends(get_user_manager),
    ) -> Response:
        next_path = "/app" if mode == "login" else "/account"
        try:
            data = _read_state(request, settings, mode, state)
            next_path = data["next"]
            if mode != "login":
                user = await _bound_user(request, manager, data)
                if mode == "associate" and not user.is_verified:
                    raise GoogleFlowError("email_not_verified")
            if error or not code:
                raise GoogleFlowError(
                    "oauth_cancelled" if error == "access_denied" else "oauth_failed"
                )
            token = await client.get_access_token(code, str(request.url_for(callback_name)))
            identity = await verify_google_identity(
                token, settings.google_oauth_client_id or "", data["nonce"]
            )
            return await _complete(request, settings, mode, manager, identity, data)
        except GoogleFlowError as exc:
            return _finish(settings, mode, next_path, exc.code)
        except Exception as exc:
            # Provider/DB exceptions may contain tokens or email addresses.
            # Retain the failure category without logging exception contents.
            logger.error("google_auth_failed", mode=mode, error_type=type(exc).__name__)
            return _finish(settings, mode, next_path, "oauth_failed")

    return router


def install_google_auth(app: FastAPI, settings: Settings) -> None:
    if not settings.google_oauth_configured:
        return
    client = GoogleOAuth2(
        settings.google_oauth_client_id or "",
        settings.google_oauth_client_secret or "",
        scopes=["openid", "email"],
    )
    for mode in ("login", "associate", "reauth"):
        app.include_router(_router(settings, client, mode), prefix=_COOKIE_PATH, tags=["auth"])
