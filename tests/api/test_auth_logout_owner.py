"""The native logout route honors the tab's displayed account before revocation."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import auth_backend, get_user_manager
from api.main import _install_auth_routers
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.users_db import UserDB
from config.settings import get_settings


@pytest.fixture
def logout_client():
    settings = get_settings().model_copy(
        update={
            "google_oauth_client_id": None,
            "google_oauth_client_secret": None,
            "cookie_secure": False,
        }
    )
    user = UserDB(uuid4(), "cookie-owner@example.com", "hash", True, False, True)
    manager = SimpleNamespace(authenticate=AsyncMock(return_value=user), on_after_login=AsyncMock())
    strategy = SimpleNamespace(
        read_token=AsyncMock(return_value=user),
        destroy_token=AsyncMock(),
        write_token=AsyncMock(return_value="new-session"),
    )
    app = FastAPI()
    app.state.settings = settings
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    app.dependency_overrides[get_user_manager] = lambda: manager
    app.dependency_overrides[auth_backend.get_strategy] = lambda: strategy
    _install_auth_routers(app, settings)
    with TestClient(app, base_url="https://testserver") as client:
        client.headers["Origin"] = "https://testserver"
        client.cookies.set(
            auth_backend.transport.cookie_name, "account-b-session", domain="testserver.local"
        )
        yield SimpleNamespace(client=client, strategy=strategy, user=user, manager=manager)


@pytest.mark.parametrize("expected", ["other", "malformed", "empty"])
def test_stale_tab_cannot_logout_current_cookie_owner(logout_client, expected):
    h = logout_client
    value = {"other": str(uuid4()), "malformed": "forged-user", "empty": ""}[expected]
    response = h.client.post("/v1/auth/logout", headers={"X-Expected-User-Id": value})
    assert response.status_code == 409
    assert response.json() == {"detail": "ACCOUNT_CHANGED"}
    assert "set-cookie" not in response.headers
    assert h.client.cookies.get(auth_backend.transport.cookie_name) == "account-b-session"
    h.strategy.destroy_token.assert_not_awaited()


@pytest.mark.parametrize("expected", ["absent", "matching"])
def test_native_logout_still_revokes_current_session(logout_client, expected):
    h = logout_client
    headers = {} if expected == "absent" else {"X-Expected-User-Id": str(h.user.id)}
    response = h.client.post("/v1/auth/logout", headers=headers)
    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    h.strategy.destroy_token.assert_awaited_once_with("account-b-session", h.user)


def test_native_login_remains_public_and_can_switch_accounts(logout_client):
    h = logout_client
    h.client.cookies.clear()
    response = h.client.post(
        "/v1/auth/login",
        headers={"X-Expected-User-Id": str(uuid4())},
        data={"username": h.user.email, "password": "password"},
    )
    assert response.status_code == 204
    h.strategy.read_token.assert_not_awaited()
    h.strategy.write_token.assert_awaited_once_with(h.user)
