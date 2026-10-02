"""Shared FastAPI dependencies for the v1 routes (B3).

- :func:`require_json` — the CSRF posture: a state-changing custom route that
  takes a body must be ``application/json`` (a 415 otherwise). Login/forgot/reset
  are stock form/JSON routers and are NOT wrapped — see the B3 brief §7.
- :func:`owned_session` — loads a session row and asserts the authed user owns
  it. Foreign or unknown → **404** (never 403 — no existence leak).

Both raise :class:`EnvelopeError`, which ``install_middleware`` maps to the
project's ``{"error": {"message", "trace_id"}}`` envelope — leaving fastapi-users'
own ``{"detail": ...}`` error shape (login 400, etc.) untouched.
"""

from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from api.auth import current_active_user
from api.users_db import UserDB
from app.sessions import get_session


class EnvelopeError(Exception):
    """A user-safe error that renders as the project's ``{"error": …}`` envelope.

    ``headers`` lets a raiser attach response headers (B4: ``Retry-After`` on a
    429) — the handler emits them on the JSONResponse. ``extra`` is merged
    into the ``error`` object, the only way structured detail (a 422's failing
    ``problems``, a 409's ``current_version``) reaches the client.
    """

    def __init__(
        self,
        status_code: int,
        message: str,
        headers: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.headers = headers
        self.extra = extra


async def envelope_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render :class:`EnvelopeError` as the project error envelope."""
    err = exc if isinstance(exc, EnvelopeError) else EnvelopeError(500, "Something went wrong.")
    trace_id = getattr(request.state, "trace_id", None)
    return JSONResponse(
        status_code=err.status_code,
        content={"error": {**(err.extra or {}), "message": err.message, "trace_id": trace_id}},
        headers=err.headers,
    )


async def require_json(request: Request) -> None:
    """Reject a non-JSON content-type on a body-bearing state-changing route (415).

    A body-less request (no ``Content-Length``/``Transfer-Encoding``) is allowed
    through — POST /v1/sessions accepts an empty body (defaults apply).
    """
    has_body = bool(
        request.headers.get("content-length", "").strip().lstrip("0")
        or request.headers.get("transfer-encoding")
    )
    if not has_body:
        return
    content_type = request.headers.get("content-type", "")
    if content_type.split(";")[0].strip().lower() != "application/json":
        raise EnvelopeError(415, "Content-Type must be application/json.")


def etag_response(
    request: Request, model: BaseModel, *, vintage: str | None, cache_control: str
) -> Response:
    """Render `model` with a weak `ETag` derived from `vintage` (plan §5.2's
    facts route: a weak ETag from `observed_at`) and honor `If-None-Match`
    with a bare 304 -- the app's first ETag helper. `vintage=None` (nothing
    observed yet) never mints an ETag: a 304 would tell the client its
    cached copy of "nothing observed" is still current, which is true of
    every such school and therefore not a cache signal at all.
    """
    body = model.model_dump(mode="json")
    if vintage is None:
        return JSONResponse(content=body, headers={"Cache-Control": cache_control})
    etag = 'W/"' + hashlib.sha256(vintage.encode()).hexdigest()[:32] + '"'
    headers = {"Cache-Control": cache_control, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=body, headers=headers)


def content_disposition(filename: str) -> str:
    """Build a header-injection-safe ``attachment`` Content-Disposition value.

    Always forces ``attachment`` (never inline) so a browser never renders
    user-uploaded content in-page. The stored filename is sanitized at
    upload time by the caller, but header injection is a distinct risk from
    path traversal, so it is re-escaped here too — mirroring Starlette's own
    ``FileResponse`` RFC 6266 quoting.
    """
    safe_filename = quote(filename)
    if safe_filename != filename:
        return f"attachment; filename*=utf-8''{safe_filename}"
    return f'attachment; filename="{filename}"'


async def owned_session(
    session_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> dict[str, Any]:
    """Load the session row, asserting ownership; 404 on foreign/unknown.

    Returns the row dict so a route can reuse it without a second fetch.
    """
    row = await get_session(request.app.state.runtime.app_pool, str(session_id))
    if row is None or row.get("user_id") != str(user.id):
        raise EnvelopeError(404, "Session not found.")
    return row
