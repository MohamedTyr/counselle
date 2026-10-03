"""FastAPI Users manager, revocable cookie sessions, and auth dependencies."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import jwt
import structlog
from fastapi import Depends, HTTPException, Request
from fastapi_users import BaseUserManager, FastAPIUsers, exceptions, schemas
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
)
from fastapi_users.exceptions import InvalidPasswordException, UserNotExists
from fastapi_users.jwt import decode_jwt, generate_jwt

from adapters.email import build_email_sender
from api.auth_expected_user import require_expected_user
from api.auth_lifecycle import reset_password as atomic_reset_password
from api.auth_lifecycle import send_account_email
from api.auth_sessions import get_session_strategy
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


# ---------------------------------------------------------------------------
# User manager
# ---------------------------------------------------------------------------


# See api/users_db.py: UserDB's ``hashed_password: str | None`` trips fastapi-users'
# UserProtocol type-var (which over-narrows it to ``str``). Runtime is correct
# (spike-verified); the variance objection is suppressed at each generic use.
class UserManager(BaseUserManager[UserDB, uuid.UUID]):  # type: ignore[type-var]
    """The fastapi-users manager over the asyncpg adapter."""

    user_db: AsyncpgUserDatabase

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
        min_len = self._settings.password_min_length
        if len(password) < min_len:
            raise InvalidPasswordException(f"Password must be at least {min_len} characters.")

    async def on_after_register(self, user: UserDB, request: Request | None = None) -> None:
        logger.info("user_registered", user_id=str(user.id))
        if not user.is_verified:
            await self.request_verify(user, request)

    async def on_after_forgot_password(
        self, user: UserDB, token: str, request: Request | None = None
    ) -> None:
        await send_account_email(
            self,
            to=user.email,
            subject="Reset your Acceptra password",
            purpose="reset_password",
            path="/reset-password",
            token=token,
        )

    async def on_after_request_verify(
        self, user: UserDB, token: str, request: Request | None = None
    ) -> None:
        await send_account_email(
            self,
            to=user.email,
            subject="Verify your Acceptra email",
            purpose="verify_email",
            path="/verify-email",
            token=token,
        )

    async def forgot_password(self, user: UserDB, request: Request | None = None) -> None:
        if not user.is_active:
            raise exceptions.UserInactive()
        if user.hashed_password is None:
            await send_account_email(
                self,
                to=user.email,
                subject="Sign in to Acceptra",
                purpose="google_signin_help",
                path="/login",
            )
            return
        token = generate_jwt(
            {
                "sub": str(user.id),
                "email": user.email,
                "password_fgpt": self.password_helper.hash(user.hashed_password),
                "credential_revision": user.credential_revision,
                "aud": self.reset_password_token_audience,
            },
            self.reset_password_token_secret,
            self.reset_password_token_lifetime_seconds,
        )
        await self.on_after_forgot_password(user, token, request)

    async def verify(self, token: str, request: Request | None = None) -> UserDB:
        try:
            data = decode_jwt(
                token, self.verification_token_secret, [self.verification_token_audience]
            )
            user = await self.get(self.parse_id(data["sub"]))
            if user.email != data["email"] or not user.is_active:
                raise exceptions.InvalidVerifyToken()
        except (
            jwt.PyJWTError,
            KeyError,
            TypeError,
            exceptions.InvalidID,
            exceptions.UserNotExists,
        ) as exc:
            raise exceptions.InvalidVerifyToken() from exc
        if user.is_verified:
            raise exceptions.UserAlreadyVerified()
        verified = await self.user_db.verify_email(user)
        if verified is None:
            raise exceptions.InvalidVerifyToken()
        await self.on_after_verify(verified, request)
        return verified

    async def reset_password(
        self, token: str, password: str, request: Request | None = None
    ) -> UserDB:
        user = await atomic_reset_password(self, token, password)
        await self.on_after_reset_password(user, request)
        return user

    async def on_after_reset_password(self, user: UserDB, request: Request | None = None) -> None:
        await send_account_email(
            self,
            to=user.email,
            subject="Your Acceptra password changed",
            purpose="password_changed",
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
            return await self.user_db.upgrade_password_hash(user, updated_hash)
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
                user = await self.user_db.update(user, {"hashed_password": None})  # nosec B105
            except Exception:
                # Compensate: the row was just created with a random hash; if we
                # can't null it, delete it so the OAuth flow fails clean instead
                # of stranding an OAuth user with a phantom password (has_password
                # would lie, and pre_existing=True on retry never fixes it).
                logger.exception("oauth null-hash update failed — removing the just-created user")
                await self.user_db.delete(user)
                raise
        return user

    async def _user_exists(self, oauth_name: str, account_id: str, account_email: str) -> bool:
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
    request: Request,
    user_db: AsyncpgUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, request.app.state.settings)


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

    return AuthenticationBackend(
        name="cookie", transport=transport, get_strategy=get_session_strategy
    )


_settings = get_settings()
auth_backend = _build_backend(_settings)

fastapi_users = FastAPIUsers[UserDB, uuid.UUID](  # type: ignore[type-var]
    get_user_manager, [auth_backend]
)

_authenticated_active_user = fastapi_users.current_user(active=True)
_authenticated_superuser = fastapi_users.current_user(active=True, superuser=True)


async def current_active_user(
    request: Request, user: UserDB = Depends(_authenticated_active_user)
) -> UserDB:
    require_expected_user(request, user)
    return user


async def current_superuser(
    request: Request, user: UserDB = Depends(_authenticated_superuser)
) -> UserDB:
    require_expected_user(request, user)
    return user


async def current_verified_user(user: UserDB = Depends(current_active_user)) -> UserDB:
    """AI calls require a verified mailbox, including resumed/retried turns."""
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")
    return user
