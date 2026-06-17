"""Request context middleware + the global error envelope (Phase 5 Slice A).

Every request gets: a fresh ``trace_id`` (uuid4 hex) bound into structlog's
contextvars and stashed on ``request.state``; CORS from Settings. Any unhandled
exception becomes the user-safe 500 envelope ``{"error": {"message",
"trace_id"}}`` with the full traceback logged under the trace id — internals
never leak (PRD security rules).

B3: the MVP1 parse-only ``Authorization: Bearer`` seam is gone — the validated
``current_active_user`` cookie dependency (``api/auth.py``) is now the principal.
"""

from __future__ import annotations

import traceback
import uuid
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from config.logging import bind_trace_id

logger = structlog.get_logger(__name__)

#: The one user-safe message for unhandled errors.
ERROR_MESSAGE = "Something went wrong — this is on us."


class RequestContextMiddleware:
    """Pure-ASGI middleware: a trace id on ``request.state``.

    Pure ASGI (not ``BaseHTTPMiddleware``) so SSE streaming responses pass
    through without buffering or background-task interference. The trace id is
    bound into structlog's contextvars — every log line in this request's task
    carries it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        trace_id = uuid.uuid4().hex
        bind_trace_id(trace_id)
        state = scope.setdefault("state", {})
        state["trace_id"] = trace_id
        await self.app(scope, receive, send)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Any unhandled exception → the user-safe 500 envelope; full traceback logged."""
    trace_id = getattr(request.state, "trace_id", None)
    logger.error(
        "unhandled_exception",
        trace_id=trace_id,
        error=repr(exc),
        traceback="".join(traceback.format_exception(exc)),
    )
    return JSONResponse(
        status_code=500,
        content={"error": {"message": ERROR_MESSAGE, "trace_id": trace_id}},
    )


def install_middleware(app: FastAPI, settings: Any) -> None:
    """Wire the request-context stack: context middleware, CORS, error envelope.

    ``settings`` needs only ``cors_origins`` (tests pass a plain namespace).
    Add order matters: CORS is added last so it wraps outermost and answers
    preflights before anything else runs.
    """
    from api.deps import EnvelopeError, envelope_error_handler

    app.add_middleware(RequestContextMiddleware)
    # 06-L1: a non-empty CORS allowance under prod (cookie_secure=True ≈ behind a
    # TLS proxy) contradicts the same-origin serving model (ADR 0023) — surface it.
    if settings.cors_origins and getattr(settings, "cookie_secure", False):
        logger.warning(
            "CORS_ORIGINS is non-empty under same-origin serving — confirm intended (ADR 0023)"
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # the httpOnly auth cookie must ride cross-origin
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Last-Event-ID"],
    )
    app.add_exception_handler(EnvelopeError, envelope_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
