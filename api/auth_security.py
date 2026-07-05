"""Browser-side protections for cookie-backed auth routes."""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import Request

from api.deps import EnvelopeError

_USER_SAFE_CSRF = "Invalid auth request origin."


def _origin_from_url(value: str) -> str | None:
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def _request_origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}".lower()


async def auth_origin_protect(request: Request) -> None:
    """Reject cross-origin browser auth POSTs before cookies can change state."""
    if request.method.upper() not in {"POST", "PATCH", "DELETE"}:
        return

    allowed = {_request_origin(request)}
    settings = getattr(request.app.state, "settings", None)
    allowed.update(
        origin.lower()
        for origin in getattr(settings, "cors_origins", [])
        if isinstance(origin, str)
    )

    origin = request.headers.get("origin")
    if origin:
        if origin.lower() not in allowed:
            raise EnvelopeError(403, _USER_SAFE_CSRF)
        return

    referer = request.headers.get("referer")
    if referer:
        referer_origin = _origin_from_url(referer)
        if referer_origin not in allowed:
            raise EnvelopeError(403, _USER_SAFE_CSRF)
        return

    raise EnvelopeError(403, _USER_SAFE_CSRF)
