"""The FastAPI app factory for the Counselle API service (Phase 5 Slice A).

``create_app()`` wires:

- ``get_settings()`` at factory time — fail-fast: a misconfigured environment
  kills boot right here (ADR 0018);
- the request-context stack — trace ids, CORS, the 500 error envelope
  (``api/context.py``);
- the ``/v1`` routers — Slice A ships empty stubs in ``api/routes/``; Slice B
  fills their bodies (sessions, messages SSE, health);
- the lifespan — logging, the Phase 4 runtime via ``app.deps.build_runtime``
  (RO pool + catalog, app pool, durable checkpointer incl. the D3 schema
  assertion, compiled graph).

Everything lives on ``app.state``: ``settings``, ``runtime`` — Slice B's
routes read them from there.

Run: ``uv run uvicorn api.main:create_app --factory``.
"""

from __future__ import annotations

import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic_ai_harness.experimental import HarnessExperimentalWarning

# pydantic-ai-harness==0.4.0 (D3, plans/goal-mode-plan.md §4.1) is pinned
# `Development Status :: 3 - Alpha`; every capability it ships warns on
# import. Silenced once at the app boundary rather than per call site.
warnings.filterwarnings("ignore", category=HarnessExperimentalWarning)

from api.auth import (
    UserCreate,
    UserRead,
    auth_backend,
    current_active_user,
    fastapi_users,
)
from api.auth_reset_response import clear_cookie_after_password_reset
from api.auth_security import auth_origin_protect
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter, auth_rate_limit
from api.routes import (
    activities,
    admin_facts,
    applications,
    calendar,
    documents,
    essays,
    me,
    memories,
    onboarding,
    profile,
    sat,
    schools_facts,
    sessions,
    system,
    tasks,
    workspace_events,
)
from api.routes import config as config_routes
from app.caveats import caveat_catalog
from app.deps import build_runtime
from app.facts.jobs import start_facts_worker
from app.prompt import validate_prompt_assets
from app.skills import load_all_skill_meta
from app.titles import make_auto_titler
from app.turns import TurnRegistry
from config.logging import setup_logging
from config.settings import get_settings, load_yaml_asset

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot the runtime; put it away on shutdown."""
    settings = get_settings()
    setup_logging(settings.log_level)
    # Pre-load the data assets so a missing/broken file fails at boot, not per-request.
    load_yaml_asset("step_labels")
    load_yaml_asset("greeting_templates")
    load_yaml_asset("season_calendar")
    load_yaml_asset("starter_prompts")
    load_yaml_asset("facts_keys")
    load_yaml_asset("facts_sections")
    caveat_catalog()
    validate_prompt_assets()
    load_all_skill_meta()
    runtime = await build_runtime(settings)  # pools + catalog + checkpointer (D3) + graph
    try:
        # B2: the turn registry — detached turns, reattach, cancel (G3–G5).
        registry = TurnRegistry(deps=runtime.deps, graph=runtime.graph, settings=settings)
        # B4: the auto-title hook (cheap-model retitle; never raises — see titles.py).
        registry.on_turn_complete = make_auto_titler(runtime.app_pool, runtime, settings)
        app.state.settings = settings
        app.state.runtime = runtime
        app.state.turn_registry = registry
        # B4: the process-local rate limiter (messages + auth windows). The named
        # constant governs both the write here and the read in get_limiter.
        setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
        # school-data-v3: the facts crawl-pass worker (replaces the parked
        # CDS extraction poller, app.cds.jobs.start_cds_worker; see
        # PARKED.md) — a no-op when the pipeline pool isn't configured or
        # COUNSELLE_FACTS_WORKER_ENABLED is false (default).
        facts_poller = await start_facts_worker(runtime, settings)
        app.state.facts_poller = facts_poller
        try:
            yield
        finally:
            # Stop claiming/renewing new facts work before the pools it
            # depends on (runtime.pipeline_pool) are closed below.
            if facts_poller is not None:
                await facts_poller.stop()
            # Drain the registry FIRST: in-flight turns' final state writes
            # must land before runtime.aclose() closes the pools.
            await registry.aclose()
    finally:
        await runtime.aclose()


def _install_auth_routers(app: FastAPI, settings: Any) -> None:
    """Mount native login/token routes and guarded account credential routes."""
    auth_post_dependencies = [Depends(auth_origin_protect), Depends(auth_rate_limit)]
    # B4/B8: per-IP rate limit on every auth state-changing surface. Login/reset
    # are brute-forceable or spam-worthy; register also needs abuse protection
    # before the cookie-backed auth UI ships. The origin guard blocks login CSRF.
    for route in fastapi_users.get_auth_router(auth_backend).routes:
        # The native logout handler has its own authentication dependency;
        # apply our owner binding there while leaving native login public.
        owner_dependencies = (
            [Depends(current_active_user)]
            if getattr(route, "name", None) == f"auth:{auth_backend.name}.logout"
            else []
        )
        app.include_router(
            APIRouter(routes=[route]),
            prefix="/v1/auth",
            tags=["auth"],
            dependencies=[*auth_post_dependencies, *owner_dependencies],
        )
    if settings.auth_self_signup_enabled:
        app.include_router(
            fastapi_users.get_register_router(UserRead, UserCreate),
            prefix="/v1/auth",
            tags=["auth"],
            dependencies=auth_post_dependencies,
        )
    if settings.password_reset_enabled:
        app.include_router(
            fastapi_users.get_reset_password_router(),
            prefix="/v1/auth",
            tags=["auth"],
            dependencies=[*auth_post_dependencies, Depends(clear_cookie_after_password_reset)],
        )
    else:

        async def _disabled_password_reset() -> None:
            raise HTTPException(status_code=404)

        app.add_api_route(
            "/v1/auth/forgot-password",
            _disabled_password_reset,
            methods=["POST"],
            include_in_schema=False,
        )
        app.add_api_route(
            "/v1/auth/reset-password",
            _disabled_password_reset,
            methods=["POST"],
            include_in_schema=False,
        )
    app.include_router(
        fastapi_users.get_verify_router(UserRead),
        prefix="/v1/auth",
        dependencies=auth_post_dependencies,
    )
    from api.auth_google import install_google_auth
    from api.routes.auth_account import router as account_router
    from api.routes.auth_reauthenticate import router as reauthenticate_router

    app.include_router(account_router, prefix="/v1/auth", dependencies=auth_post_dependencies)
    app.include_router(
        reauthenticate_router, prefix="/v1/auth", dependencies=auth_post_dependencies
    )
    install_google_auth(app, settings)


def _install_spa_routes(app: FastAPI, settings: Any) -> None:
    """Serve the static logged-out landing page and SPA when ADR 0023 mode is enabled."""
    if not settings.serve_spa:
        return

    dist_dir = Path(settings.spa_dist_dir)
    index_path = dist_dir / "index.html"
    landing_path = dist_dir / "landing.html"
    landing_preview_path = dist_dir / "landing-workspace-preview.webp"
    assets_dir = dist_dir / "assets"
    missing = [
        str(path)
        for path in (dist_dir, index_path, landing_path, landing_preview_path, assets_dir)
        if not path.exists()
    ]
    if missing:
        raise RuntimeError(
            "COUNSELLE_SERVE_SPA=true but the built frontend is incomplete: " + ", ".join(missing)
        )

    app.mount("/assets", StaticFiles(directory=assets_dir), name="spa-assets")

    @app.get("/", include_in_schema=False)
    async def landing() -> FileResponse:
        return FileResponse(landing_path)

    @app.get("/landing-workspace-preview.webp", include_in_schema=False)
    async def landing_preview() -> FileResponse:
        return FileResponse(landing_preview_path)

    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    async def spa_fallback(full_path: str, request: Request) -> FileResponse | JSONResponse:
        if full_path == "landing.html":
            return FileResponse(landing_path)
        if full_path.startswith("v1/"):
            return JSONResponse(
                status_code=404,
                content={
                    "error": {
                        "message": "Not found",
                        "trace_id": getattr(request.state, "trace_id", None),
                    }
                },
            )
        return FileResponse(index_path)


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
    app.include_router(schools_facts.router, prefix="/v1")
    app.include_router(calendar.router, prefix="/v1")
    app.include_router(tasks.router, prefix="/v1")
    app.include_router(essays.router, prefix="/v1")
    app.include_router(activities.router, prefix="/v1")
    app.include_router(profile.router, prefix="/v1")
    app.include_router(onboarding.router, prefix="/v1")
    app.include_router(documents.router, prefix="/v1")
    app.include_router(memories.router, prefix="/v1")
    app.include_router(workspace_events.router, prefix="/v1")
    app.include_router(sat.router, prefix="/v1")
    # school-data-v3: the admin dashboard that replaces the parked CDS admin
    # surface (ADR 0038, PARKED.md) — /v1/admin/facts/*, superuser-gated.
    app.include_router(admin_facts.router, prefix="/v1")
    # The CDS admin surface is parked (ADR 0038, PARKED.md) — its router is
    # not mounted; _install_spa_routes is the catch-all SPA fallback and
    # must stay last.
    _install_spa_routes(app, settings)
    return app
