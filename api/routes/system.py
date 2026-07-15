"""System health route."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from api.ratelimit import _RATE_LIMITER_ATTR

APP_VERSION = "0.1.0"

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """Health check.

    Pings both the read-only pool and the app pool (``SELECT 1``).  Returns
    HTTP 200 when the DB is reachable, 503 otherwise.  Reconciler state, MCP
    supervisor status, and the rate-limiter wiring (DS-06) are included for
    observability — a mis-wired limiter (which fails open, admitting everything)
    degrades the health status instead of being a silent log-only warning.
    """
    runtime = request.app.state.runtime
    supervisor = request.app.state.mcp_supervisor

    # --- DB health: SELECT 1 on both pools ---
    db_status = "ok"
    checkpointer_status = "ok"

    try:
        async with runtime.ro_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        db_status = "fail"

    try:
        async with runtime.app_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        db_status = "fail"  # either pool failing = db fail

    # Checkpointer: report "ok" if both pools are up (the checkpointer uses
    # the app pool's DSN; independently pinging its own psycopg connection
    # would need an extra round-trip and can block — "configured" is sufficient
    # for MVP1).
    if db_status == "fail":
        checkpointer_status = "fail"

    # --- Rate limiter (DS-06): a missing limiter fails open (admits everything),
    # so a mis-wired limiter must be VISIBLE to monitoring, not silent. ---
    limiter = getattr(request.app.state, _RATE_LIMITER_ATTR, None)
    rate_limiter_status = "ok" if limiter is not None else "MISSING"

    healthy = db_status == "ok" and rate_limiter_status == "ok"
    overall = "ok" if healthy else "degraded"
    status_code = 200 if db_status == "ok" else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": overall,
            "db": db_status,
            "checkpointer": checkpointer_status,
            "rate_limiter": rate_limiter_status,
            "mcp": supervisor.status(),
            "version": APP_VERSION,
        },
    )
