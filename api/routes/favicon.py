"""The same-origin favicon proxy: ``GET /v1/favicon`` (see ``domain/urls.py``).

We always connect to the fixed upstream CDN (``FAVICON_CDN_BASE``) ourselves —
the caller-supplied ``host`` only ever becomes a query-string *value* sent to
that fixed target, never a connection target itself, so an attacker-supplied
``host`` cannot redirect our server's outbound connection (no SSRF vector).
It's still validated against a strict hostname shape and length before use, as
defense in depth and to keep it out of logs/errors looking like anything else.

An in-process TTL cache keyed on ``host:size`` avoids re-hitting the CDN for
every chip render — favicons don't change minute to minute. Any upstream
failure (timeout, non-200, empty body) degrades to ``204 No Content``, which
the frontend already treats as "no icon" (existing ``onError``/empty-src
handling in ``StepSourceChip.tsx``) — never a 500, never a broken image.
"""

from __future__ import annotations

import re
import time

import httpx
import structlog
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from api.auth import current_active_user
from api.users_db import UserDB
from domain.urls import FAVICON_CDN_BASE

router = APIRouter(tags=["favicon"])
logger = structlog.get_logger(__name__)

#: A conservative hostname shape (labels of alnum/hyphen, dot-separated, a
#: letters-only TLD) — rejects anything that isn't plausibly a real host
#: (schemes, paths, spaces, IPs) before it ever reaches the outbound call.
_HOST_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,63}$")

_TIMEOUT_S = 3.0
_CACHE_TTL_S = 3600.0
#: A hard cap on the cache's size — bounded memory over an unbounded process
#: lifetime; clearing everything on overflow is simpler than LRU eviction and
#: cheap to re-warm (upstream fetches are fast and cached again immediately).
_MAX_CACHE_ENTRIES = 2000

_CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}

_cache: dict[str, tuple[float, bytes, str]] = {}


@router.get("/favicon")
async def get_favicon(
    host: str = Query(..., max_length=253),
    sz: int = Query(64, ge=16, le=256),
    _user: UserDB = Depends(current_active_user),
) -> Response:
    """Stream a favicon from the CDN through our own origin."""
    host = host.strip().lower()
    if not _HOST_RE.match(host):
        return Response(status_code=204)

    cache_key = f"{host}:{sz}"
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if cached is not None and now - cached[0] < _CACHE_TTL_S:
        _, body, content_type = cached
        return Response(content=body, media_type=content_type, headers=_CACHE_HEADERS)

    try:
        # Google's endpoint 301s to a gstatic.com asset URL — httpx does not
        # follow redirects by default, so without this every request "fails"
        # with a 301 and the proxy degrades to 204 for every host.
        async with httpx.AsyncClient(timeout=_TIMEOUT_S, follow_redirects=True) as client:
            resp = await client.get(FAVICON_CDN_BASE, params={"domain": host, "sz": sz})
    except httpx.HTTPError:
        logger.warning("favicon proxy: upstream fetch failed", host=host)
        return Response(status_code=204)

    if resp.status_code != 200 or not resp.content:
        return Response(status_code=204)

    content_type = resp.headers.get("content-type", "image/png")
    if len(_cache) >= _MAX_CACHE_ENTRIES:
        _cache.clear()
    _cache[cache_key] = (now, resp.content, content_type)
    return Response(content=resp.content, media_type=content_type, headers=_CACHE_HEADERS)
