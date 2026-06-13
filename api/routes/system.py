"""System routes: GET /v1/health, POST /v1/admin/reconcile.

Phase 5 Slice B implementation (phase-5-api.md Slice B route table).

``/v1/admin/reconcile``
-----------------------
**Superuser-only (B3).**  It runs the full field-index reconciliation
immediately (paid Vertex embedding work), returning the summary dict, and is
gated behind ``current_superuser`` (ADR 0016, ARCHITECTURE §23). ``/v1/health``
stays open for uptime checks.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.auth import current_superuser
from counselle_db.reconcile import reconcile_field_index

APP_VERSION = "0.1.0"

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """Health check.

    Pings both the read-only pool and the app pool (``SELECT 1``).  Returns
    HTTP 200 when the DB is reachable, 503 otherwise.  Reconciler state and
    MCP supervisor status are included for observability.
    """
    runtime = request.app.state.runtime
    reconciler = request.app.state.reconciler
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

    overall = "ok" if db_status == "ok" else "degraded"
    status_code = 200 if db_status == "ok" else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": overall,
            "db": db_status,
            "checkpointer": checkpointer_status,
            "mcp": supervisor.status(),
            "reconciler": reconciler.as_dict(),
            "version": APP_VERSION,
        },
    )


@router.post("/admin/reconcile", dependencies=[Depends(current_superuser)])
async def admin_reconcile(request: Request) -> JSONResponse:
    """Trigger an immediate field-index reconciliation pass.

    **Superuser-only (B3):** it kicks off paid Vertex embedding work, so it is
    gated behind ``current_superuser`` — a non-superuser (or unauthenticated)
    caller gets 401/403 (ADR 0016, ARCHITECTURE §23).

    Returns the reconcile summary dict from :func:`reconcile_field_index`.
    """
    runtime = request.app.state.runtime
    summary = await reconcile_field_index(runtime.app_pool)
    return JSONResponse(content=summary)
