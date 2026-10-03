"""Account email delivery and atomic extensions of fastapi-users token flows."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import jwt
import structlog
from fastapi_users import exceptions
from fastapi_users.jwt import decode_jwt

from adapters.email import EmailPurpose
from api.users_db import UserDB

if TYPE_CHECKING:
    from api.auth import UserManager

logger = structlog.get_logger(__name__)


def account_link(settings: Any, path: str, token: str = "") -> str:
    suffix = f"?{urlencode({'token': token})}" if token else ""
    return f"{settings.auth_public_url}{path}{suffix}"


@lru_cache(maxsize=1)
def _email_limiter() -> Any:
    # Imported lazily: the shared limiter imports authentication dependencies.
    from api.ratelimit import SlidingWindowLimiter

    return SlidingWindowLimiter()


def reserve_account_email(manager: UserManager, to: str) -> bool:
    """Reserve before replacing a stored challenge, preserving links on cooldown."""
    return (
        _email_limiter().check_auth(
            hashlib.sha256(to.casefold().encode()).hexdigest(),
            attempts=getattr(manager._settings, "auth_email_attempts_per_window", 5),
            window_s=getattr(manager._settings, "auth_email_window_seconds", 900),
        )
        is None
    )


async def send_account_email(
    manager: UserManager,
    *,
    to: str,
    purpose: EmailPurpose,
    subject: str,
    path: str = "",
    token: str = "",
    reserved: bool = False,
) -> None:
    """Delivery failures are logged without leaking credentials or account existence.

    Registration and security mutations have already committed when their hooks
    run. Returning an error would misrepresent that state. Recovery remains
    enumeration-safe and students can request another message.
    """
    if (
        not reserved
        and purpose not in {"password_changed", "email_changed"}
        and not reserve_account_email(manager, to)
    ):
        logger.info("account_email_rate_limited", purpose=purpose)
        return
    try:
        await manager._email.send(
            to=to,
            subject=subject,
            token=token,
            purpose=purpose,
            link=account_link(manager._settings, path, token) if path else None,
        )
    except Exception as exc:
        logger.error(
            "account_email_delivery_failed", purpose=purpose, error_type=type(exc).__name__
        )


async def reset_password(manager: UserManager, token: str, password: str) -> UserDB:
    """Use native signed password fingerprints, with an atomic compare-and-set.

    The library's read/verify/update sequence alone allows two concurrent uses of
    one link. The adapter compares the old hash while writing and revokes every
    session in that same transaction.
    """
    try:
        data = decode_jwt(
            token, manager.reset_password_token_secret, [manager.reset_password_token_audience]
        )
        user = await manager.get(manager.parse_id(data["sub"]))
        if data["email"] != user.email:
            raise exceptions.InvalidResetPasswordToken()
        revision = data.get("credential_revision")
        if type(revision) is not int or revision != user.credential_revision:
            raise exceptions.InvalidResetPasswordToken()
        fingerprint = data["password_fgpt"]
        if not isinstance(fingerprint, str) or not user.hashed_password:
            raise exceptions.InvalidResetPasswordToken()
        valid, _ = manager.password_helper.verify_and_update(user.hashed_password, fingerprint)
        if not valid:
            raise exceptions.InvalidResetPasswordToken()
    except (
        jwt.PyJWTError,
        KeyError,
        TypeError,
        exceptions.InvalidID,
        exceptions.UserNotExists,
    ) as exc:
        raise exceptions.InvalidResetPasswordToken() from exc
    if not user.is_active:
        raise exceptions.UserInactive()
    await manager.validate_password(password, user)
    updated = await manager.user_db.replace_password(user, manager.password_helper.hash(password))
    if updated is None:
        raise exceptions.InvalidResetPasswordToken()
    return updated
