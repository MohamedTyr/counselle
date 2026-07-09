"""Unit tests for browser auth origin protection."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.auth_security import auth_origin_protect
from api.deps import EnvelopeError, envelope_error_handler


def _app(cors_origins: list[str], *, cookie_secure: bool = False) -> FastAPI:
    app = FastAPI()
    app.state.settings = SimpleNamespace(cors_origins=cors_origins, cookie_secure=cookie_secure)
    app.add_exception_handler(EnvelopeError, envelope_error_handler)

    @app.post("/auth-post", dependencies=[Depends(auth_origin_protect)])
    async def auth_post() -> dict[str, bool]:
        return {"ok": True}

    return app


def test_auth_origin_protect_allows_local_vite_origin_in_dev_by_default() -> None:
    client = TestClient(_app([]), raise_server_exceptions=False)

    response = client.post("/auth-post", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_auth_origin_protect_requires_configured_origin_when_cookie_secure() -> None:
    client = TestClient(_app([], cookie_secure=True), raise_server_exceptions=False)

    response = client.post("/auth-post", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Invalid auth request origin."


def test_auth_origin_protect_rejects_unconfigured_cross_origin() -> None:
    client = TestClient(_app([]), raise_server_exceptions=False)

    response = client.post("/auth-post", headers={"Origin": "https://attacker.example"})

    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Invalid auth request origin."
