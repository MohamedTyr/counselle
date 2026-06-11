"""Phase 6 harness tests.

- GET /harness → 200 with text/html content
- GET /v1/meta/sources → subreddits match subreddit_menu.yaml, defaults match settings

These tests use the same conftest fixtures as the protocol tests: ``live_app``
gives a FastAPI test app with the full router set including system.router.
We additionally mount the harness StaticFiles directly so the /harness route
is available in the test app.

All tests are marked ``@pytest.mark.live_db`` (the conftest requires a live DB
for the pools; the harness / meta/sources endpoints themselves only need the
static files and settings).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from api.context import install_middleware
from api.routes import sessions as session_routes
from api.routes import system as system_routes
from config.settings import get_settings

pytestmark = pytest.mark.live_db

_HARNESS_DIR = Path(__file__).parent.parent.parent / "harness"


# ---------------------------------------------------------------------------
# Minimal test app factory (no DB pools needed for these two endpoints)
# ---------------------------------------------------------------------------


def _make_harness_app() -> FastAPI:
    """Minimal FastAPI app with system router + harness static mount."""
    settings = get_settings()
    app = FastAPI(title="Counselle-HarnessTest")
    install_middleware(app, settings)
    app.include_router(session_routes.router, prefix="/v1")
    app.include_router(system_routes.router, prefix="/v1")
    if _HARNESS_DIR.is_dir():
        app.mount(
            "/harness",
            StaticFiles(directory=str(_HARNESS_DIR), html=True),
            name="harness",
        )
    return app


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestHarnessStatic:
    """/harness serves the index page."""

    def test_harness_serves_200_html(self) -> None:
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            res = client.get("/harness")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        ct = res.headers.get("content-type", "")
        assert "text/html" in ct, f"Expected text/html, got {ct!r}"
        # Sanity-check the page contains the harness title
        assert "Counselle" in res.text

    def test_harness_js_served(self) -> None:
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            for asset in ("app.js", "style.css", "viz.js", "clarify.js"):
                res = client.get(f"/harness/{asset}")
                assert res.status_code == 200, f"/harness/{asset} returned {res.status_code}"


class TestMetaSources:
    """GET /v1/meta/sources matches the menu asset and settings defaults."""

    def test_meta_sources_returns_200(self) -> None:
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            res = client.get("/v1/meta/sources")
        assert res.status_code == 200

    def test_subreddits_match_yaml(self) -> None:
        """Every entry in the YAML appears in the response."""
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            res = client.get("/v1/meta/sources")
        data = res.json()

        # Load the raw YAML for comparison
        menu_path = (
            Path(__file__).parent.parent.parent / "config" / "assets" / "subreddit_menu.yaml"
        )
        with menu_path.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        yaml_subs = {entry["sub"] for entry in (raw or [])}
        resp_subs = {entry["sub"] for entry in data.get("subreddits", [])}
        assert yaml_subs == resp_subs, f"YAML subs {yaml_subs} != response subs {resp_subs}"

    def test_defaults_match_settings(self) -> None:
        """Defaults in the response match the settings object."""
        settings = get_settings()
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            res = client.get("/v1/meta/sources")
        data = res.json()
        defaults = data.get("defaults", {})

        assert defaults.get("web") == settings.source_web_default
        assert defaults.get("reddit") == settings.source_reddit_default
        assert defaults.get("edu") == settings.source_edu_default

    def test_response_has_required_keys(self) -> None:
        app = _make_harness_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            res = client.get("/v1/meta/sources")
        data = res.json()
        assert "subreddits" in data
        assert "defaults" in data
        assert "web" in data["defaults"]
        assert "reddit" in data["defaults"]
        assert "edu" in data["defaults"]
