"""Routine (no DB) tests for `/v1/health`'s `facts_worker` key
(plan §7 Phase 1 exit criteria, `api/routes/system.py`)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from tests.api.test_routes_unit import _make_pool, make_test_app


def _healthy_pools() -> tuple[MagicMock, MagicMock]:
    ro_pool, _ = _make_pool()
    app_pool, _ = _make_pool()
    return ro_pool, app_pool


def test_facts_worker_disabled_by_default() -> None:
    ro_pool, app_pool = _healthy_pools()
    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)
    with TestClient(app) as tc:
        response = tc.get("/v1/health")
    assert response.status_code == 200
    assert response.json()["facts_worker"] == "disabled"
    assert response.json()["status"] == "ok"


def test_facts_worker_ok_when_last_run_recent() -> None:
    ro_pool, app_pool = _healthy_pools()
    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)
    app.state.settings.facts_worker_enabled = True
    app.state.runtime.pipeline_pool = MagicMock()
    last_run = SimpleNamespace(status="succeeded", finished_at=datetime.now(UTC))
    with (
        patch("api.routes.system.facts_queries.get_last_run", AsyncMock(return_value=last_run)),
        TestClient(app) as tc,
    ):
        response = tc.get("/v1/health")
    assert response.json()["facts_worker"] == "ok"
    assert response.json()["status"] == "ok"


def test_facts_worker_stale_when_last_run_failed() -> None:
    ro_pool, app_pool = _healthy_pools()
    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)
    app.state.settings.facts_worker_enabled = True
    app.state.runtime.pipeline_pool = MagicMock()
    last_run = SimpleNamespace(status="failed", finished_at=datetime.now(UTC))
    with (
        patch("api.routes.system.facts_queries.get_last_run", AsyncMock(return_value=last_run)),
        TestClient(app) as tc,
    ):
        response = tc.get("/v1/health")
    assert response.json()["facts_worker"] == "stale"
    assert response.json()["status"] == "degraded"


def test_facts_worker_stale_when_last_run_too_old() -> None:
    ro_pool, app_pool = _healthy_pools()
    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)
    app.state.settings.facts_worker_enabled = True
    app.state.settings.facts_crawl_interval_hours = 24
    app.state.runtime.pipeline_pool = MagicMock()
    stale_finish = datetime.now(UTC) - timedelta(hours=2 * 24 + 1)
    last_run = SimpleNamespace(status="succeeded", finished_at=stale_finish)
    with (
        patch("api.routes.system.facts_queries.get_last_run", AsyncMock(return_value=last_run)),
        TestClient(app) as tc,
    ):
        response = tc.get("/v1/health")
    assert response.json()["facts_worker"] == "stale"
    assert response.json()["status"] == "degraded"
