"""The FastAPI app factory for the Counselle API service (Phase 5 Slice A).

``create_app()`` wires:

- ``get_settings()`` at factory time — fail-fast: a misconfigured environment
  kills boot right here (ADR 0018);
- the request-context stack — trace ids, CORS, the 500 error envelope
  (``api/context.py``);
- the ``/v1`` routers — Slice A ships empty stubs in ``api/routes/``; Slice B
  fills their bodies (sessions, messages SSE, health, admin reconcile);
- the lifespan — logging, the Phase 4 runtime via ``app.deps.build_runtime``
  (RO pool + catalog, app pool, durable checkpointer incl. the D3 schema
  assertion, compiled graph), the field-index reconciler (startup pass +
  interval task, both non-fatal — keyword fallback serves when the index
  lags). The API process is the SINGLE reconcile owner (audit H4); the MCP
  child reads the index, it does not maintain it. The shared loop body lives
  in ``counselle_db/reconcile.py``; this process supplies health callbacks.
  Plus the MCP child supervisor (eng-review D4, ``api/supervision.py``).

Everything lives on ``app.state``: ``settings``, ``runtime``, ``reconciler``,
``mcp_supervisor`` — Slice B's routes read them from there.

Run: ``uv run uvicorn api.main:create_app --factory``.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import Depends, FastAPI

from api.auth import (
    UserCreate,
    UserRead,
    UserUpdate,
    auth_backend,
    fastapi_users,
    google_oauth_client,
    oauth_backend,
)
from api.auth_security import auth_origin_protect
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter, auth_rate_limit
from api.routes import (
    activities,
    applications,
    essays,
    me,
    sessions,
    system,
    tasks,
    workspace_events,
)
from api.routes import config as config_routes
from api.supervision import McpSupervisor
from app.deps import build_runtime
from app.titles import make_auto_titler
from app.turns import TurnRegistry
from config.logging import setup_logging
from config.settings import get_settings, load_yaml_asset

# ADR 0017 deviation 2: api/ → counselle_db direct import accepted for MVP1.
from counselle_db.reconcile import reconcile_forever, reconcile_once

logger = structlog.get_logger(__name__)


@dataclass
class ReconcilerState:
    """The last reconcile outcome, surfaced in ``/v1/health`` (ARCHITECTURE §19)."""

    last_run: str | None = None
    last_result: dict[str, int] | None = None
    last_error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "last_run": self.last_run,
            "last_result": self.last_result,
            "last_error": self.last_error,
        }


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot the runtime, reconciler, and MCP supervisor; put it all away on shutdown."""
    settings = get_settings()
    setup_logging(settings.log_level)
    # Pre-load the data assets so a missing/broken file fails at boot, not per-request.
    load_yaml_asset("step_labels")
    load_yaml_asset("greeting_templates")
    load_yaml_asset("season_calendar")
    load_yaml_asset("starter_prompts")
    runtime = await build_runtime(settings)  # pools + catalog + checkpointer (D3) + graph
    try:
        reconciler = ReconcilerState()

        def _on_result(result: dict[str, int]) -> None:
            reconciler.last_run = datetime.now(UTC).isoformat()
            reconciler.last_result = result
            reconciler.last_error = None

        def _on_error(exc: Exception) -> None:
            reconciler.last_run = datetime.now(UTC).isoformat()
            reconciler.last_result = None
            # Surface only the class name; the full message may contain internal
            # hosts/ports/DSNs — log server-side, never expose to clients.
            reconciler.last_error = type(exc).__name__
            logger.exception(
                "field_index reconcile failed — keyword fallback serves",
                error=repr(exc),
            )

        await reconcile_once(runtime.app_pool, _on_result, _on_error)
        reconcile_task = asyncio.create_task(
            reconcile_forever(
                runtime.app_pool,
                settings.reconcile_interval_minutes,
                _on_result,
                _on_error,
            ),
            name="field-index-reconciler",
        )
        supervisor = McpSupervisor(runtime.deps.mcp_toolset)
        supervisor.start()  # first probe spawns/verifies the counselle-db child (D4)
        # Wire supervisor.kick to deps.on_failure so any turn crash immediately
        # triggers a probe + restart of the MCP child (FIX 3; ADR 0017 carve-out).
        runtime.deps.on_failure = supervisor.kick
        # B2: the turn registry — detached turns, reattach, cancel (G3–G5).
        registry = TurnRegistry(deps=runtime.deps, graph=runtime.graph, settings=settings)
        # B4: the auto-title hook (cheap-model retitle; never raises — see titles.py).
        registry.on_turn_complete = make_auto_titler(runtime.app_pool, runtime, settings)
        app.state.settings = settings
        app.state.runtime = runtime
        app.state.reconciler = reconciler
        app.state.mcp_supervisor = supervisor
        app.state.turn_registry = registry
        # B4: the process-local rate limiter (messages + auth windows). The named
        # constant governs both the write here and the read in get_limiter.
        setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
        try:
            yield
        finally:
            # Drain the registry FIRST: in-flight turns' final state writes
            # must land before runtime.aclose() closes the pools.
            await registry.aclose()
            reconcile_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reconcile_task
            await supervisor.aclose()
    finally:
        await runtime.aclose()


