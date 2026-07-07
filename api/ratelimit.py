"""In-process sliding-window rate limiting (B4, §32; ARCHITECTURE §23).

A small ``deque``-per-key sliding window keyed off ``time.monotonic`` — no
library (KISS). Two surfaces use it:

- **messages** — per-user (``user.id``), enforcing ``turns_per_hour`` AND
  ``turns_per_day``. Over → 429 + ``Retry-After``. Every message send spends a
  token (no exemption).
- **auth** — per-IP (uvicorn's resolved ``request.client.host`` — the real client
  IP, since the deploy runs with ``--forwarded-allow-ips`` so uvicorn parses the
  proxy chain itself; we never read ``X-Forwarded-For`` directly, which would be
  trivially spoofable), enforcing ``auth_attempts_per_window`` over
  ``auth_window_seconds`` on login + forgot-password. IP-only is the robust
  half of "email/IP": email-keying would need a body read in a dependency (which
  consumes the stream), so we don't — IP is the effective brute-force control.

MULTI-REPLICA CAVEAT: this is process-local. A multi-replica deploy needs a
shared store (Redis) — out of scope for the single-replica MVP2 (ARCHITECTURE §23).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from math import ceil

import structlog
from fastapi import Depends, Request

from api.auth import current_active_user
from api.deps import EnvelopeError
from api.users_db import UserDB

logger = structlog.get_logger(__name__)

_RATE_LIMITER_ATTR = "rate_limiter"

_USER_SAFE_TURNS = "You've sent a lot of messages — please slow down and try again shortly."
_USER_SAFE_AUTH = "Too many attempts — please wait a moment and try again."
_USER_SAFE_WORKSPACE = "Too many workspace updates — please slow down and try again shortly."


class SlidingWindowLimiter:
    """Per-key sliding-window counters, pruned on check. Process-local."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _check(self, key: str, limit: int, window_s: float, now: float) -> float | None:
        """Prune expired hits; if under the limit, record + admit (None). Else
        return the seconds until the oldest hit falls out of the window."""
        hits = self._hits[key]
        cutoff = now - window_s
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return max(0.0, hits[0] + window_s - now)
        if not hits:
            # Evict the empty deque so idle / rotated keys don't grow the map;
            # the append below re-materializes it (defaultdict) with one hit.
            del self._hits[key]
        self._hits[key].append(now)
        return None

    def check_message(
        self, user_id: str, *, per_hour: int, per_day: int
    ) -> float | None:
        """Enforce both the hourly and daily caps for a user. Returns the
        ``Retry-After`` seconds when over, else None (and records the hit).

        Both windows must admit before either records a hit — a request rejected
        by the daily cap must not consume an hourly token (and vice versa).
        """
        now = time.monotonic()
        hour_key, day_key = f"turns:h:{user_id}", f"turns:d:{user_id}"
        # Peek both windows without recording; only record when both admit.
        hour_retry = self._peek(hour_key, per_hour, 3600.0, now)
        day_retry = self._peek(day_key, per_day, 86400.0, now)
        if hour_retry is not None or day_retry is not None:
            return max(hour_retry or 0.0, day_retry or 0.0)
        self._hits[hour_key].append(now)
        self._hits[day_key].append(now)
        return None

    def _peek(self, key: str, limit: int, window_s: float, now: float) -> float | None:
        """Prune + report retry-seconds if over the limit; does NOT record."""
        hits = self._hits[key]
        cutoff = now - window_s
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return max(0.0, hits[0] + window_s - now)
        if not hits:
            # Evict empty deques so peeked-but-idle keys don't grow the map.
            del self._hits[key]
        return None

    def check_auth(self, ip: str, *, attempts: int, window_s: float) -> float | None:
        """Per-IP auth window. Returns ``Retry-After`` seconds when over, else None."""
        return self._check(f"auth:{ip}", attempts, window_s, time.monotonic())

    def check_workspace(self, user_id: str, *, per_minute: int) -> float | None:
        """Per-user workspace write cap. Returns retry seconds when over."""
        return self._check(f"workspace:m:{user_id}", per_minute, 60.0, time.monotonic())

    def reset(self) -> None:
        """Clear all counters (test seam)."""
        self._hits.clear()


class _NoopLimiter(SlidingWindowLimiter):
    """Admit-everything fallback when no limiter is on ``app.state``.

    Fail OPEN is acceptable ONLY because a missing limiter is a boot-config bug,
    not a user-reachable state in normal operation — but it must be a deliberate,
    logged decision, never a leaked 500.
    """

    def check_message(self, user_id: str, *, per_hour: int, per_day: int) -> float | None:
        return None

    def check_auth(self, ip: str, *, attempts: int, window_s: float) -> float | None:
        return None

    def check_workspace(self, user_id: str, *, per_minute: int) -> float | None:
        return None


_NOOP_LIMITER = _NoopLimiter()


def get_limiter(request: Request) -> SlidingWindowLimiter:
    """The process-wide limiter, created in the lifespan on ``app.state``.

    Missing limiter → admit (fail open) with a WARNING; never a 500. See
    :class:`_NoopLimiter` for why fail-open is the deliberate choice here.
    """
    limiter = getattr(request.app.state, _RATE_LIMITER_ATTR, None)
    if limiter is None:
        logger.warning("rate limiter not initialized — admitting request")
        return _NOOP_LIMITER
    return limiter  # type: ignore[no-any-return]


def _client_ip(request: Request) -> str:
    """The caller's real IP — uvicorn resolves it from the proxy chain (the deploy
    runs ``--forwarded-allow-ips``), so we trust ``client.host`` and never read a
    spoofable ``X-Forwarded-For`` header ourselves."""
    return request.client.host if request.client else "unknown"


def _retry_after_header(seconds: float) -> dict[str, str]:
    return {"Retry-After": str(max(1, ceil(seconds)))}


async def message_rate_limit(
    request: Request, user: UserDB = Depends(current_active_user)
) -> None:
    """Per-user message cap dependency for ``POST .../messages`` (429 + Retry-After)."""
    settings = request.app.state.settings
    retry = get_limiter(request).check_message(
        str(user.id), per_hour=settings.turns_per_hour, per_day=settings.turns_per_day
    )
    if retry is not None:
        raise EnvelopeError(429, _USER_SAFE_TURNS, headers=_retry_after_header(retry))


async def auth_rate_limit(request: Request) -> None:
    """Per-IP cap dependency for login + forgot-password (429 + Retry-After)."""
    settings = request.app.state.settings
    retry = get_limiter(request).check_auth(
        _client_ip(request),
        attempts=settings.auth_attempts_per_window,
        window_s=settings.auth_window_seconds,
    )
    if retry is not None:
        raise EnvelopeError(429, _USER_SAFE_AUTH, headers=_retry_after_header(retry))


async def workspace_write_rate_limit(
    request: Request, user: UserDB = Depends(current_active_user)
) -> None:
    """Per-user cap for workspace mutations (429 + Retry-After)."""
    settings = request.app.state.settings
    retry = get_limiter(request).check_workspace(
        str(user.id), per_minute=settings.workspace_writes_per_minute
    )
    if retry is not None:
        raise EnvelopeError(429, _USER_SAFE_WORKSPACE, headers=_retry_after_header(retry))
