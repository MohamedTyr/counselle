"""Unit tests for api/context.py — trace ids, principal parsing, CORS, error envelope.

The middleware stack is tested on a bare FastAPI app (no lifespan, no DB);
``test_app_boots_with_lifespan`` is the one live integration check that the
real factory boots against the live DB (Slice A's gate).
"""

from __future__ import annotations

import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.context import ERROR_MESSAGE, install_middleware

ORIGIN = "http://allowed.example"
_HEX32 = re.compile(r"^[0-9a-f]{32}$")


def make_app() -> FastAPI:
    app = FastAPI()
    install_middleware(app, SimpleNamespace(cors_origins=[ORIGIN]))

    @app.get("/echo")
    async def echo(request: Request) -> dict[str, str | None]:
        return {
            "trace_id": request.state.trace_id,
            "principal": request.state.principal,
        }

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("super secret internals")

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(make_app(), raise_server_exceptions=False)


def test_trace_id_minted_per_request(client: TestClient) -> None:
    first = client.get("/echo").json()["trace_id"]
    second = client.get("/echo").json()["trace_id"]
    assert _HEX32.match(first)
    assert _HEX32.match(second)
    assert first != second


def test_principal_parsed_from_bearer_header(client: TestClient) -> None:
    body = client.get("/echo", headers={"Authorization": "Bearer tok-123"}).json()
    assert body["principal"] == "tok-123"


def test_principal_none_without_header(client: TestClient) -> None:
    assert client.get("/echo").json()["principal"] is None


def test_principal_none_for_non_bearer_scheme(client: TestClient) -> None:
    body = client.get("/echo", headers={"Authorization": "Basic dXNlcjpwdw=="}).json()
    assert body["principal"] is None


def test_error_envelope_hides_internals_and_carries_trace_id(client: TestClient) -> None:
    response = client.get("/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["message"] == ERROR_MESSAGE
    assert _HEX32.match(body["error"]["trace_id"])
    assert "secret" not in response.text  # internals never leak


def test_cors_preflight_allows_configured_origin(client: TestClient) -> None:
    response = client.options(
        "/echo",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN


@pytest.mark.live_db
def test_app_boots_with_lifespan() -> None:
    """The real factory boots: runtime, reconciler state, and MCP supervisor on app.state."""
    from api.main import create_app

    app = create_app()
    with TestClient(app):
        assert app.state.runtime.graph is not None
        assert set(app.state.reconciler.as_dict()) == {"last_run", "last_result", "last_error"}
        assert app.state.mcp_supervisor.status()["status"] in {"ok", "restarting", "failed"}
