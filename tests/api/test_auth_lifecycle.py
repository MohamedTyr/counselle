"""Credential/token security regressions, independent of external providers."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi_users import exceptions
from fastapi_users.jwt import decode_jwt

from api.auth import UserManager, current_verified_user
from api.auth_lifecycle import _email_limiter
from api.users_db import UserDB


@pytest.fixture(autouse=True)
def reset_email_limiter() -> Iterator[None]:
    _email_limiter().reset()
    yield
    _email_limiter().reset()


class MemoryUsers:
    def __init__(self, user: UserDB) -> None:
        self.user = user
        self.revocations = 0
        self.lock = asyncio.Lock()

    async def get(self, user_id: uuid.UUID) -> UserDB | None:
        return replace(self.user) if self.user.id == user_id else None

    async def replace_password(self, user: UserDB, hashed_password: str) -> UserDB | None:
        await asyncio.sleep(0)
        async with self.lock:
            if (
                self.user.hashed_password != user.hashed_password
                or self.user.email != user.email
                or self.user.credential_revision != user.credential_revision
            ):
                return None
            self.user = replace(
                self.user,
                hashed_password=hashed_password,
                credential_revision=self.user.credential_revision + 1,
            )
            self.revocations += 1
            return self.user


def manager_and_user(password: bool = True) -> tuple[Any, Any]:
    settings = SimpleNamespace(
        jwt_secret="test-secret-" * 4,
        email_provider="console",
        email_from="accounts@mail.acceptra.ai",
        password_min_length=8,
        auth_public_url="https://acceptra.ai",
    )
    user = UserDB(uuid.uuid4(), "student@example.com", None, True, False, True)
    db = MemoryUsers(user)
    manager: Any = UserManager(cast(Any, db), cast(Any, settings))
    if password:
        db.user = replace(user, hashed_password=manager.password_helper.hash("password-original"))
    manager._email = SimpleNamespace(send=AsyncMock())
    return manager, db


async def reset_token(manager: Any, db: Any) -> str:
    await manager.forgot_password(db.user)
    return str(manager._email.send.call_args.kwargs["token"])


async def test_google_only_recovery_sends_signin_help_without_reset_token() -> None:
    manager, db = manager_and_user(password=False)
    await manager.forgot_password(db.user)
    message = manager._email.send.call_args.kwargs
    assert message["purpose"] == "google_signin_help"
    assert message["token"] == ""
    assert message["link"] == "https://acceptra.ai/login"


async def test_reset_is_single_use_and_only_one_concurrent_request_can_win() -> None:
    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    results = await asyncio.gather(
        manager.reset_password(token, "new-password-a"),
        manager.reset_password(token, "new-password-b"),
        return_exceptions=True,
    )
    assert sum(isinstance(result, UserDB) for result in results) == 1
    assert sum(isinstance(result, exceptions.InvalidResetPasswordToken) for result in results) == 1
    assert db.revocations == 1
    with pytest.raises(exceptions.InvalidResetPasswordToken):
        await manager.reset_password(token, "new-password-c")


async def test_reset_link_invalid_after_email_change() -> None:
    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    db.user = replace(db.user, email="replacement@example.com")
    with pytest.raises(exceptions.InvalidResetPasswordToken):
        await manager.reset_password(token, "new-password")
    assert db.revocations == 0


async def test_reset_short_password_does_not_consume_link() -> None:
    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    with pytest.raises(exceptions.InvalidPasswordException):
        await manager.reset_password(token, "short")
    await manager.reset_password(token, "valid-password")
    assert db.revocations == 1


async def test_register_requests_native_verification_email() -> None:
    manager, db = manager_and_user()
    user = replace(db.user, is_verified=False)
    await manager.on_after_register(user)
    message = manager._email.send.call_args.kwargs
    assert message["purpose"] == "verify_email"
    claims = decode_jwt(
        message["token"], manager.verification_token_secret, [manager.verification_token_audience]
    )
    assert claims["sub"] == str(user.id)
    assert claims["email"] == user.email
    assert message["link"].startswith("https://acceptra.ai/verify-email?token=")


async def test_public_recovery_does_not_expose_delivery_failure() -> None:
    manager, db = manager_and_user()
    manager._email.send.side_effect = RuntimeError("private provider error")
    await manager.forgot_password(db.user)


async def test_verified_dependency_denies_unverified_user() -> None:
    _, db = manager_and_user()
    with pytest.raises(HTTPException) as error:
        await current_verified_user(replace(db.user, is_verified=False))
    assert error.value.detail == "EMAIL_NOT_VERIFIED"
    assert await current_verified_user(db.user) == db.user


async def test_login_rehash_cannot_restore_concurrently_reset_password() -> None:
    manager, db = manager_and_user()
    original = db.user
    db.get_by_email = AsyncMock(return_value=original)
    db.upgrade_password_hash = AsyncMock(return_value=None)
    manager.password_helper = SimpleNamespace(
        verify_and_update=lambda password, hashed: (True, "upgraded-old-hash"),
    )
    result = await manager.authenticate(SimpleNamespace(username=original.email, password="old"))
    assert result is None
    db.upgrade_password_hash.assert_awaited_once_with(original, "upgraded-old-hash")


async def test_mailbox_rate_limit_covers_requests_from_different_networks() -> None:
    manager, db = manager_and_user(password=False)
    for _ in range(8):
        await manager.forgot_password(db.user)
    assert manager._email.send.await_count == 5


async def test_email_change_rechecks_session_after_waiting_for_user_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from starlette.requests import Request

    from api.routes.auth_account import EmailBody, request_email_change

    manager, db = manager_and_user()
    session = SimpleNamespace(token_hash="a" * 64)
    monkeypatch.setattr(
        "api.routes.auth_account.require_recent_auth", AsyncMock(return_value=session)
    )
    # Simulate reset winning the user lock: account snapshot can still match
    # for logout-all, but the original auth session has already been removed.
    conn = SimpleNamespace(fetchval=AsyncMock(side_effect=[db.user.id, None]), execute=AsyncMock())

    @asynccontextmanager
    async def transaction() -> AsyncIterator[None]:
        yield

    conn.transaction = transaction

    @asynccontextmanager
    async def acquire() -> AsyncIterator[Any]:
        yield conn

    app = SimpleNamespace(
        state=SimpleNamespace(
            settings=SimpleNamespace(auth_action_lifetime_seconds=3600, auth_recent_seconds=600),
            runtime=SimpleNamespace(app_pool=SimpleNamespace(acquire=acquire)),
        )
    )
    request = Request({"type": "http", "app": app})
    with pytest.raises(HTTPException) as error:
        await request_email_change(
            EmailBody(email="attacker@example.com"), request, db.user, manager
        )
    assert error.value.detail == "REAUTHENTICATION_REQUIRED"
    conn.execute.assert_not_awaited()
    manager._email.send.assert_not_awaited()


async def test_reset_link_stays_invalid_after_email_changes_back() -> None:
    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    original_email = db.user.email
    db.user = replace(db.user, email="changed@example.com", credential_revision=1)
    db.user = replace(db.user, email=original_email, credential_revision=2)
    with pytest.raises(exceptions.InvalidResetPasswordToken):
        await manager.reset_password(token, "new-password")
    assert db.revocations == 0


@pytest.mark.parametrize("revision", [None, True, "0", -1])
async def test_reset_rejects_missing_or_invalid_credential_revision(revision) -> None:
    from fastapi_users.jwt import generate_jwt

    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    claims = decode_jwt(
        token, manager.reset_password_token_secret, [manager.reset_password_token_audience]
    )
    if revision is None:
        claims.pop("credential_revision", None)
    else:
        claims["credential_revision"] = revision
    token = generate_jwt(claims, manager.reset_password_token_secret)
    with pytest.raises(exceptions.InvalidResetPasswordToken):
        await manager.reset_password(token, "new-password")
    assert db.revocations == 0


async def test_reset_revision_is_rechecked_during_atomic_consumption() -> None:
    manager, db = manager_and_user()
    token = await reset_token(manager, db)
    original = db.replace_password

    async def intervening_email_cycle(user, hashed_password):
        db.user = replace(db.user, credential_revision=db.user.credential_revision + 2)
        return await original(user, hashed_password)

    db.replace_password = intervening_email_cycle
    with pytest.raises(exceptions.InvalidResetPasswordToken):
        await manager.reset_password(token, "new-password")
    assert db.revocations == 0
