"""System health route."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from adapters import facts_queries
from api.ratelimit import _RATE_LIMITER_ATTR

APP_VERSION = "0.1.0"

router = APIRouter(tags=["system"])


async def _facts_worker_status(request: Request) -> str:
    """`"disabled"|"ok"|"stale"` (plan §7 Phase 1 exit criteria / §4.3):
    disabled when the kill switch is off or the pipeline pool isn't
    configured; stale when the last run finished more than
    `2 * facts_crawl_interval_hours` ago or its status is
    `failed`/`aborted`; `ok` otherwise, including "never run yet"."""
    settings = request.app.state.settings
    runtime = request.app.state.runtime
    if not settings.facts_worker_enabled or runtime.pipeline_pool is None:
        return "disabled"
    try:
        last_run = await facts_queries.get_last_run(runtime.pipeline_pool)
    except Exception:
        return "stale"
    if last_run is None:
        return "ok"
    if last_run.status in ("failed", "aborted"):
        return "stale"
    if last_run.finished_at is None:
        return "ok"  # still running
    threshold = timedelta(hours=2 * settings.facts_crawl_interval_hours)
    if datetime.now(UTC) - last_run.finished_at > threshold:
        return "stale"
    return "ok"


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """Health check.

    Pings both the read-only pool and the app pool (``SELECT 1``).  Returns
    HTTP 200 when the DB is reachable, 503 otherwise.  Reconciler state, the
    rate-limiter wiring (DS-06), and the facts crawl worker's staleness
    (school-data-v3) are included for observability — a mis-wired limiter
    (which fails open, admitting everything) or a stalled crawler degrade
    the health status instead of being silent log-only warnings.
    """
    runtime = request.app.state.runtime

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

    # --- facts crawl worker (school-data-v3): "disabled" is a normal,
    # healthy state (the kill switch defaults false) -- only "stale"
    # degrades overall status. ---
    facts_worker_status = await _facts_worker_status(request)

    healthy = (
        db_status == "ok" and rate_limiter_status == "ok" and facts_worker_status != "stale"
    )
    overall = "ok" if healthy else "degraded"
    status_code = 200 if db_status == "ok" else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": overall,
            "db": db_status,
            "checkpointer": checkpointer_status,
            "rate_limiter": rate_limiter_status,
            "facts_worker": facts_worker_status,
            "version": APP_VERSION,
        },
    )
