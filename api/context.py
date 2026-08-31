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
from collections.abc import Mapping, Sequence
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.skills import SELECTED_SKILLS_SAFE_ERROR
from config.logging import bind_trace_id

logger = structlog.get_logger(__name__)

#: The one user-safe message for unhandled errors.
ERROR_MESSAGE = "Something went wrong — this is on us."


def _selected_skill_schema_reason(errors: Sequence[Mapping[str, Any]]) -> str:
    """Return a fixed telemetry label for a malformed ``body.skills`` value.

    Pydantic's error details can echo untrusted input.  Never log those
    details here: the safe response and logs must not disclose a requested
    slug, a malformed body, or any skill content.
    """
    error_types = {str(error.get("type", "")) for error in errors}
    if "too_long" in error_types:
        return "too_many_selected_skills_schema"
    if any(error_type.endswith("string_type") for error_type in error_types):
        return "invalid_selected_skill_item_schema"
    return "invalid_selected_skills_schema"


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


class MaxBodySizeMiddleware:
    """Pure-ASGI cap on request-body bytes, enforced before anything parses them.

    The upload routes (`cds_admin`, `documents`) already check their own size
    limits, but those checks run too late to protect the server: FastAPI's
    request handler calls ``await request.form()`` — which streams a multipart
    file part straight to a spooled temp file, with Starlette's
    ``max_part_size`` applying only to non-file fields — *before*
    ``solve_dependencies()`` evaluates the route's ``Depends(current_superuser)``
    gate. So an unauthenticated caller could make the process buffer an
    arbitrarily large body to disk/memory just by POSTing to the upload path. A
    ``Depends`` cannot fix that; only something upstream of the parser can.

    Pure ASGI (not ``BaseHTTPMiddleware``) for the same reason as
    :class:`RequestContextMiddleware`: SSE responses must not be buffered.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _content_length(scope)
        if declared is not None and declared > self.max_bytes:
            await _too_large(scope, send, self.max_bytes)
            return

        # A client can simply omit Content-Length (chunked), so the header check
        # is only the cheap early exit — the real bound is counting what arrives.
        seen = 0

        async def counting_receive() -> Any:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # Cut the body off rather than raising: the parser sees a
                    # truncated request and the client gets a 400 (verified),
                    # instead of this middleware trying to emit its own response
                    # mid-parse while the app is already writing one. Less
                    # precise than the 413 the Content-Length path returns, but
                    # the bytes stop arriving, which is the point.
                    return {"type": "http.disconnect"}
            return message

        await self.app(scope, counting_receive, send)


def _content_length(scope: Scope) -> int | None:
    for key, value in scope.get("headers", []):
        if key == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _too_large(scope: Scope, send: Send, max_bytes: int) -> None:
    # `MaxBodySizeMiddleware` is deliberately OUTSIDE `RequestContextMiddleware`
    # (the cap has to run before anything can parse the body), so no trace id has
    # been bound yet. Mint one rather than sending `trace_id: null`: without it
    # an oversized-body rejection was invisible in the logs *and* unlinkable
    # from the envelope the client is holding.
    trace_id = scope.get("state", {}).get("trace_id") or uuid.uuid4().hex
    bind_trace_id(trace_id)
    logger.warning(
        "request_body_too_large",
        trace_id=trace_id,
        path=scope.get("path"),
        max_bytes=max_bytes,
        content_length=_content_length(scope),
    )
    max_mb = max_bytes // (1024 * 1024)
    body = JSONResponse(
        status_code=413,
        content={
            "error": {
                "message": f"Request body must be no larger than {max_mb} MiB.",
                "trace_id": trace_id,
            }
        },
    )
    await body(scope, _empty_receive, send)


async def _empty_receive() -> Any:
    return {"type": "http.request", "body": b"", "more_body": False}


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


async def request_validation_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Keep malformed explicit skill payloads indistinguishable from bad names."""
    # Starlette's exception-handler type accepts ``Exception`` rather than a
    # narrower subclass.  The registration below is keyed to
    # RequestValidationError, but retain a safe fallback if that contract ever
    # changes.
    if not isinstance(exc, RequestValidationError):
        return await unhandled_exception_handler(request, exc)
    is_message_route = request.url.path.endswith("/messages")
    has_skill_error = any(
        len(error.get("loc", ())) >= 2 and error["loc"][0:2] == ("body", "skills")
        for error in exc.errors()
    )
    if is_message_route and has_skill_error:
        trace_id = getattr(request.state, "trace_id", None)
        logger.warning(
            "invalid explicit skill selection",
            reason=_selected_skill_schema_reason(exc.errors()),
        )
        return JSONResponse(
            status_code=422,
            content={"error": {"message": SELECTED_SKILLS_SAFE_ERROR, "trace_id": trace_id}},
        )
    return await request_validation_exception_handler(request, exc)


def install_middleware(app: FastAPI, settings: Any) -> None:
    """Wire the request-context stack: context middleware, CORS, error envelope.

    ``settings`` needs only ``cors_origins`` (tests pass a plain namespace).
    Add order matters: CORS is added last so it wraps outermost and answers
    preflights before anything else runs.
    """
    from api.deps import EnvelopeError, envelope_error_handler

    app.add_middleware(RequestContextMiddleware)
    # Headroom over the largest legitimate upload (`cds_upload_max_bytes`) for
    # multipart framing — boundaries and part headers ride along with the file,
    # so a body exactly at the file cap is still a little over it on the wire.
    app.add_middleware(
        MaxBodySizeMiddleware,
        max_bytes=getattr(settings, "cds_upload_max_bytes", 50_000_000) + 1_048_576,
    )
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
    app.add_exception_handler(RequestValidationError, request_validation_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