def _install_auth_routers(app: FastAPI, settings: Any) -> None:
    """Mount the fastapi-users routers under ``/v1/auth`` (B3, ADR 0021).

    register (custom UserCreate carrying ``name``), login (form-encoded) +
    logout, forgot/reset (always 202), the users router (email/password change
    — story 49), and — when Google creds are set — the OAuth router whose
    callback sets the cookie and 302s the SPA.
    """
    auth_post_dependencies = [Depends(auth_origin_protect), Depends(auth_rate_limit)]
    # B4/B8: per-IP rate limit on every auth state-changing surface. Login/reset
    # are brute-forceable or spam-worthy; register also needs abuse protection
    # before the cookie-backed auth UI ships. The origin guard blocks login CSRF.
    app.include_router(
        fastapi_users.get_auth_router(auth_backend),
        prefix="/v1/auth",
        tags=["auth"],
        dependencies=auth_post_dependencies,
    )
    app.include_router(
        fastapi_users.get_register_router(UserRead, UserCreate),
        prefix="/v1/auth",
        tags=["auth"],
        dependencies=auth_post_dependencies,
    )
    app.include_router(
        fastapi_users.get_reset_password_router(),
        prefix="/v1/auth",
        tags=["auth"],
        dependencies=auth_post_dependencies,
    )
    app.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/v1/auth", tags=["auth"]
    )
    google_client = google_oauth_client()
    if google_client is not None:
        app.include_router(
            fastapi_users.get_oauth_router(
                google_client,
                oauth_backend,
                settings.effective_oauth_state_secret,
                redirect_url=None,
                # DS-04 (PRE-DEPLOY SECURITY ITEM — blocks B6): associate-by-email
                # without email verification is an account-takeover surface (a
                # password account on an email links with a later Google sign-in
                # for that email, and vice-versa). A documented MVP tradeoff
                # (ADR 0021, PRD decision 6) — NOT changed in this hardening pass
                # (flipping it changes login UX, a product decision). Before any
                # non-trivial user base, do option (1) require email verification
                # before login, (2) only associate when the existing account is
                # verified, or (3) gate current_active_user on is_verified for
                # password accounts — see plans/audit/phase-6-configurability.md
                # DS-04 and TODOS.md.
                associate_by_email=True,
            ),
            prefix="/v1/auth/google",
            tags=["auth"],
        )


def create_app() -> FastAPI:
    """Build the Counselle API service (ADR 0016): middleware, /v1 routers, lifespan."""
    settings = get_settings()  # fail-fast: misconfiguration kills boot at the factory
    app = FastAPI(title="Counselle", version="0.1.0", lifespan=_lifespan)
    install_middleware(app, settings)
    _install_auth_routers(app, settings)
    app.include_router(sessions.router, prefix="/v1")
    app.include_router(system.router, prefix="/v1")
    app.include_router(me.router, prefix="/v1")
    app.include_router(config_routes.router, prefix="/v1")
    app.include_router(applications.router, prefix="/v1")
    app.include_router(tasks.router, prefix="/v1")
    app.include_router(essays.router, prefix="/v1")
    app.include_router(activities.router, prefix="/v1")
    app.include_router(workspace_events.router, prefix="/v1")
    return app
