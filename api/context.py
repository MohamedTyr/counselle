"""Request context middleware + the global error envelope (Phase 5 Slice A).

Every request gets: a fresh ``trace_id`` (uuid4 hex) bound into structlog's
contextvars and stashed on ``request.state``; an **optional principal** parsed
from ``Authorization: Bearer <token>`` — no validation, no auth, just the
platform's auth seam (ADR 0016); CORS from Settings. Any unhandled exception
becomes the user-safe 500 envelope ``{"error": {"message", "trace_id"}}`` with
the full traceback logged under the trace id — internals never leak (PRD
security rules).
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


def _parse_principal(scope: Scope) -> str | None:
    """``Authorization: Bearer <x>`` → ``<x>``; anything else → ``None``. No validation."""
    headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
    for name, value in headers:
        if name == b"authorization":
            scheme, _, token = value.decode("latin-1").partition(" ")
            if scheme.lower() == "bearer" and token.strip():
                return token.strip()
            return None
    return None


class RequestContextMiddleware:
    """Pure-ASGI middleware: trace id + optional principal on ``request.state``.

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
        state["principal"] = _parse_principal(scope)
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
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Last-Event-ID"],
    )
    app.add_exception_handler(Exception, unhandled_exception_handler)
