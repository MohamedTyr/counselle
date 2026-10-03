"""A stale account screen cannot act on a different browser-cookie owner."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import api.auth_google as google
import api.routes.auth_account as account
from api.auth import _authenticated_active_user, get_user_manager
from api.routes import auth_reauthenticate, me
from api.users_db import UserDB
from config.settings import get_settings


@pytest.fixture
def account_app():
    user = UserDB(
        id=uuid4(),
        email="student@example.com",
        hashed_password="hash",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    app = FastAPI()
    app.state.settings = get_settings()
    # Any handler crossing a DB boundary before the owner check fails this test.
    pool = SimpleNamespace(acquire=Mock(side_effect=AssertionError("unexpected DB access")))
    app.state.runtime = SimpleNamespace(app_pool=pool)
    app.dependency_overrides[_authenticated_active_user] = lambda: user
    app.dependency_overrides[get_user_manager] = lambda: object()
    app.include_router(me.router, prefix="/v1")
    app.include_router(account.router, prefix="/v1/auth")
    app.include_router(auth_reauthenticate.router, prefix="/v1/auth")
    return SimpleNamespace(app=app, user=user, pool=pool)


@pytest.mark.parametrize("expected", ["other", "malformed", "empty"])
@pytest.mark.parametrize(
    "method,path,body",
    [
        ("DELETE", "/v1/me", None),
        ("DELETE", "/v1/me/chats", None),
        ("PATCH", "/v1/me", {"name": "Changed"}),
        ("POST", "/v1/auth/password", {"password": "new-password"}),
        ("POST", "/v1/auth/email/change", {"email": "new@example.com"}),
        ("POST", "/v1/auth/reauthenticate", {"password": "password"}),
        ("POST", "/v1/auth/reauthenticate/email", None),
        ("POST", "/v1/auth/reauthenticate/email/confirm", {"token": "token"}),
        ("POST", "/v1/auth/logout-all", None),
    ],
)
async def test_stale_account_rejected_before_side_effects(
    account_app, expected, method, path, body
):
    value = {"other": str(uuid4()), "malformed": "not-a-uuid", "empty": ""}[expected]
    async with AsyncClient(
        transport=ASGITransport(app=account_app.app), base_url="http://localhost:8000"
    ) as client:
        response = await client.request(
            method,
            path,
            json=body,
            headers={"Origin": "http://localhost:8000", "X-Expected-User-Id": value},
        )
    assert response.status_code == 409
    assert response.json() == {"detail": "ACCOUNT_CHANGED"}
    account_app.pool.acquire.assert_not_called()


@pytest.mark.parametrize("expected", ["absent", "matching"])
async def test_current_account_and_legacy_client_can_logout_all(account_app, monkeypatch, expected):
    revoke = AsyncMock()
    monkeypatch.setattr(account, "revoke_user_sessions", revoke)
    headers = {} if expected == "absent" else {"X-Expected-User-Id": str(account_app.user.id)}
    async with AsyncClient(
        transport=ASGITransport(app=account_app.app), base_url="http://localhost:8000"
    ) as client:
        response = await client.post("/v1/auth/logout-all", headers=headers)
    assert response.status_code == 204
    revoke.assert_awaited_once_with(account_app.pool, account_app.user.id)


@pytest.mark.parametrize("mode", ["associate", "reauth"])
@pytest.mark.parametrize("expected", ["other", "malformed", "empty", "absent", "matching"])
async def test_google_checks_owner_before_provider_start(account_app, monkeypatch, mode, expected):
    client = SimpleNamespace(get_authorization_url=AsyncMock(return_value="https://example.test"))
    session = SimpleNamespace(token_hash="session-hash")
    monkeypatch.setattr(
        google, "_current_user", AsyncMock(return_value=(session, account_app.user))
    )
    recent = AsyncMock()
    monkeypatch.setattr("api.auth_sessions.require_recent_auth", recent)
    account_app.app.include_router(
        google._router(account_app.app.state.settings, client, mode), prefix="/v1/auth/google"
    )
    values = {
        "other": str(uuid4()),
        "malformed": "not-a-uuid",
        "empty": "",
        "matching": str(account_app.user.id),
    }
    headers = {} if expected == "absent" else {"X-Expected-User-Id": values[expected]}
    async with AsyncClient(
        transport=ASGITransport(app=account_app.app), base_url="http://localhost:8000"
    ) as http:
        response = await http.get(f"/v1/auth/google/{mode}/authorize", headers=headers)
    if expected in {"absent", "matching"}:
        assert response.status_code == 200
        client.get_authorization_url.assert_awaited_once()
    else:
        assert response.status_code == 409
        assert response.json() == {"detail": "ACCOUNT_CHANGED"}
        assert "set-cookie" not in response.headers
        recent.assert_not_awaited()
        client.get_authorization_url.assert_not_awaited()
