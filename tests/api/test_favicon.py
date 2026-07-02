"""Unit tests for the same-origin favicon proxy (GET /v1/favicon).

No live DB needed — a minimal app with ``current_active_user`` overridden,
same pattern as ``test_routes_unit.py``. ``httpx.AsyncClient`` is monkeypatched
so no real network call ever happens.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.context import install_middleware
from api.routes import favicon as favicon_routes
from tests.api.conftest import _test_user


def _make_app(*, authed: bool = True) -> FastAPI:
    app = FastAPI()
    install_middleware(app, MagicMock(cors_origins=["*"]))
    app.include_router(favicon_routes.router, prefix="/v1")
    if authed:
        app.dependency_overrides[current_active_user] = _test_user
    else:
        # current_active_user's dependency chain reads app.state.runtime.app_pool
        # before it ever gets to reject the (missing) session cookie — a bare
        # State object 500s on that attribute lookup instead of the 401 this
        # test wants, so a stub pool is enough to let auth fail normally.
        app.state.runtime = MagicMock(app_pool=MagicMock())
    return app


def _fake_response(status_code: int = 200, content: bytes = b"\x89PNG", ct: str = "image/png") -> Any:
    resp = MagicMock()
    resp.status_code = status_code
    resp.content = content
    resp.headers = {"content-type": ct}
    return resp


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    favicon_routes._cache.clear()
    yield
    favicon_routes._cache.clear()


def test_requires_auth() -> None:
    app = _make_app(authed=False)
    client = TestClient(app)
    resp = client.get("/v1/favicon", params={"host": "mit.edu"})
    assert resp.status_code == 401


def test_proxies_a_valid_host() -> None:
    app = _make_app()
    client = TestClient(app)
    fake_client = AsyncMock()
    fake_client.get.return_value = _fake_response()
    with patch.object(favicon_routes.httpx, "AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=fake_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        resp = client.get("/v1/favicon", params={"host": "mit.edu", "sz": 64})
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG"
    assert resp.headers["content-type"] == "image/png"
    assert "max-age" in resp.headers["cache-control"]
    # The upstream call always targets the fixed CDN host; the caller-supplied
    # host is only ever a query VALUE, never a connection target (no SSRF).
    fake_client.get.assert_awaited_once()
    called_url, called_kwargs = fake_client.get.call_args
    assert called_url[0] == favicon_routes.FAVICON_CDN_BASE
    assert called_kwargs["params"] == {"domain": "mit.edu", "sz": 64}


@pytest.mark.parametrize(
    "host",
    [
        "javascript:alert(1)",
        "http://evil.com",
        "127.0.0.1",
        "a b.com",
        "localhost",
        "",
    ],
)
def test_rejects_malformed_host_without_calling_upstream(host: str) -> None:
    app = _make_app()
    client = TestClient(app)
    with patch.object(favicon_routes.httpx, "AsyncClient") as MockClient:
        resp = client.get("/v1/favicon", params={"host": host})
    assert resp.status_code == 204
    MockClient.assert_not_called()


def test_upstream_failure_degrades_to_204() -> None:
    app = _make_app()
    client = TestClient(app)
    fake_client = AsyncMock()
    fake_client.get.side_effect = httpx.ConnectTimeout("timed out")
    with patch.object(favicon_routes.httpx, "AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=fake_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        resp = client.get("/v1/favicon", params={"host": "mit.edu"})
    assert resp.status_code == 204


def test_upstream_non_200_degrades_to_204() -> None:
    app = _make_app()
    client = TestClient(app)
    fake_client = AsyncMock()
    fake_client.get.return_value = _fake_response(status_code=404, content=b"")
    with patch.object(favicon_routes.httpx, "AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=fake_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        resp = client.get("/v1/favicon", params={"host": "mit.edu"})
    assert resp.status_code == 204


def test_second_request_is_served_from_cache() -> None:
    app = _make_app()
    client = TestClient(app)
    fake_client = AsyncMock()
    fake_client.get.return_value = _fake_response()
    with patch.object(favicon_routes.httpx, "AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=fake_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        first = client.get("/v1/favicon", params={"host": "mit.edu", "sz": 64})
        second = client.get("/v1/favicon", params={"host": "mit.edu", "sz": 64})
    assert first.status_code == second.status_code == 200
    fake_client.get.assert_awaited_once()  # only the first request hit "upstream"
