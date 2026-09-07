"""Permanent auth-gating regression test for the school-data admin surface
(plan §5.5/§7 Phase 1 exit criteria: "All superuser-gated"), mirroring
`tests/api/test_cds_admin_auth.py`'s approach for `api/routes/cds_admin.py`.

The route table is enumerated from the live app (`app.routes`), not
hand-copied, so a route added outside the router (or the dependency removed)
fails this test without it needing an edit.

Assertions:
- **Normal (active, non-superuser) user -> 403 on every route.**
- **Superuser -> never 401/403.** Business-logic status codes (404/409/422
  from a synthetic path/no-op body) are fine — this test guards the gate,
  not each route's behaviour, which has its own coverage.

No live DB, no live LLM/Tavily: `pipeline_pool` is a `MagicMock` whose
`fetch`/`fetchrow`/`fetchval` are `AsyncMock`s (this router's queries call
the pool directly, unlike `cds_admin.py`'s `pool.acquire()` pattern).
"""

from __future__ import annotations

import inspect
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.auth import current_active_user, current_superuser
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import admin_facts
from api.users_db import UserDB
from tests.api.conftest import TEST_USER_ID

_TEST_ORIGIN = "http://testserver"


def _user(*, superuser: bool) -> UserDB:
    return UserDB(
        id=TEST_USER_ID,
        email="admin-facts-auth-test@counselle.test",
        hashed_password="x",
        is_active=True,
        is_superuser=superuser,
        is_verified=True,
    )


def _deny_superuser() -> None:
    """Stand-in for the real `current_superuser`'s 403 — overridden onto the
    exact dependency under test, so a route that stops depending on it (the
    regression this test exists to catch) skips this raise entirely and the
    request proceeds unguarded."""
    raise HTTPException(403, "The user doesn't have enough privileges.")


def _make_pool() -> MagicMock:
    """A minimal asyncpg-Pool-shaped mock: real empty/None defaults so query
    code that iterates or unpacks a result doesn't crash before reaching
    whatever status the route would otherwise return."""
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetchval = AsyncMock(return_value=0)
    return pool


def _app(*, superuser: bool) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=[_TEST_ORIGIN],
        cookie_secure=False,
        workspace_writes_per_minute=240,
        facts_admin_history_limit=20,
        facts_admin_unmapped_limit=200,
        facts_worker_enabled=False,
        facts_crawl_interval_hours=24,
    )
    install_middleware(app, settings)
    app.include_router(admin_facts.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(pipeline_pool=_make_pool())
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    # current_active_user backs workspace_write_rate_limit on the POST route
    # — overridden in both cases so a 401 from *that* dependency never
    # masquerades as the 403 this test checks for.
    app.dependency_overrides[current_active_user] = lambda: _user(superuser=superuser)
    app.dependency_overrides[current_superuser] = (
        (lambda: _user(superuser=True)) if superuser else _deny_superuser
    )
    return app


def _admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every (method, concrete-path) pair under the admin-facts router,
    derived from the live route table so a new route is picked up
    automatically."""
    pairs: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/v1/admin/facts"):
            continue
        sig = inspect.signature(route.endpoint)
        path = route.path
        for name in re.findall(r"\{(\w+)\}", path):
            annotation = sig.parameters[name].annotation if name in sig.parameters else str
            value = str(uuid4()) if annotation is UUID else "1"
            path = path.replace("{" + name + "}", value, 1)
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            pairs.append((method, path))
    return pairs


def test_admin_facts_routes_are_superuser_gated() -> None:
    superuser_app = _app(superuser=True)
    normal_app = _app(superuser=False)
    routes = _admin_routes(superuser_app)
    # Guards the guard: if this list ever goes empty (router misconfigured,
    # prefix changed) the test below would vacuously pass — fail loudly.
    assert len(routes) >= 3, f"expected the full admin-facts route table, got {routes}"

    headers = {"origin": _TEST_ORIGIN}
    with (
        TestClient(superuser_app, raise_server_exceptions=False) as su_client,
        TestClient(normal_app, raise_server_exceptions=False) as user_client,
    ):
        for method, path in routes:
            user_resp = user_client.request(method, path, headers=headers)
            assert user_resp.status_code == 403, (
                f"{method} {path}: non-superuser got {user_resp.status_code}, expected 403"
            )

            su_resp = su_client.request(method, path, headers=headers)
            assert su_resp.status_code not in (401, 403), (
                f"{method} {path}: superuser got {su_resp.status_code}"
            )


def test_facts_admin_parts_503_when_pipeline_pool_unset() -> None:
    """The pool-not-configured 503 (plan §5.5, mirrors `cds_admin.py`'s
    `_cds_parts`) — a superuser still gets a clean 503, not a crash, when
    `COUNSELLE_DB_PIPELINE_DSN` isn't set."""
    app = _app(superuser=True)
    app.state.runtime = SimpleNamespace(pipeline_pool=None)
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.get("/v1/admin/facts/status", headers={"origin": _TEST_ORIGIN})
    assert resp.status_code == 503
