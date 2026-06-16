"""fastapi-users wiring: the user manager, the cookie-JWT backend, routers (B3).

ADR 0021. The auth-critical pieces:

- :class:`UserManager` — ``name`` on register, console-email forgot/verify, and
  two overrides the spike pinned: ``authenticate`` (the null-hash guard, so an
  OAuth-only user attempting password login fails cleanly with timing parity)
  and ``oauth_callback`` (force ``hashed_password = NULL`` for a freshly created
  OAuth user, since stock fastapi-users generates a random hash — we keep
  ``has_password`` honest).
- the cookie-JWT backend (``httpOnly``, ``Secure`` Settings-gated, ``SameSite=Lax``,
  TTL locked to 30 days, no refresh; logout = cookie deletion).
- routers mounted under ``/v1/auth`` by ``api/main.py``.

``/v1/auth`` (the fastapi-users users router) vs ``/v1/me`` (``api/routes/me.py``)
split: the users router serves credential changes (email/password — story 49);
``/v1/me`` serves the profile/settings read+write and account deletion. They are
deliberately separate surfaces.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import structlog
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, schemas
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.authentication.transport.cookie import CookieTransport as _CookieTransport
from fastapi_users.exceptions import InvalidPasswordException, UserNotExists
from httpx_oauth.clients.google import GoogleOAuth2
from starlette.responses import RedirectResponse, Response

from adapters.email import build_email_sender
from api.users_db import AsyncpgUserDatabase, UserDB
from config.settings import Settings, get_settings

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Pydantic schemas (settings stays OUT of UserUpdate — it goes via /v1/me PATCH)
# ---------------------------------------------------------------------------


class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str | None = None


class UserCreate(schemas.BaseUserCreate):
    name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    name: str | None = None


# ---------------------------------------------------------------------------
# User manager
# ---------------------------------------------------------------------------


# See api/users_db.py: UserDB's ``hashed_password: str | None`` trips fastapi-users'
# UserProtocol type-var (which over-narrows it to ``str``). Runtime is correct
# (spike-verified); the variance objection is suppressed at each generic use.
class UserManager(BaseUserManager[UserDB, uuid.UUID]):  # type: ignore[type-var]
    """The fastapi-users manager over the asyncpg adapter."""

    def __init__(self, user_db: AsyncpgUserDatabase, settings: Settings) -> None:
        super().__init__(user_db)
        self._settings = settings
        self.reset_password_token_secret = settings.jwt_secret
        self.verification_token_secret = settings.jwt_secret
        self._email = build_email_sender(settings)

    def parse_id(self, value: Any) -> uuid.UUID:
        if isinstance(value, uuid.UUID):
            return value
        try:
            return uuid.UUID(str(value))
        except (ValueError, TypeError, AttributeError) as exc:
            from fastapi_users.exceptions import InvalidID

            raise InvalidID() from exc

    async def validate_password(self, password: str, user: Any) -> None:
        if len(password) < 8:
            raise InvalidPasswordException("Password must be at least 8 characters.")

    async def on_after_register(self, user: UserDB, request: Request | None = None) -> None:
        logger.info("user_registered", user_id=str(user.id))

    async def on_after_forgot_password(
        self, user: UserDB, token: str, request: Request | None = None
    ) -> None:
        await self._email.send(
            to=user.email, subject="Reset your Counselle password", token=token
        )

    async def on_after_request_verify(
        self, user: UserDB, token: str, request: Request | None = None
    ) -> None:
        await self._email.send(
            to=user.email, subject="Verify your Counselle email", token=token
        )

    async def authenticate(self, credentials: Any) -> UserDB | None:
        """Password login with the null-hash guard (spike recipe).

        Unknown email or an OAuth-only user (``hashed_password is None``) → run a
        dummy hash for timing parity, return None (the stock router maps None →
        400 LOGIN_BAD_CREDENTIALS). A real hash → verify, auto-upgrading it when
        pwdlib recommends a stronger one.
        """
        try:
            user = await self.get_by_email(credentials.username)
        except UserNotExists:
            self.password_helper.hash(credentials.password)
            return None
        if user.hashed_password is None:
            # OAuth-only: no password to verify. Keep timing constant, fail clean.
            self.password_helper.hash(credentials.password)
            return None
        verified, updated_hash = self.password_helper.verify_and_update(
            credentials.password, user.hashed_password
        )
        if not verified:
            return None
        if updated_hash is not None:
            await self.user_db.update(user, {"hashed_password": updated_hash})
        return user

    async def oauth_callback(self, *args: Any, **kwargs: Any) -> UserDB:
        """Force ``hashed_password = NULL`` for a newly created OAuth user.

        Stock fastapi-users generates a random password hash on OAuth-create; we
        null it so ``has_password`` stays honest (an OAuth-only user has none).

        We discriminate on whether ANY user existed for this identity before the
        callback (by oauth account OR by associated email). If one did — a
        returning OAuth user, or a password user being associate-by-email'd —
        their password is left untouched. Only a brand-new user gets nulled.
        """
        oauth_name, account_id, account_email = args[0], args[2], args[3]
        pre_existing = await self._user_exists(oauth_name, account_id, account_email)
        user = await super().oauth_callback(*args, **kwargs)
        if not pre_existing and user.hashed_password is not None:
            try:
                await self.user_db.update(user, {"hashed_password": None})  # nosec B105
            except Exception:
                # Compensate: the row was just created with a random hash; if we
                # can't null it, delete it so the OAuth flow fails clean instead
                # of stranding an OAuth user with a phantom password (has_password
                # would lie, and pre_existing=True on retry never fixes it).
                logger.exception("oauth null-hash update failed — removing the just-created user")
                await self.user_db.delete(user)
                raise
            user.hashed_password = None
        return user

    async def _user_exists(
        self, oauth_name: str, account_id: str, account_email: str
    ) -> bool:
        """True if a user already exists for this OAuth account or its email."""
        try:
            await self.get_by_oauth_account(oauth_name, account_id)
            return True
        except UserNotExists:
            pass
        try:
            await self.get_by_email(account_email)
            return True
        except UserNotExists:
            return False


# ---------------------------------------------------------------------------
# Dependency wiring
# ---------------------------------------------------------------------------


def get_user_db(request: Request) -> AsyncpgUserDatabase:
    """The asyncpg user database over the app pool (from ``app.state.runtime``)."""
    return AsyncpgUserDatabase(request.app.state.runtime.app_pool)


async def get_user_manager(
    user_db: AsyncpgUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, get_settings())


def _build_backend(
    settings: Settings,
) -> AuthenticationBackend[UserDB, uuid.UUID]:  # type: ignore[type-var]
    transport = CookieTransport(
        cookie_name=settings.cookie_name,
        cookie_max_age=settings.jwt_lifetime_seconds,
        cookie_httponly=True,
        cookie_secure=settings.cookie_secure,
        cookie_samesite="lax",
    )

    def get_strategy() -> JWTStrategy[UserDB, uuid.UUID]:  # type: ignore[type-var]
        return JWTStrategy(
            secret=settings.jwt_secret, lifetime_seconds=settings.jwt_lifetime_seconds
        )

    return AuthenticationBackend(  # type: ignore[type-var]
        name="cookie", transport=transport, get_strategy=get_strategy
    )


class _OAuthRedirectCookieTransport(_CookieTransport):
    """Cookie transport whose login response 302-redirects to the SPA (spike 3).

    Used only by the OAuth backend: the Google callback sets the auth cookie AND
    sends the browser back to the app root, instead of returning a bare 204.
    """

    def __init__(self, redirect_url: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._redirect_url = redirect_url

    async def get_login_response(self, token: str) -> Response:
        response = RedirectResponse(self._redirect_url, status_code=302)
        return self._set_login_cookie(response, token)


def _build_oauth_backend(
    settings: Settings,
) -> AuthenticationBackend[UserDB, uuid.UUID]:  # type: ignore[type-var]
    transport = _OAuthRedirectCookieTransport(
        redirect_url=settings.oauth_redirect_url,
        cookie_name=settings.cookie_name,
        cookie_max_age=settings.jwt_lifetime_seconds,
        cookie_httponly=True,
        cookie_secure=settings.cookie_secure,
        cookie_samesite="lax",
    )

    def get_strategy() -> JWTStrategy[UserDB, uuid.UUID]:  # type: ignore[type-var]
        return JWTStrategy(
            secret=settings.jwt_secret, lifetime_seconds=settings.jwt_lifetime_seconds
        )

    return AuthenticationBackend(  # type: ignore[type-var]
        name="oauth-cookie", transport=transport, get_strategy=get_strategy
    )


_settings = get_settings()
auth_backend = _build_backend(_settings)
oauth_backend = _build_oauth_backend(_settings)

fastapi_users = FastAPIUsers[UserDB, uuid.UUID](  # type: ignore[type-var]
    get_user_manager, [auth_backend]
)

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)


def google_oauth_client() -> GoogleOAuth2 | None:
    """The Google OAuth client when both credentials are configured, else None."""
    if not _settings.google_oauth_configured:
        return None
    return GoogleOAuth2(
        _settings.google_oauth_client_id,  # type: ignore[arg-type]  # guarded by google_oauth_configured
        _settings.google_oauth_client_secret,  # type: ignore[arg-type]
    )
