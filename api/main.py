"""The FastAPI app factory for the Counselle API service (Phase 5 Slice A).

``create_app()`` wires:

- ``get_settings()`` at factory time — fail-fast: a misconfigured environment
  kills boot right here (ADR 0018);
- the request-context stack — trace ids, optional principal, CORS, the 500
  error envelope (``api/context.py``);
- the ``/v1`` routers — Slice A ships empty stubs in ``api/routes/``; Slice B
  fills their bodies (sessions, messages SSE, health, admin reconcile);
- the lifespan — logging, the Phase 4 runtime via ``app.deps.build_runtime``
  (RO pool + catalog, app pool, durable checkpointer incl. the D3 schema
  assertion, compiled graph), the field-index reconciler (startup pass +
  interval task, both non-fatal — keyword fallback serves when the index
  lags; ``build_runtime`` starts none, and the MCP child's own reconciler
  only covers the child process, not this one's in-process service calls),
  and the MCP child supervisor (eng-review D4, ``api/supervision.py``).

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
from pathlib import Path
from typing import Any

import asyncpg
import structlog
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from api.context import install_middleware
from api.routes import sessions, system
from api.supervision import McpSupervisor
from app.deps import build_runtime
from config.logging import setup_logging
from config.settings import get_settings

# ADR 0017 deviation 2: api/ → counselle_db direct import accepted for MVP1.
from counselle_db.reconcile import reconcile_field_index

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


async def _reconcile_once(app_pool: asyncpg.Pool, state: ReconcilerState) -> None:
    """One reconcile pass; never raises — keyword fallback serves when the index lags."""
    state.last_run = datetime.now(UTC).isoformat()
    try:
        state.last_result = await reconcile_field_index(app_pool)
        state.last_error = None
    except Exception as exc:
        state.last_result = None
        # Surface only the class name; the full message may contain internal
        # hosts/ports/DSNs — log server-side, never expose to clients.
        state.last_error = type(exc).__name__
        logger.exception(
            "field_index reconcile failed — keyword fallback serves",
            error=repr(exc),
        )


async def _reconcile_forever(
    app_pool: asyncpg.Pool, interval_minutes: int, state: ReconcilerState
) -> None:
    """Periodic field-index reconcile (ADR 0008) — same pattern as counselle_db/server.py."""
    while True:
        await asyncio.sleep(interval_minutes * 60)
        await _reconcile_once(app_pool, state)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot the runtime, reconciler, and MCP supervisor; put it all away on shutdown."""
    settings = get_settings()
    setup_logging(settings.log_level)
    runtime = await build_runtime(settings)  # pools + catalog + checkpointer (D3) + graph
    try:
        reconciler = ReconcilerState()
        await _reconcile_once(runtime.app_pool, reconciler)
        reconcile_task = asyncio.create_task(
            _reconcile_forever(runtime.app_pool, settings.reconcile_interval_minutes, reconciler),
            name="field-index-reconciler",
        )
        supervisor = McpSupervisor(runtime.deps.mcp_toolset)
        supervisor.start()  # first probe spawns/verifies the counselle-db child (D4)
        # Wire supervisor.kick to deps.on_failure so any turn crash immediately
        # triggers a probe + restart of the MCP child (FIX 3; ADR 0017 carve-out).
        runtime.deps.on_failure = supervisor.kick
        app.state.settings = settings
        app.state.runtime = runtime
        app.state.reconciler = reconciler
        app.state.mcp_supervisor = supervisor
        try:
            yield
        finally:
            reconcile_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reconcile_task
            await supervisor.aclose()
    finally:
        await runtime.aclose()


def create_app() -> FastAPI:
    """Build the Counselle API service (ADR 0016): middleware, /v1 routers, lifespan."""
    settings = get_settings()  # fail-fast: misconfiguration kills boot at the factory
    app = FastAPI(title="Counselle", version="0.1.0", lifespan=_lifespan)
    install_middleware(app, settings)
    app.include_router(sessions.router, prefix="/v1")
    app.include_router(system.router, prefix="/v1")
    # Dev harness static files — served at /harness (html=True serves index.html)
    _harness_dir = Path(__file__).parent.parent / "harness"
    if _harness_dir.is_dir():
        app.mount("/harness", StaticFiles(directory=str(_harness_dir), html=True), name="harness")
    return app
