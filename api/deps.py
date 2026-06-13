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

from typing import Any
from uuid import UUID

from fastapi import Depends, Request
from fastapi.responses import JSONResponse

from api.auth import current_active_user
from api.users_db import UserDB
from app.sessions import get_session


class EnvelopeError(Exception):
    """A user-safe error that renders as the project's ``{"error": …}`` envelope.

    ``headers`` lets a raiser attach response headers (B4: ``Retry-After`` on a
    429) — the handler emits them on the JSONResponse.
    """

    def __init__(
        self, status_code: int, message: str, headers: dict[str, str] | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.headers = headers


async def envelope_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render :class:`EnvelopeError` as the project error envelope."""
    err = exc if isinstance(exc, EnvelopeError) else EnvelopeError(500, "Something went wrong.")
    trace_id = getattr(request.state, "trace_id", None)
    return JSONResponse(
        status_code=err.status_code,
        content={"error": {"message": err.message, "trace_id": trace_id}},
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
