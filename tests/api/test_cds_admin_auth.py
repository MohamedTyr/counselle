"""P6.4 — permanent auth-gating regression test for the CDS admin surface.

``api/routes/cds_admin.py`` gates every route with ``Depends(current_superuser)``
at router level. That's correct today, but there was no test, so a regression
(a route added outside the router, or the dependency removed) would ship
silently — this is P5's manual gate ("every admin route 200 as superuser, 403
as a normal user") made permanent and automatic.

The route table is enumerated from the live app (``app.routes``), not hand-
copied — a newly added route is picked up automatically, and if it isn't
gated the same way, this test fails without needing to be edited. This is the
one property that makes the test worth having; see SHIP-PLAN.md §6.4.

Assertions, and why:

- **Normal (active, non-superuser) user → 403 on every route.** This is the
  boundary the test exists to guard.
- **Superuser → never 401/403.** We do NOT assert 200: several routes 404 on
  a synthetic id, or 422/415 on a missing/empty body, since this suite has no
  live DB and doesn't hand-build a valid payload per route. Chasing 200 on
  every route would make the test brittle for zero additional security
  signal — the thing this test guards is the *gate*, not each route's
  business logic (which has its own coverage). Any non-auth status the
  superuser path returns is fine; 401/403 is the only forbidden outcome.

No live DB, no live LLM/Tavily, no money spent: ``pipeline_pool``/``app_pool``
are mocked, matching the ``tests/api/test_routes_unit.py`` convention.
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
from api.routes import cds_admin
from api.users_db import UserDB
from tests.api.conftest import TEST_USER_ID

_TEST_ORIGIN = "http://testserver"


def _user(*, superuser: bool) -> UserDB:
    return UserDB(
        id=TEST_USER_ID,
        email="cds-admin-auth-test@counselle.test",
        hashed_password="x",
        is_active=True,
        is_superuser=superuser,
        is_verified=True,
    )


def _deny_superuser() -> None:
    """Stand-in for the real ``current_superuser``'s 403 on a non-superuser
    authenticated caller. Overridden onto the exact dependency under test, so
    a route that stops depending on it (the regression this test exists to
    catch) skips this raise entirely and the request proceeds unguarded."""
    raise HTTPException(403, "The user doesn't have enough privileges.")


def _make_pool() -> MagicMock:
    """A minimal asyncpg-shaped pool: real empty/None defaults so query code
    that iterates or unpacks a result doesn't crash before reaching whatever
    404/422 the service layer would raise for a missing synthetic id."""
    conn = AsyncMock()
    conn.fetch.return_value = []
    conn.fetchrow.return_value = None
    conn.fetchval.return_value = None
    conn.execute.return_value = "OK"
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool


def _app(*, superuser: bool) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=[_TEST_ORIGIN],
        cookie_secure=False,
        workspace_writes_per_minute=240,
        cds_upload_max_bytes=10_000_000,
    )
    install_middleware(app, settings)
    app.include_router(cds_admin.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(
        pipeline_pool=_make_pool(),
        app_pool=_make_pool(),
        deps=SimpleNamespace(catalog=None),
    )
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    # current_active_user backs unrelated per-user concerns on write routes
    # (workspace_write_rate_limit) — overridden in both cases so a 401 from
    # *that* dependency can never masquerade as the 403 this test checks for.
    app.dependency_overrides[current_active_user] = lambda: _user(superuser=superuser)
    app.dependency_overrides[current_superuser] = (
        (lambda: _user(superuser=True)) if superuser else _deny_superuser
    )
    return app


def _admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every (method, concrete-path) pair under the CDS admin router, derived
    from the live route table. Path params are filled from the endpoint's own
    type annotations (UUID vs. everything else) so this keeps working as
    routes are added or changed — nothing here is a hand-copied route list."""
    pairs: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/v1/admin/cds"):
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


def test_cds_admin_routes_are_superuser_gated() -> None:
    superuser_app = _app(superuser=True)
    normal_app = _app(superuser=False)
    routes = _admin_routes(superuser_app)
    # Guards the guard: if this list ever goes empty (router misconfigured,
    # prefix changed) the test below would vacuously pass — fail loudly instead.
    assert len(routes) >= 14, f"expected the full CDS admin route table, got {routes}"

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
