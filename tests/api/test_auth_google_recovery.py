"""Reproduce pre-registration takeover through local recovery, entirely in memory."""

from __future__ import annotations

import uuid
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from fastapi_users.jwt import generate_jwt
from fastapi_users.router.oauth import STATE_TOKEN_AUDIENCE
from httpx import ASGITransport, AsyncClient

import api.auth_google as google
import api.auth_google_accounts as accounts
import api.auth_sessions as sessions
from api.auth import UserCreate, UserManager, get_user_manager
from api.auth_google_identity import GoogleFlowError
from api.auth_lifecycle import _email_limiter
from api.users_db import UserDB
from tests.api import test_auth_google as google_tests

flow = google_tests.flow
transaction = google_tests.transaction


class RecoveryUsers:
    """Only persistence is substituted; manager and Google route logic stay real."""

    def __init__(self) -> None:
        self.user: UserDB | None = None
        self.session: sessions.AccessToken | None = None

    async def create(self, values: dict[str, Any]) -> UserDB:
        self.user = UserDB(
            **{
                "id": uuid.uuid4(),
                "is_active": True,
                "is_superuser": False,
                "is_verified": False,
                **values,
            }
        )
        return self.user

    async def get(self, user_id: uuid.UUID) -> UserDB | None:
        return replace(self.user) if self.user and self.user.id == user_id else None

    async def get_by_email(self, email: str) -> UserDB | None:
        if self.user and self.user.email.casefold() == email.casefold():
            return replace(self.user)
        return None

    async def get_by_oauth_account(self, provider: str, account_id: str) -> UserDB | None:
        if self.user and any(
            account.oauth_name == provider and account.account_id == account_id
            for account in self.user.oauth_accounts
        ):
            return replace(self.user)
        return None

    async def replace_password(self, user: UserDB, hashed_password: str) -> UserDB | None:
        if self.user != user:
            return None
        self.user = replace(
            user,
            hashed_password=hashed_password,
            credential_revision=user.credential_revision + 1,
        )
        self.session = None
        return self.user

    async def verify_email(self, user: UserDB) -> UserDB | None:
        if self.user != user:
            return None
        self.user = replace(user, is_verified=True)
        return self.user


def _legacy_association_state(client: AsyncClient, settings: Any, session: Any) -> str:
    """An authentic state issued before the verification gate was deployed."""
    csrf = "pre-fix-association-csrf"
    client.cookies.set(google._cookie_name(settings, "associate"), csrf, path="/v1/auth/google")
    return generate_jwt(
        {
            "aud": STATE_TOKEN_AUDIENCE,
            "csrf": csrf,
            "nonce": "pre-fix-association-nonce",
            "purpose": "google:associate",
            "next": "/account",
            "user": str(session.user_id),
            "session": session.token_hash,
        },
        settings.effective_oauth_state_secret,
        600,
    )


async def test_google_pre_registration_attack_cannot_survive_mailbox_recovery(
    flow, transaction, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = flow.settings.model_copy(
        update={"email_provider": "console", "auth_self_signup_enabled": False}
    )
    db = RecoveryUsers()
    manager = UserManager(cast(Any, db), settings)
    manager._email = SimpleNamespace(send=AsyncMock())
    flow.app.state.settings = settings
    flow.app.dependency_overrides[get_user_manager] = lambda: manager
    # Reinstall with this test's settings; only the provider boundary is mocked.
    flow.app.router.routes.clear()
    google.install_google_auth(flow.app, settings)
    flow.verify.return_value = replace(flow.identity, email="attacker@gmail.com")
    monkeypatch.setattr(
        sessions, "get_request_session", AsyncMock(side_effect=lambda _: db.session)
    )
    _email_limiter().reset()
    try:
        await _run_attack_and_recovery(flow, transaction, db, manager, settings)
    finally:
        _email_limiter().reset()


async def _run_attack_and_recovery(flow, transaction, db, manager, settings) -> None:
    victim_email = "victim@example.com"
    attacker_password = "attacker-chosen-password"
    victim_password = "victim-recovered-password"
    # The attacker knows a mailbox address, but cannot read its verification mail.
    registered = await manager.create(
        UserCreate(email=victim_email, password=attacker_password), safe=True
    )
    assert not registered.is_verified
    registration_mail = manager._email.send.call_args.kwargs
    assert registration_mail["to"] == victim_email
    assert registration_mail["purpose"] == "verify_email"
    attacker_login = await manager.authenticate(
        SimpleNamespace(username=victim_email, password=attacker_password)
    )
    assert attacker_login and attacker_login.id == registered.id
    db.session = replace(flow.session, user_id=registered.id)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as attacker:
        denied = await attacker.get("/v1/auth/google/associate/authorize")
        assert denied.status_code == 403
        assert denied.json()["detail"] == "EMAIL_NOT_VERIFIED"
        assert not attacker.cookies
        state = _legacy_association_state(attacker, settings, db.session)
        denied = await attacker.get(
            "/v1/auth/google/associate/callback", params={"state": state, "code": "attacker-code"}
        )
        assert "error=email_not_verified" in denied.headers["location"]
        flow.token_exchange.assert_not_awaited()
        # The durable credential boundary also refuses an unverified snapshot.
        with pytest.raises(GoogleFlowError, match="email_not_verified"):
            await accounts.associate_google_user(
                transaction.pool,
                registered,
                flow.verify.return_value,
                session_hash=db.session.token_hash,
                recent_seconds=settings.auth_recent_seconds,
            )
        transaction.conn.execute.assert_not_awaited()
        await _recover_mailbox(manager, db, victim_email, victim_password)
        assert db.session is None
        assert not db.user.oauth_accounts
        assert (
            await manager.authenticate(
                SimpleNamespace(username=victim_email, password=attacker_password)
            )
            is None
        )
        recovered = await manager.authenticate(
            SimpleNamespace(username=victim_email, password=victim_password)
        )
        assert recovered and recovered.id == registered.id and recovered.is_verified
        # Even an outstanding valid state cannot use the revoked original session.
        attacker.cookies.set(
            google._cookie_name(settings, "associate"),
            "pre-fix-association-csrf",
            path="/v1/auth/google",
        )
        denied = await attacker.get(
            "/v1/auth/google/associate/callback", params={"state": state, "code": "late-code"}
        )
        assert "error=oauth_invalid_state" in denied.headers["location"]
        flow.token_exchange.assert_not_awaited()
        callback, state, _ = await google_tests._start(attacker)
        response = await attacker.get(callback, params={"state": state, "code": "google-code"})
        # Signup is closed so a previously unlinked Google identity cannot create
        # a separate account; it must never be recognized as the recovered victim.
        assert "error=signup_disabled" in response.headers["location"]
        flow.token_exchange.assert_awaited_once()
        flow.strategy.write_token.assert_not_awaited()
        assert attacker.cookies.get(settings.cookie_name) is None
        assert db.user.id == registered.id and db.user.is_verified


async def _recover_mailbox(manager, db, victim_email: str, password: str) -> None:
    await manager.forgot_password(db.user)
    reset_mail = manager._email.send.call_args.kwargs
    assert reset_mail["to"] == victim_email
    assert reset_mail["purpose"] == "reset_password"
    await manager.reset_password(reset_mail["token"], password)
    await manager.request_verify(db.user)
    verify_mail = manager._email.send.call_args.kwargs
    assert verify_mail["to"] == victim_email
    assert verify_mail["purpose"] == "verify_email"
    await manager.verify(verify_mail["token"])
