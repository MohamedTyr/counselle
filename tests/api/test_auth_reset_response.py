"""Native password-reset responses clear the browser session only on success."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi_users import exceptions

from api.auth import _build_backend, auth_backend, get_user_manager
from api.main import _install_auth_routers
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.users_db import UserDB
from config.settings import get_settings


@pytest.fixture
def reset_client(monkeypatch):
    settings = get_settings().model_copy(
        update={
            "cookie_name": "custom_auth_cookie",
            "cookie_secure": True,
            "password_reset_enabled": True,
            "auth_self_signup_enabled": False,
            "google_oauth_client_id": None,
            "google_oauth_client_secret": None,
        }
    )
    monkeypatch.setattr(auth_backend, "transport", _build_backend(settings).transport)
    account_a = UserDB(uuid4(), "account-a@example.com", "hash", True, False, True)
    manager = SimpleNamespace(
        reset_password=AsyncMock(return_value=account_a),
        get_by_email=AsyncMock(return_value=account_a),
        forgot_password=AsyncMock(),
    )
    app = FastAPI()
    app.state.settings = settings
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    app.dependency_overrides[get_user_manager] = lambda: manager
    _install_auth_routers(app, settings)
    with TestClient(app, base_url="https://testserver") as client:
        client.headers["Origin"] = "https://testserver"
        client.cookies.set(settings.cookie_name, "account-b-session", domain="testserver.local")
        yield client, manager, settings.cookie_name


def test_resetting_account_a_clears_browser_account_b_cookie(reset_client):
    client, manager, cookie_name = reset_client
    response = client.post(
        "/v1/auth/reset-password",
        json={"token": "account-a-token", "password": "new-valid-password"},
    )
    assert response.status_code == 200
    request = manager.reset_password.call_args.args[2]
    assert request.cookies[cookie_name] == "account-b-session"
    manager.reset_password.assert_awaited_once_with(
        "account-a-token", "new-valid-password", request
    )
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f'{cookie_name}="";')
    assert all(part in cookie for part in ("Max-Age=0", "HttpOnly", "Secure", "SameSite=lax"))
    assert cookie_name not in client.cookies


@pytest.mark.parametrize(
    "error",
    [
        exceptions.InvalidResetPasswordToken(),
        exceptions.UserNotExists(),
        exceptions.InvalidPasswordException("Password is too short."),
    ],
)
def test_rejected_reset_preserves_browser_cookie(reset_client, error):
    client, manager, cookie_name = reset_client
    manager.reset_password.side_effect = error
    response = client.post(
        "/v1/auth/reset-password", json={"token": "invalid-token", "password": "short"}
    )
    assert response.status_code == 400
    assert "set-cookie" not in response.headers
    assert client.cookies[cookie_name] == "account-b-session"


def test_invalid_reset_body_preserves_browser_cookie(reset_client):
    client, manager, cookie_name = reset_client
    response = client.post("/v1/auth/reset-password", json={"token": "account-a-token"})
    assert response.status_code == 422
    assert "set-cookie" not in response.headers
    assert client.cookies[cookie_name] == "account-b-session"
    manager.reset_password.assert_not_awaited()


def test_forgot_password_preserves_browser_cookie(reset_client):
    client, manager, cookie_name = reset_client
    response = client.post("/v1/auth/forgot-password", json={"email": "account-a@example.com"})
    assert response.status_code == 202
    assert "set-cookie" not in response.headers
    assert client.cookies[cookie_name] == "account-b-session"
    manager.forgot_password.assert_awaited_once()
