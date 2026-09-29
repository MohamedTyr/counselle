"""Hermetic tests for API factory helper contracts (no runtime/database boot)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.main import _install_spa_routes


def test_spa_routes_are_not_installed_when_disabled() -> None:
    app = FastAPI()
    _install_spa_routes(app, SimpleNamespace(serve_spa=False))
    assert not any(getattr(route, "path", None) == "/{full_path:path}" for route in app.routes)


def test_spa_mode_fails_fast_with_complete_missing_asset_list(tmp_path: Path) -> None:
    app = FastAPI()
    with pytest.raises(RuntimeError, match="built frontend is incomplete") as exc_info:
        _install_spa_routes(app, SimpleNamespace(serve_spa=True, spa_dist_dir=tmp_path))
    message = str(exc_info.value)
    assert "index.html" in message
    assert "landing.html" in message
    assert "assets" in message


def test_spa_fallback_serves_landing_assets_and_preserves_api_404(tmp_path: Path) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    (tmp_path / "index.html").write_text("app", encoding="utf-8")
    (tmp_path / "landing.html").write_text("landing", encoding="utf-8")
    (tmp_path / "landing-workspace-preview.webp").write_bytes(b"webp")
    (assets / "app.js").write_text("asset", encoding="utf-8")
    app = FastAPI()
    _install_spa_routes(app, SimpleNamespace(serve_spa=True, spa_dist_dir=tmp_path))

    with TestClient(app) as client:
        assert client.get("/").text == "landing"
        assert client.get("/landing.html").text == "landing"
        assert client.get("/landing-workspace-preview.webp").content == b"webp"
        assert client.get("/assets/app.js").text == "asset"
        assert client.get("/app/tasks").text == "app"
        response = client.get("/v1/not-mounted")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Not found"
